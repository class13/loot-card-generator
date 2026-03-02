import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import { resolveIcon, fileToDataUri } from './images.js';
import { buildStyleBlock } from './theme.js';
import { findIconUrl } from './icon-finder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates');
const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');

/**
 * Convert minimal Markdown (`**bold**`, `*italic*`) to HTML.
 * Runs in two passes to avoid conflicts.
 *
 * @param {string} text
 * @returns {string}
 */
function miniMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

/**
 * Chunk an array into groups of `size`.
 *
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
function chunk(arr, size) {
  const pages = [];
  for (let i = 0; i < arr.length; i += size) {
    pages.push(arr.slice(i, i + size));
  }
  return pages;
}

/**
 * Build the full HTML document for all cards.
 *
 * @param {object[]} cards
 * @param {object} opts
 * @param {string}  opts.yamlDir
 * @param {number}  opts.columns
 * @param {number}  opts.rows
 * @param {string}  [opts.customCssPath]
 * @param {boolean} [opts.bleed]
 * @returns {string}
 */
export async function renderHtml(cards, opts) {
  const { yamlDir, columns, rows, customCssPath, bleed = true, autoIcon = false } = opts;
  const cardsPerPage = columns * rows;

  // ── Load & register card partial ────────────────────────────
  const cardTemplate = fs.readFileSync(
    path.join(TEMPLATES_DIR, 'card.hbs'),
    'utf8',
  );
  Handlebars.registerPartial('card', cardTemplate);
  const cardPartial = Handlebars.compile('{{> card}}');

  // ── Resolve icons & process descriptions ───────────────────
  const processedCards = cards.map((card) => {
    const iconSource = card.icon ?? (autoIcon ? findIconUrl(card) : null);
    return {
      ...card,
      icon: iconSource ? resolveIcon(iconSource, yamlDir) : null,
      descriptionHtml: miniMarkdown(card.description),
      // CSS class-safe rarity (spaces → hyphens handled in CSS with escape)
      rarityClass: card.rarity.replace(/\s+/g, '-'),
    };
  });

  // ── Parchment texture ───────────────────────────────────────
  // Prefer .jpg → .png → .svg, whichever exists first
  const parchmentCandidates = ['parchment.jpg', 'parchment.png', 'parchment.svg'];
  let parchmentUri = null;
  for (const name of parchmentCandidates) {
    parchmentUri = fileToDataUri(path.join(ASSETS_DIR, name));
    if (parchmentUri) break;
  }
  const parchmentVar = parchmentUri
    ? `url("${parchmentUri}")`
    : 'none';

  // ── CSS ──────────────────────────────────────────────────────
  const styleBlock = buildStyleBlock(customCssPath);

  // ── Grid vars injected inline ───────────────────────────────
  const gridVars = `<style>
:root {
  --columns: ${columns};
  --rows: ${rows};
  --parchment-url: ${parchmentVar};
}
</style>`;

  // ── Chunk cards into pages ──────────────────────────────────
  const pages = chunk(processedCards, cardsPerPage);

  // ── Render each page ────────────────────────────────────────
  const bleedClass = bleed ? ' page--bleed' : '';
  const pagesHtml = pages
    .map((pageCards, idx) => {
      const isLast = idx === pages.length - 1;
      const pageClass = `page${bleedClass}${isLast ? ' page--last' : ''}`;
      const cardsHtml = pageCards.map((c) => cardPartial(c)).join('\n');
      return `<div class="${pageClass}">\n${cardsHtml}\n</div>`;
    })
    .join('\n');

  // ── Full HTML document ──────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Loot Cards</title>
  ${styleBlock}
  ${gridVars}
</head>
<body>
${pagesHtml}
</body>
</html>`;
}
