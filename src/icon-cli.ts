import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {program} from 'commander';
import chalk from 'chalk';
import {loadYaml} from './loader.js';
import {ComfyUIImageGenerator} from "./image-generation/comfy-ui/comfy-ui-image-generator.js";
import {ImageGenerator} from "./image-generation/image-generator.js";
import {ImageParameters} from "./image-generation/image-parameters.js";
import {ComfyUIOptions} from "./comfy-ui-options.js";

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const DEFAULT_STEPS = 40;
const DEFAULT_CFG = 6;
const DEFAULT_LORA = 'game_icon_v1.0.safetensors';
const DEFAULT_LORA_STRENGTH = 1;


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
  seed: number;
  limit: number | null;
  listModels?: boolean;
  overwrite?: boolean;
  writeYaml?: string;
  inPlace?: boolean;
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

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


function toPosInt(value: string, fallback: number | null): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toPosFloat(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
    .option('--limit <n>', 'Generate only the first N eligible cards', (v: string) => toPosInt(v, null), null)
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
        
        const comfyUrl = comfyOptions.comfyUrl.replace(/\/+$/, '');

        let comfyUI = new ComfyUIImageGenerator({
          baseUrl: comfyUrl

        })
        await comfyUI.init(comfyOptions)

        let generator: ImageGenerator = comfyUI



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

          const prompt = String(card.prompt || '').trim();
          const negativePrompt = String(card.negative_prompt || '').trim();

          const fileName = `${String(i + 1).padStart(3, '0')}-${slugify(card.name)}.png`;
          const outPath = path.join(outputDir, fileName);
          const prefix = `loot_card_icon_${Date.now()}_${i + 1}`;

          console.log(chalk.cyan(`Generating ${i + 1}/${cards.length}: ${card.name}`));
          console.log(chalk.gray(`  prompt: ${prompt}`));
          console.log(chalk.gray(`  negative: ${negativePrompt}`));

          try {
            let imageParameters: ImageParameters = {
              prompt: prompt,
              negativePrompt: negativePrompt,
              prefix: prefix
            }
            const imageData = await generator.createImage(imageParameters);
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
