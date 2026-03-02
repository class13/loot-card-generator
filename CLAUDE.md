# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Generate a PDF from a YAML file
node bin/loot-cards.js examples/loot.yaml -o output.pdf

# Dump HTML for visual inspection in a browser (fast, no PDF)
node bin/loot-cards.js examples/loot.yaml --debug-html /tmp/preview.html && open /tmp/preview.html

# Test with a custom CSS theme override
node bin/loot-cards.js examples/loot.yaml --theme examples/custom-theme.css -o output.pdf

# Test layout options
node bin/loot-cards.js examples/loot.yaml -c 2 -r 4 -o output.pdf
```

There is no test suite or lint config. The primary verification loop is `--debug-html` for layout + a full run for PDF output.

## Architecture

The pipeline is strictly linear: **YAML file → validate → render HTML string → Puppeteer → PDF file**.

```
bin/loot-cards.js  →  src/cli.js  →  src/loader.js   (YAML + Zod)
                                  →  src/renderer.js  (HTML assembly)
                                       ├─ src/images.js  (icon → base64)
                                       ├─ src/theme.js   (CSS inlining)
                                       └─ templates/card.hbs  (Handlebars partial)
                                  →  src/pdf.js       (Puppeteer)
```

### Key constraints that affect every change

**No `<link>` tags or relative `src` paths in the HTML.** Puppeteer uses `page.setContent()` (no base URL), so all CSS is inlined as `<style>` blocks by `src/theme.js`, and all images (including the parchment texture) are embedded as base64 data URIs by `src/images.js`. HTTP/HTTPS icon URLs are the only exception — Puppeteer fetches those directly.

**CSS load order matters.** `src/theme.js` concatenates: `default.css` → `print.css` → user `--theme` file. The user's CSS wins because it's last in the cascade. All visual values in `default.css` are CSS custom properties on `:root`; user themes only need to redeclare the variables they want to change.

**Grid sizing is injected at render time.** `src/renderer.js` emits an inline `<style>:root { --columns: N; --rows: N; --parchment-url: ... }</style>` after the theme block. `print.css` references these variables but doesn't set them.

**`"very rare"` rarity has a space.** The CSS selector `.rarity-very\ rare` (escaped space) is used in `default.css`. The `rarityClass` field on processed cards is unused by the template — the raw `rarity` string is used as the class value directly, so the card element becomes `class="card rarity-very rare"` and CSS targets it via the escaped-space selector.

### Theming

All design tokens live in `styles/default.css` as CSS custom properties. To change the look, users create a CSS file that overrides only the variables they want and pass it via `--theme`. See `examples/custom-theme.css` for a minimal example.

The parchment texture is loaded from `assets/parchment.jpg` → `parchment.png` → `parchment.svg` (first match wins). Replace `assets/parchment.jpg` with a real photo for best results.

### YAML schema

Defined in `src/loader.js` via Zod. Required fields: `name`, `rarity` (enum: `common | uncommon | rare | very rare | legendary | artifact`), `description`. Optional: `type`, `flavor`, `price`, `icon`, `tags`. Description supports `**bold**` and `*italic*` mini-Markdown (converted in `renderer.js`). Icon paths are resolved relative to the YAML file's directory.
