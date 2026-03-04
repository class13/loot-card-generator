import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { program } from 'commander';
import chalk from 'chalk';
import { loadYaml } from './loader.js';

function toPosInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toFloatInRange(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJsonObject(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model response did not include a JSON object.');
  }

  const candidate = trimmed.slice(start, end + 1);
  return JSON.parse(candidate);
}

function buildSystemPrompt() {
  return [
    'You are a prompt compiler for Stable Diffusion XL.',
    'Your job is to convert a Dungeons & Dragons item into a structured Stable Diffusion prompt optimized for a single isolated item image for use on a printable card.',
    'STRICT RULES:',
    '1. Always assume the image should show a SINGLE object.',
    '2. The object must be centered and isolated.',
    '3. The object must be clearly readable at small size.',
    '4. Do NOT describe full scenes or environments.',
    '5. Do NOT include characters unless the item absolutely requires it.',
    '6. Avoid cinematic language.',
    '7. Avoid storytelling.',
    '8. Focus on physical attributes: material, shape, color, craftsmanship, motifs.',
    '9. Keep output concise but visually precise.',
    'You MUST output valid JSON in this exact format:',
    '{"category":"...","positive_prompt":"...","negative_prompt":"..."}',
    'CATEGORY RULES:',
    'Classify the item into one of these only: weapon, armor, clothing, jewelry, potion, scroll, book, tool, container, artifact, other.',
    'POSITIVE PROMPT STRUCTURE:',
    'Begin with: "single fantasy [CATEGORY] item, centered, isolated object, clean background, one subject, full object in frame, no repeated elements,"',
    'Then describe: material, color, shape, craftsmanship, distinctive magical detail.',
    'End with: "high detail, sharp focus, game asset illustration, studio lighting".',
    'NEGATIVE PROMPT RULES:',
    'Always include: "text, watermark, logo, blurry, low detail, cropped, multiple objects, repeated objects, duplicates, grid layout, tiled pattern, contact sheet, sprite sheet, collage, background scenery".',
    'Additionally exclude objects from other categories when relevant.',
    'If clothing, also exclude: gem, ring, necklace, weapon.',
    'If weapon, also exclude: potion, gem, clothing.',
    'If potion, also exclude: weapon, armor, character.',
    'Do not output anything except valid JSON.',
  ].join('\n');
}

function buildUserPrompt(card) {
  const parts = [
    `name: ${cleanText(card.name)}`,
    `rarity: ${cleanText(card.rarity)}`,
  ];

  if (card.type) parts.push(`type: ${cleanText(card.type)}`);
  if (card.tags?.length) parts.push(`tags: ${card.tags.map(cleanText).join(', ')}`);
  if (card.description) parts.push(`description: ${cleanText(card.description)}`);
  if (card.flavor) parts.push(`flavor: ${cleanText(card.flavor)}`);

  return [
    'Create a Stable Diffusion XL prompt package for this fantasy loot item.',
    'Keep prompts concise.',
    'No artist names.',
    'Output JSON only.',
    parts.join('\n'),
  ].join('\n\n');
}

async function fetchJson(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${url}: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }

  return res.json();
}

async function generatePromptsWithOllama(opts) {
  const payload = {
    model: opts.model,
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(opts.card),
    stream: false,
    options: {
      temperature: opts.temperature,
      top_p: opts.topP,
      num_predict: opts.maxTokens,
    },
  };

  const data = await fetchJson(`${opts.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const responseText = cleanText(data?.response || '');
  if (!responseText) {
    throw new Error('Ollama returned an empty response.');
  }

  let parsed;
  try {
    parsed = extractJsonObject(responseText);
  } catch (err) {
    throw new Error(`Could not parse model output as JSON: ${err.message}. Raw: ${responseText.slice(0, 250)}`);
  }

  const prompt = cleanText(parsed?.positive_prompt || parsed?.prompt);
  const negativePrompt = cleanText(parsed?.negative_prompt);
  const category = cleanText(parsed?.category).toLowerCase();
  const allowedCategories = new Set([
    'weapon',
    'armor',
    'clothing',
    'jewelry',
    'potion',
    'scroll',
    'book',
    'tool',
    'container',
    'artifact',
    'other',
  ]);

  if (!prompt || !negativePrompt) {
    throw new Error(`Model JSON missing required fields. Raw: ${responseText.slice(0, 250)}`);
  }
  if (!allowedCategories.has(category)) {
    throw new Error(`Model JSON has invalid or missing category. Raw: ${responseText.slice(0, 250)}`);
  }

  return { category, prompt, negativePrompt };
}

export function runPromptGenerator() {
  program
    .name('loot-card-prompts')
    .description('Generate Stable Diffusion prompt fields in loot card YAML using local Ollama')
    .version('1.0.0')
    .argument('<input>', 'YAML file path')
    .option('--ollama-url <url>', 'Ollama base URL', 'http://localhost:11434')
    .option('--model <name>', 'Ollama model name', 'llama3.1')
    .option('--temperature <n>', 'Sampling temperature', (v) => toFloatInRange(v, 0.2, 0, 2), 0.2)
    .option('--top-p <n>', 'Top-p sampling value', (v) => toFloatInRange(v, 0.9, 0, 1), 0.9)
    .option('--max-tokens <n>', 'Max generated tokens', (v) => toPosInt(v, 220), 220)
    .option('--limit <n>', 'Generate only first N eligible cards', (v) => toPosInt(v, null))
    .option('--overwrite', 'Regenerate even if prompt fields already exist')
    .option('--write-yaml <path>', 'Write output YAML to a new file')
    .option('--in-place', 'Overwrite input YAML file (default behavior)')
    .action(async (input, options) => {
      try {
        if (options.writeYaml && options.inPlace) {
          throw new Error('Use either --write-yaml or --in-place, not both.');
        }

        const { cards } = loadYaml(input);
        const eligible = cards.filter((card) => {
          if (options.overwrite) return true;
          return !card.prompt || !card.negative_prompt;
        });

        const selected = Number.isFinite(options.limit)
          ? eligible.slice(0, Math.max(options.limit, 0))
          : eligible;

        if (!selected.length) {
          console.log(chalk.yellow('No eligible cards found. Use --overwrite to regenerate existing fields.'));
          return;
        }

        console.log(chalk.cyan(`Generating prompts for ${selected.length} card(s) using model '${options.model}'...`));

        for (const card of selected) {
          const index = cards.indexOf(card);
          console.log(chalk.cyan(`- ${card.name}`));
          const { category, prompt, negativePrompt } = await generatePromptsWithOllama({
            ollamaUrl: options.ollamaUrl,
            model: options.model,
            temperature: options.temperature,
            topP: options.topP,
            maxTokens: options.maxTokens,
            card,
          });
          cards[index] = { ...cards[index], category, prompt, negative_prompt: negativePrompt };
        }

        const target = path.resolve(options.writeYaml || input);
        const text = yaml.dump({ cards }, { noRefs: true, lineWidth: 120 });
        fs.writeFileSync(target, text, 'utf8');

        console.log(chalk.green(`Updated YAML written to ${target}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exitCode = 1;
      }
    });

  program.parse(process.argv);
}
