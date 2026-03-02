import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = path.resolve(__dirname, '..', 'styles');

/**
 * Build a concatenated <style> block from:
 *   1. styles/default.css  (D&D theme)
 *   2. styles/print.css    (A4 grid layout)
 *   3. customCssPath       (user override, if provided)
 *
 * Returns a string of <style>...</style> HTML.
 *
 * @param {string|undefined} customCssPath
 * @returns {string}
 */
export function buildStyleBlock(customCssPath) {
  const files = [
    path.join(STYLES_DIR, 'default.css'),
    path.join(STYLES_DIR, 'print.css'),
  ];

  if (customCssPath) {
    const resolved = path.resolve(customCssPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Custom theme file not found: ${resolved}`);
    }
    files.push(resolved);
  }

  const combined = files
    .map((f) => `/* === ${path.basename(f)} === */\n${fs.readFileSync(f, 'utf8')}`)
    .join('\n\n');

  return `<style>\n${combined}\n</style>`;
}
