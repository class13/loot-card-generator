/**
 * Run this once to create a simple parchment-like SVG texture.
 * Usage: node assets/generate-parchment.js
 *
 * For a better result, replace assets/parchment.jpg with a real
 * high-resolution parchment photo. Free options:
 *   • https://unsplash.com/s/photos/parchment
 *   • https://www.toptal.com/designers/subtlepatterns/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A simple SVG that looks vaguely parchment-like via filters
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">
  <defs>
    <filter id="paper">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3"
                    stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
      <feBlend in="SourceGraphic" in2="grey" mode="multiply"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="#e8d5a3"/>
  <rect width="100%" height="100%" fill="#c4a265" opacity="0.25" filter="url(#paper)"/>
  <!-- Vignette -->
  <radialGradient id="vig" cx="50%" cy="50%" r="70%">
    <stop offset="0%"   stop-color="transparent"/>
    <stop offset="100%" stop-color="rgba(80,40,0,0.45)"/>
  </radialGradient>
  <rect width="100%" height="100%" fill="url(#vig)"/>
</svg>`;

const outPath = path.join(__dirname, 'parchment.jpg');
// We save it as SVG first — the renderer will detect the extension
const svgPath = path.join(__dirname, 'parchment.svg');
fs.writeFileSync(svgPath, svg, 'utf8');
console.log(`Wrote ${svgPath}`);
console.log('Rename/copy to parchment.jpg if you want JPEG, or update src/images.js MIME_MAP.');
