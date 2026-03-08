import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Resolve an icon path to a usable src value for an <img> tag.
 * - HTTP/HTTPS URLs are returned as-is (Puppeteer fetches them).
 * - Local paths are resolved relative to yamlDir and returned as file:// URLs.
 * - Missing files log a warning and return null.
 *
 * @param {string} iconPath
 * @param {string} yamlDir
 * @returns {string|null}
 */
export function resolveIcon(iconPath, yamlDir) {
  if (!iconPath) return null;

  if (/^https?:\/\//i.test(iconPath)) {
    return iconPath;
  }

  const resolved = path.resolve(yamlDir, iconPath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[warn] Icon not found, skipping: ${resolved}`);
    return null;
  }

  // file:// URLs avoid huge inlined base64 HTML payloads and reduce memory
  // pressure during PDF rendering for large card batches.
  return pathToFileURL(resolved).href;
}

/**
 * Read an image file and return a base64 data URI.
 *
 * @param {string} absolutePath
 * @returns {string|null}
 */
export function fileToDataUri(absolutePath) {
  if (!fs.existsSync(absolutePath)) return null;
  const ext = path.extname(absolutePath).toLowerCase();
  const mime = MIME_MAP[ext] ?? 'application/octet-stream';
  const data = fs.readFileSync(absolutePath).toString('base64');
  return `data:${mime};base64,${data}`;
}
