import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';

const rarityValues = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];

const CardSchema = z.object({
  name: z.string().min(1),
  rarity: z.enum(rarityValues),
  quantity: z.number().int().positive().optional(),
  type: z.string().optional(),
  description: z.string().min(1),
  flavor: z.string().optional(),
  price: z.string().optional(),
  icon: z.string().optional(),
  imagePrompt: z.string().optional(),
  category: z.string().optional(),
  prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

const LootFileSchema = z.object({
  cards: z.array(CardSchema).min(1),
});

/**
 * @param {string} filePath - Absolute or relative path to YAML file
 * @returns {{ cards: object[], yamlDir: string }}
 */
export function loadYaml(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`Failed to parse YAML: ${err.message}`);
  }
  const result = LootFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`YAML validation errors:\n${issues}`);
  }
  return {
    cards: result.data.cards,
    yamlDir: path.dirname(resolved),
  };
}
