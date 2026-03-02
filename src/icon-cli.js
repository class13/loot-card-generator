import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import yaml from 'js-yaml';
import { program } from 'commander';
import chalk from 'chalk';
import { loadYaml } from './loader.js';

const NEGATIVE_PROMPT = '(blurry:1.3). lowres.';

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

function createPrompt(card) {
  const subject = (card.imagePrompt || card.name || card.type || 'fantasy item')
    .trim()
    .replace(/[.。]+$/g, '');
  return `2d icon. ${subject}. white background. <lora:game_icon_v1.0:1>`;
}

async function fetchJson(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`Could not reach ComfyUI at ${url}: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchBuffer(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Could not download image from ${url}: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

async function listNodeChoices(baseUrl, nodeType, inputName) {
  try {
    const info = await fetchJson(`${baseUrl}/object_info/${encodeURIComponent(nodeType)}`);
    const values = info?.[nodeType]?.input?.required?.[inputName]?.[0];
    return Array.isArray(values) ? values : [];
  } catch {
    return [];
  }
}

async function listModels(baseUrl, kind) {
  try {
    const data = await fetchJson(`${baseUrl}/models/${encodeURIComponent(kind)}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function selectModelName(preferred, choices) {
  if (!choices.length) return preferred;
  if (choices.includes(preferred)) return preferred;

  const preferredBase = preferred.replace(/\.[^.]+$/, '').toLowerCase();
  const exactBase = choices.find((c) => c.replace(/\.[^.]+$/, '').toLowerCase() === preferredBase);
  if (exactBase) return exactBase;

  const fuzzy = choices.find((c) => c.toLowerCase().includes(preferredBase));
  if (fuzzy) return fuzzy;

  return choices[0];
}

function buildWorkflow(params) {
  const {
    checkpoint,
    lora,
    prompt,
    width,
    height,
    seed,
    steps,
    cfg,
    sampler,
    scheduler,
    denoise,
    prefix,
  } = params;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip: ['1', 1],
        lora_name: lora,
        strength_model: 1,
        strength_clip: 1,
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: prompt,
        clip: ['2', 1],
      },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: NEGATIVE_PROMPT,
        clip: ['2', 1],
      },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise,
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['6', 0],
        vae: ['1', 2],
      },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: prefix,
        images: ['7', 0],
      },
    },
  };
}

async function queuePrompt(baseUrl, workflow) {
  const clientId = randomUUID();
  const payload = { prompt: workflow, client_id: clientId };
  const data = await fetchJson(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!data.prompt_id) {
    throw new Error('ComfyUI did not return a prompt_id.');
  }
  return data.prompt_id;
}

