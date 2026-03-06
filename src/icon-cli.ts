import fs from 'fs';
import path from 'path';
import {randomUUID} from 'crypto';
import yaml from 'js-yaml';
import {program} from 'commander';
import chalk from 'chalk';
import {loadYaml} from './loader.js';

const NEGATIVE_PROMPT = `(blurry:1.3). lowres.`;
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const DEFAULT_STEPS = 40;
const DEFAULT_CFG = 6;
const DEFAULT_LORA = 'game_icon_v1.0.safetensors';
const DEFAULT_LORA_STRENGTH = 1;
const GENERATION_TIMEOUT = 15 * 60 * 1000;

interface LootCard {
  name: string;
  type?: string;
  icon?: string;
  imagePrompt?: string;
  prompt?: string;
  negative_prompt?: string;
}

interface LoadYamlResult {
  cards: LootCard[];
  yamlDir: string;
}

interface PromptResolution {
  prompt: string;
  negativePrompt: string;
  fromYaml: boolean;
}

interface WorkflowBuildParams {
  checkpoint: string;
  lora: string;
  loraStrengthModel: number;
  loraStrengthClip: number;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  prefix: string;
}

interface GeneratedImage {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface CliOptions {
  comfyUrl: string;
  outDir?: string;
  checkpoint: string;
  lora: string;
  loraStrengthModel: number;
  loraStrengthClip: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  seed: number | null;
  draft?: boolean;
  fast?: boolean;
  limit: number | null;
  listModels?: boolean;
  overwrite?: boolean;
  writeYaml?: string;
  inPlace?: boolean;
}

interface ComfyUIOptions {
  comfyUrl: string;
  checkpoint: string;
  lora: string;
  loraStrengthModel: number;
  loraStrengthClip: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  seed: number | null;
  draft?: boolean;
  fast?: boolean;
  limit: number | null;
  listModels?: boolean;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

function createPrompt(card: LootCard): string {
  const subject = (card.imagePrompt || card.name || card.type || 'fantasy item')
    .trim()
    .replace(/[.。]+$/g, '');
  return `2d icon. ${subject}. white background.`;
}

function resolvePrompts(card: LootCard): PromptResolution {
  const positive = String(card.prompt || '').trim();
  const negative = String(card.negative_prompt || '').trim();

  return {
    prompt: positive || createPrompt(card),
    negativePrompt: negative || NEGATIVE_PROMPT,
    fromYaml: Boolean(positive || negative),
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`Could not reach ComfyUI at ${url}: ${getErrorMessage(err)}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Could not download image from ${url}: ${getErrorMessage(err)}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

interface ComfyUIConfiguration {
  baseUrl: string;
}

class ComfyUIImpl {
  private config: ComfyUIConfiguration;

  constructor(config: ComfyUIConfiguration) {
    this.config = config
  }

  // todo: baseUrl as field param
  async ensureComfyAvailable(): Promise<void> {
    try {
      await fetchJson(`${this.config.baseUrl}/system_stats`);
    } catch (err) {
      throw new Error(
          `ComfyUI is not reachable at ${this.config.baseUrl}. Make sure ComfyUI is started and the URL is correct. (${getErrorMessage(err)})`,
      );
    }
  }


  // todo: baseUrl as field param
  async listModels(kind: string): Promise<string[]> {
    try {
      const data = await fetchJson<unknown>(`${this.config.baseUrl}/models/${encodeURIComponent(kind)}`);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  // todo: baseUrl as field param
  async listNodeChoices(nodeType: string, inputName: string): Promise<string[]> {
    try {
      const info = await fetchJson<Record<string, any>>(
          `${this.config.baseUrl}/object_info/${encodeURIComponent(nodeType)}`,
      );
      const values = info?.[nodeType]?.input?.required?.[inputName]?.[0];
      return Array.isArray(values) ? values : [];
    } catch {
      return [];
    }
  }


  selectModelName(preferred: string, choices: string[]): string {
    if (!choices.length) return preferred;
    if (choices.includes(preferred)) return preferred;

    const preferredBase = preferred.replace(/\.[^.]+$/, '').toLowerCase();
    const exactBase = choices.find((c) => c.replace(/\.[^.]+$/, '').toLowerCase() === preferredBase);
    if (exactBase) return exactBase;

    const fuzzy = choices.find((c) => c.toLowerCase().includes(preferredBase));
    if (fuzzy) return fuzzy;

    return choices[0];
  }

  buildWorkflow(params: WorkflowBuildParams): Record<string, unknown> {
    const {
      checkpoint,
      lora,
      loraStrengthModel,
      loraStrengthClip,
      prompt,
      negativePrompt,
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
      '8': {
        class_type: 'LoraLoader',
        inputs: {
          model: ['1', 0],
          clip: ['1', 1],
          lora_name: lora,
          strength_model: loraStrengthModel,
          strength_clip: loraStrengthClip,
        },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: prompt,
          clip: ['8', 1],
        },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: negativePrompt,
          clip: ['8', 1],
        },
      },
      '4': {
        class_type: 'EmptyLatentImage',
        inputs: {
          width,
          height,
          batch_size: 1,
        },
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          model: ['8', 0],
          seed,
          steps,
          cfg,
          sampler_name: sampler,
          scheduler,
          denoise,
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
      '6': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['5', 0],
          vae: ['1', 2],
        },
      },
      '7': {
        class_type: 'SaveImage',
        inputs: {
          filename_prefix: prefix,
          images: ['6', 0],
        },
      },
    };
  }

  async waitForImages(promptId: string, timeoutMs: number): Promise<GeneratedImage[]> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const history = await fetchJson<Record<string, any>>(
          `${this.config.baseUrl}/history/${encodeURIComponent(promptId)}`,
      );
      const job = history?.[promptId];
      const outputs = job?.outputs;
      if (outputs) {
        const images: GeneratedImage[] = [];
        for (const output of Object.values(outputs) as Array<{ images?: GeneratedImage[] }>) {
          if (Array.isArray(output.images)) images.push(...output.images);
        }
        if (images.length) return images;
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    throw new Error(`Timed out waiting for prompt ${promptId}`);
  }

  // todo: comfyUI
  async queuePrompt(workflow: Record<string, unknown>): Promise<string> {
    const clientId = randomUUID();
    const payload = { prompt: workflow, client_id: clientId };
    const data = await fetchJson<{ prompt_id?: string }>(`${this.config.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!data.prompt_id) {
      throw new Error('ComfyUI did not return a prompt_id.');
    }
    return data.prompt_id;
  }

}

function toPosInt(value: string, fallback: number | null): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toPosFloat(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}


// todo: extract this as an interface
export function runIconGenerator(): void {
  program
    .name('loot-card-icons')
    .description('Generate local icon images from loot card YAML using ComfyUI + SDXL + LoRA')
    .version('1.0.0')
    .argument('<input>', 'YAML file path')
    .option('--comfy-url <url>', 'ComfyUI base URL', 'http://localhost:8000')
    .option('--out-dir <path>', 'Output icon directory, default: <yaml-dir>/icons')
    .option('--checkpoint <name>', 'Checkpoint model name in ComfyUI', 'sd_xl_base_1.0.safetensors')
    .option('--lora <name>', 'LoRA model name in ComfyUI', DEFAULT_LORA)
    .option(
      '--lora-strength-model <n>',
      'LoRA strength for model branch',
      (v: string) => toPosFloat(v, DEFAULT_LORA_STRENGTH),
      DEFAULT_LORA_STRENGTH,
    )
    .option(
      '--lora-strength-clip <n>',
      'LoRA strength for CLIP branch',
      (v: string) => toPosFloat(v, DEFAULT_LORA_STRENGTH),
      DEFAULT_LORA_STRENGTH,
    )
    .option('--width <n>', 'Image width', (v: string) => toPosInt(v, DEFAULT_WIDTH), DEFAULT_WIDTH)
    .option('--height <n>', 'Image height', (v: string) => toPosInt(v, DEFAULT_HEIGHT), DEFAULT_HEIGHT)
    .option('--steps <n>', 'Sampling steps', (v: string) => toPosInt(v, DEFAULT_STEPS), DEFAULT_STEPS)
    .option('--cfg <n>', 'CFG scale', (v: string) => toPosFloat(v, DEFAULT_CFG), DEFAULT_CFG)
    .option('--sampler <name>', 'Sampler name', 'euler')
    .option('--scheduler <name>', 'Scheduler name', 'normal')
    .option('--denoise <n>', 'Denoise value', (v: string) => toPosFloat(v, 1), 1)
    .option('--seed <n>', 'Base seed for deterministic runs', (v: string) => toPosInt(v, null), null)
    .option('--draft', 'Use quick draft settings (512x512, 16 steps, cfg 5)')
    .option('--fast', 'Alias for --draft')
    .option('--limit <n>', 'Generate only the first N eligible cards', (v: string) => toPosInt(v, null), null)
    .option('--list-models', 'List checkpoint and LoRA names visible to ComfyUI and exit')
    .option('--overwrite', 'Regenerate even when card already has icon')
    .option('--write-yaml <path>', 'Write a YAML file with updated icon fields')
    .option('--in-place', 'Overwrite the input YAML with updated icon fields')
    .action(async (input: string, options: CliOptions) => {
      try {
        if (options.writeYaml && options.inPlace) {
          throw new Error('Use either --write-yaml or --in-place, not both.');
        }

        const { cards, yamlDir } = loadYaml(input) as LoadYamlResult;

        
        const outputDir = path.resolve(options.outDir || path.join(yamlDir, 'icons'));
        fs.mkdirSync(outputDir, { recursive: true });

        const comfyOptions: ComfyUIOptions = {
          checkpoint: options.checkpoint,
          cfg: options.cfg,
          comfyUrl: options.comfyUrl,
          denoise: options.denoise,
          height: options.height,
          limit: options.limit,
          lora: options.lora,
          loraStrengthClip: options.loraStrengthClip,
          loraStrengthModel: options.loraStrengthModel,
          sampler: options.sampler,
          scheduler: options.scheduler,
          seed: options.seed,
          steps: options.steps,
          width:options.width,
        }
        
        // todo: comfy specific
        const comfyUrl = comfyOptions.comfyUrl.replace(/\/+$/, '');

        let comfyUI = new ComfyUIImpl({
          baseUrl: comfyUrl

        })

        // todo: comfy specific
        await comfyUI.ensureComfyAvailable();
        console.log(chalk.cyan('Loading ComfyUI model metadata...'));
        const [ckptFromModels, ckptFromNode, loraFromModels, loraFromNode] = await Promise.all([
          comfyUI.listModels('checkpoints'),
          comfyUI.listNodeChoices('CheckpointLoaderSimple', 'ckpt_name'),
          comfyUI.listModels('loras'),
          comfyUI.listNodeChoices('LoraLoader', 'lora_name'),
        ]);
        const ckptChoices = ckptFromModels.length ? ckptFromModels : ckptFromNode;
        const loraChoices = loraFromModels.length ? loraFromModels : loraFromNode;


        // todo: remove listModels
        if (comfyOptions.listModels) { // todo: extract comfy options
          console.log(chalk.cyan('Checkpoints:'));
          console.log(ckptChoices.length ? ckptChoices.join('\n') : '(none)');
          console.log(chalk.cyan('\nLoRAs:'));
          console.log(loraChoices.length ? loraChoices.join('\n') : '(none)');
          return;
        }

        if (!ckptChoices.length) {
          throw new Error(
            'ComfyUI is running, but no checkpoint models were found. Put an SDXL checkpoint in ComfyUI/models/checkpoints and click "Refresh" in ComfyUI.',
          );
        }
        if (!loraChoices.length) {
          throw new Error(
            'ComfyUI is running, but no LoRA models were found. Put game_icon_v1.0.safetensors in ComfyUI/models/loras and click "Refresh" in ComfyUI.',
          );
        }

        if (!ckptChoices.includes(comfyOptions.checkpoint)) { 
          console.log(chalk.yellow(`Requested checkpoint not found: ${comfyOptions.checkpoint}`)); 
          console.log(chalk.yellow(`Available checkpoints: ${ckptChoices.join(', ')}`));
        }
        if (!loraChoices.includes(comfyOptions.lora)) { 
          console.log(chalk.yellow(`Requested LoRA not found: ${comfyOptions.lora}`)); 
          console.log(chalk.yellow(`Available LoRAs: ${loraChoices.join(', ')}`));
        }

        const checkpoint = comfyUI.selectModelName(comfyOptions.checkpoint, ckptChoices);
        const lora = comfyUI.selectModelName(comfyOptions.lora, loraChoices);
        console.log(chalk.green(`Checkpoint: ${checkpoint}`));
        console.log(
          chalk.green(`LoRA: ${lora} (model=${comfyOptions.loraStrengthModel}, clip=${comfyOptions.loraStrengthClip})`), 
        );

        let width = comfyOptions.width; 
        let height = comfyOptions.height; 
        let steps = comfyOptions.steps; 
        let cfg = comfyOptions.cfg; 

        if (comfyOptions.draft || comfyOptions.fast) { 
          width = 512;
          height = 512;
          steps = 16;
          cfg = 5;
          console.log(chalk.yellow('Using draft settings: 512x512, 16 steps, cfg 5'));
        } else {
          console.log(chalk.cyan(`Using settings: ${width}x${height}, steps=${steps}, cfg=${cfg}`));
        }

        const updatedCards = [...cards];
        const shouldPersistYaml = Boolean(options.writeYaml || options.inPlace);
        const targetYamlPath = shouldPersistYaml
          ? path.resolve(options.inPlace ? input : options.writeYaml as string)
          : null;
        const persistYaml = () => {
          if (!shouldPersistYaml || !targetYamlPath) return;
          const text = yaml.dump({ cards: updatedCards }, { noRefs: true, lineWidth: 120 });
          fs.writeFileSync(targetYamlPath, text, 'utf8');
        };

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

          const { prompt, negativePrompt, fromYaml } = resolvePrompts(card);
          const fileName = `${String(i + 1).padStart(3, '0')}-${slugify(card.name)}.png`;
          const outPath = path.join(outputDir, fileName);
          const prefix = `loot_card_icon_${Date.now()}_${i + 1}`;
          const seed = options.seed ? options.seed + i : Math.floor(Math.random() * 0xffffffff);

          console.log(chalk.cyan(`Generating ${i + 1}/${cards.length}: ${card.name}`));
          if (fromYaml) {
            console.log(chalk.gray('  using YAML prompt fields'));
          }
          console.log(chalk.gray(`  prompt: ${prompt}`));
          console.log(chalk.gray(`  negative: ${negativePrompt}`));

          try {
            let params: WorkflowBuildParams = {
              checkpoint,
              lora,
              loraStrengthModel: options.loraStrengthModel,
              loraStrengthClip: options.loraStrengthClip,
              prompt,
              negativePrompt,
              width,
              height,
              seed,
              steps,
              cfg,
              sampler: options.sampler,
              scheduler: options.scheduler,
              denoise: options.denoise,
              prefix,
            };
            const workflow = comfyUI.buildWorkflow(params);

            const promptId = await comfyUI.queuePrompt(workflow);
            const images = await comfyUI.waitForImages(promptId, GENERATION_TIMEOUT);
            const first = images[0];
            if (!first) throw new Error('No image in ComfyUI history output.');

            const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(first.filename)}&subfolder=${encodeURIComponent(first.subfolder || '')}&type=${encodeURIComponent(first.type || 'output')}`;
            const imageData = await fetchBuffer(viewUrl);
            fs.writeFileSync(outPath, imageData);

            const relativeIconPath = path.relative(yamlDir, outPath).split(path.sep).join('/');
            updatedCards[i] = { ...card, icon: relativeIconPath };
            persistYaml();
            generated += 1;
          } catch (err) {
            failed += 1;
            console.error(chalk.red(`  failed: ${getErrorMessage(err)}`));
          }
        }

        if (shouldPersistYaml) {
          persistYaml();
          console.log(chalk.green(`Updated YAML written to ${targetYamlPath}`));
        }

        if (limitReached) {
          console.log(chalk.yellow(`Stopped early due to --limit ${options.limit}.`)); 
        }
        console.log(chalk.green(`Done. generated=${generated} skipped=${skipped} failed=${failed}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
        process.exit(1);
      }
    });

  program.parse();
}
