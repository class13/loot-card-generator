import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keywordMap = JSON.parse(
  readFileSync(path.join(__dirname, '../data/icon-keywords.json'), 'utf8'),
);

/**
 * Find a game-icons.net CDN URL for a card that has no explicit icon.
 * Matches against card name, type, and tags using the curated keyword map.
 *
 * @param {{ name?: string, type?: string, tags?: string[] }} card
 * @returns {string|null} A game-icons CDN URL, or null if no match found.
 */
export function findIconUrl(card) {
  const text = [card.name ?? '', card.type ?? '', ...(card.tags ?? [])].join(' ');
  const words = text.toLowerCase().split(/[\s,()_\-+/]+/).filter(Boolean);

  // 1. Exact word match — fastest and most precise
  for (const word of words) {
    if (keywordMap[word]) return keywordMap[word];
  }

  // 2. Substring match — catches "longsword" → "sword", "flaming" → "flame", etc.
  for (const word of words) {
    for (const [key, url] of Object.entries(keywordMap)) {
      if (word.includes(key) || key.includes(word)) return url;
    }
  }

  return null;
}