async function waitForImages(baseUrl, promptId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const history = await fetchJson(`${baseUrl}/history/${encodeURIComponent(promptId)}`);
    const job = history?.[promptId];
    const outputs = job?.outputs;
    if (outputs) {
      const images = [];
      for (const output of Object.values(outputs)) {
        if (Array.isArray(output.images)) images.push(...output.images);
      }
      if (images.length) return images;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error(`Timed out waiting for prompt ${promptId}`);
}

function toPosInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toPosFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function runIconGenerator() {
  program
    .name('loot-card-icons')
    .description('Generate local icon images from loot card YAML using ComfyUI + SDXL')
    .version('1.0.0')
    .argument('<input>', 'YAML file path')
    .option('--comfy-url <url>', 'ComfyUI base URL', 'http://localhost:8000')
    .option('--out-dir <path>', 'Output icon directory, default: <yaml-dir>/icons')
    .option('--checkpoint <name>', 'Checkpoint model name in ComfyUI', 'sd_xl_base_1.0.safetensors')
    .option('--lora <name>', 'LoRA model name in ComfyUI', 'game_icon_v1.0.safetensors')
    .option('--width <n>', 'Image width', (v) => toPosInt(v, 1024), 1024)
    .option('--height <n>', 'Image height', (v) => toPosInt(v, 1024), 1024)
    .option('--steps <n>', 'Sampling steps', (v) => toPosInt(v, 30), 30)
    .option('--cfg <n>', 'CFG scale', (v) => toPosFloat(v, 7), 7)
    .option('--sampler <name>', 'Sampler name', 'euler')
    .option('--scheduler <name>', 'Scheduler name', 'normal')
    .option('--denoise <n>', 'Denoise value', (v) => toPosFloat(v, 1), 1)
    .option('--seed <n>', 'Base seed for deterministic runs', (v) => toPosInt(v, null))
    .option('--fast', 'Use quick draft settings (512x512, 12 steps, cfg 4.5)')
    .option('--limit <n>', 'Generate only the first N eligible cards', (v) => toPosInt(v, null))
    .option('--list-models', 'List checkpoint/LoRA names visible to ComfyUI and exit')
    .option('--overwrite', 'Regenerate even when card already has icon')
    .option('--write-yaml <path>', 'Write a YAML file with updated icon fields')
    .option('--in-place', 'Overwrite the input YAML with updated icon fields')
    .action(async (input, options) => {
      try {
        if (options.writeYaml && options.inPlace) {
          throw new Error('Use either --write-yaml or --in-place, not both.');
        }

        const { cards, yamlDir } = loadYaml(input);
        const comfyUrl = options.comfyUrl.replace(/\/+$/, '');
        const outputDir = path.resolve(options.outDir || path.join(yamlDir, 'icons'));
        fs.mkdirSync(outputDir, { recursive: true });

        console.log(chalk.cyan('Loading ComfyUI model metadata...'));
        const [ckptFromModels, loraFromModels, ckptFromNode, loraFromNode] = await Promise.all([
          listModels(comfyUrl, 'checkpoints'),
          listModels(comfyUrl, 'loras'),
          listNodeChoices(comfyUrl, 'CheckpointLoaderSimple', 'ckpt_name'),
          listNodeChoices(comfyUrl, 'LoraLoader', 'lora_name'),
        ]);
        const ckptChoices = ckptFromModels.length ? ckptFromModels : ckptFromNode;
        const loraChoices = loraFromModels.length ? loraFromModels : loraFromNode;

        if (options.listModels) {
          console.log(chalk.cyan('Checkpoints:'));
          console.log(ckptChoices.length ? ckptChoices.join('\n') : '(none)');
          console.log(chalk.cyan('\nLoRAs:'));
          console.log(loraChoices.length ? loraChoices.join('\n') : '(none)');
          return;
        }

        if (!ckptChoices.length) {
          throw new Error(
            'ComfyUI reports no checkpoint models. Put an SDXL checkpoint in ComfyUI/models/checkpoints and click "Refresh" in ComfyUI.',
          );
        }

        if (!loraChoices.length) {
          throw new Error(
            'ComfyUI reports no LoRA models. Put your LoRA in ComfyUI/models/loras and click "Refresh" in ComfyUI.',
          );
        }

        if (!ckptChoices.includes(options.checkpoint)) {
          console.log(chalk.yellow(`Requested checkpoint not found: ${options.checkpoint}`));
          console.log(chalk.yellow(`Available checkpoints: ${ckptChoices.join(', ')}`));
        }
        if (!loraChoices.includes(options.lora)) {
          console.log(chalk.yellow(`Requested LoRA not found: ${options.lora}`));
          console.log(chalk.yellow(`Available LoRAs: ${loraChoices.join(', ')}`));
        }

        const checkpoint = selectModelName(options.checkpoint, ckptChoices);
        const lora = selectModelName(options.lora, loraChoices);
        console.log(chalk.green(`Checkpoint: ${checkpoint}`));
        console.log(chalk.green(`LoRA: ${lora}`));

        const width = options.fast ? 512 : options.width;
        const height = options.fast ? 512 : options.height;
        const steps = options.steps;
        const cfg = options.fast ? 4.5 : options.cfg;
        if (options.fast) {
          console.log(chalk.yellow('Fast mode enabled: 512x512, 12 steps, cfg 4.5'));
        }

        const updatedCards = [...cards];
        let generated = 0;
        let skipped = 0;
        let failed = 0;
        let limitReached = false;

        for (let i = 0; i < cards.length; i += 1) {
          const card = cards[i];
          if (card.icon && !options.overwrite) {
            skipped += 1;
            continue;
          }
          if (options.limit && generated >= options.limit) {
            limitReached = true;
            break;
          }

          const prompt = createPrompt(card);
          const fileName = `${String(i + 1).padStart(3, '0')}-${slugify(card.name)}.png`;
          const outPath = path.join(outputDir, fileName);
          const prefix = `loot_card_icon_${Date.now()}_${i + 1}`;
          const seed = options.seed ? options.seed + i : Math.floor(Math.random() * 0xffffffff);

          console.log(chalk.cyan(`Generating ${i + 1}/${cards.length}: ${card.name}`));
          console.log(chalk.gray(`  prompt: ${prompt}`));

          try {
            const workflow = buildWorkflow({
              checkpoint,
              lora,
              prompt,
              width,
              height,
              seed,
              steps,
              cfg,
              sampler: options.sampler,
              scheduler: options.scheduler,
              denoise: options.denoise,
              prefix,
            });

            const promptId = await queuePrompt(comfyUrl, workflow);
            const images = await waitForImages(comfyUrl, promptId, 5 * 60 * 1000);
            const first = images[0];
            if (!first) throw new Error('No image in ComfyUI history output.');

            const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(first.filename)}&subfolder=${encodeURIComponent(first.subfolder || '')}&type=${encodeURIComponent(first.type || 'output')}`;
            const imageData = await fetchBuffer(viewUrl);
            fs.writeFileSync(outPath, imageData);

            const relativeIconPath = path.relative(yamlDir, outPath).split(path.sep).join('/');
            updatedCards[i] = { ...card, icon: relativeIconPath };
            generated += 1;
          } catch (err) {
            failed += 1;
            console.error(chalk.red(`  failed: ${err.message}`));
          }
        }

        if (options.writeYaml || options.inPlace) {
          const target = path.resolve(options.inPlace ? input : options.writeYaml);
          const text = yaml.dump({ cards: updatedCards }, { noRefs: true, lineWidth: 120 });
          fs.writeFileSync(target, text, 'utf8');
          console.log(chalk.green(`Updated YAML written to ${target}`));
        }

        if (limitReached) {
          console.log(chalk.yellow(`Stopped early due to --limit ${options.limit}.`));
        }
        console.log(chalk.green(`Done. generated=${generated} skipped=${skipped} failed=${failed}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  program.parse();
}
