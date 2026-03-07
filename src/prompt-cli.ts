import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { program } from 'commander';
import chalk from 'chalk';
import { loadYaml } from './loader.js';
import { assertCardPromptGenerator } from './prompt-generation/card-prompt-generator.js';
import { OllamaCardPromptGenerator } from './prompt-generation/ollama-card-prompt-generator.js';

type LootCard = {
  name: string;
  prompt?: string;
  negative_prompt?: string;
  category?: string;
  [key: string]: unknown;
};

type PromptCliOptions = {
  ollamaUrl: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  limit: number | null;
  overwrite?: boolean;
  writeYaml?: string;
  inPlace?: boolean;
};

function toPosInt(value: string, fallback: number | null): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toFloatInRange(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

export function runPromptGenerator(): void {
  program
    .name('loot-card-prompts')
    .description('Generate Stable Diffusion prompt fields in loot card YAML using local Ollama')
    .version('1.0.0')
    .argument('<input>', 'YAML file path')
    .option('--ollama-url <url>', 'Ollama base URL', 'http://localhost:11434')
    .option('--model <name>', 'Ollama model name', 'llama3.1:8b')
    .option('--temperature <n>', 'Sampling temperature', (v: string) => toFloatInRange(v, 0.2, 0, 2), 0.2)
    .option('--top-p <n>', 'Top-p sampling value', (v: string) => toFloatInRange(v, 0.9, 0, 1), 0.9)
    .option('--max-tokens <n>', 'Max generated tokens', (v: string) => toPosInt(v, 220), 220)
    .option('--limit <n>', 'Generate only first N eligible cards', (v: string) => toPosInt(v, null))
    .option('--overwrite', 'Regenerate even if prompt fields already exist')
    .option('--write-yaml <path>', 'Write output YAML to a new file')
    .option('--in-place', 'Overwrite input YAML file (default behavior)')
    .action(async (input: string, rawOptions: PromptCliOptions) => {
      try {
        const options = rawOptions;

        if (options.writeYaml && options.inPlace) {
          throw new Error('Use either --write-yaml or --in-place, not both.');
        }

        const { cards: untypedCards } = loadYaml(input) as { cards: LootCard[] };
        const cards = untypedCards;
        const eligible = cards.filter((card) => {
          if (options.overwrite) return true;
          return !card.prompt || !card.negative_prompt;
        });

        const selected = Number.isFinite(options.limit)
          ? eligible.slice(0, Math.max(options.limit ?? 0, 0))
          : eligible;

        if (!selected.length) {
          console.log(chalk.yellow('No eligible cards found. Use --overwrite to regenerate existing fields.'));
          return;
        }

        console.log(chalk.cyan(`Generating prompts for ${selected.length} card(s) using model '${options.model}'...`));
        const generator = assertCardPromptGenerator(new OllamaCardPromptGenerator({
          ollamaUrl: options.ollamaUrl,
          model: options.model,
          temperature: options.temperature,
          topP: options.topP,
          maxTokens: options.maxTokens,
        }));

        const target = path.resolve(options.writeYaml || input);
        const persistYaml = (): void => {
          const text = yaml.dump({ cards }, { noRefs: true, lineWidth: 120 });
          fs.writeFileSync(target, text, 'utf8');
        };

        for (const card of selected) {
          const index = cards.indexOf(card);
          console.log(chalk.cyan(`- ${card.name}`));
          const { prompt } = await generator.generateForCard(card);
          cards[index] = { ...cards[index], prompt };
          persistYaml();
        }

        console.log(chalk.green(`Updated YAML written to ${target}`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });

  program.parse(process.argv);
}
