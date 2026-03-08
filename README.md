# Loot Card Generator

Generate print-ready A4 PDFs of D&D-style loot cards from a YAML file.

## Quick Start

```bash
npm install
node bin/loot-cards.js examples/loot.yaml -o output.pdf
```

## Generate Icons With ComfyUI

Generate local icon images from your card YAML using ComfyUI (`http://localhost:8000`), an SDXL checkpoint, and the `game_icon_v1.0.safetensors` LoRA:

```bash
node bin/loot-card-icons.js examples/loot.yaml --in-place
```

This generates PNG files in `icons/` (relative to the YAML directory), and writes `icon:` paths back to your YAML when `--in-place` is used.

Place the LoRA file at `ComfyUI/models/loras/game_icon_v1.0.safetensors` and click **Refresh** in ComfyUI if needed.

Prompt format per card:
- `2d icon. {short object prompt}. white background. single object only, centered composition, isolated asset, one subject, full object in frame, no repeated elements.`
- negative prompt: `(blurry:1.3). lowres. multiple objects, repeated objects, duplicates, grid layout, tiled pattern, contact sheet, sprite sheet, collage, border pattern, lineup.`

If a card has `prompt` and/or `negative_prompt` fields, `loot-card-icons` uses those values instead of the defaults.

Optional per-card prompt override:

```yaml
cards:
  - name: Basket of Lemons
    rarity: uncommon
    description: Fresh and fragrant.
    imagePrompt: a basket of lemons with leaves on top
```

### Icon CLI Reference

```
Usage: loot-card-icons <input> [options]

Arguments:
  input                      YAML file path

Options:
  --comfy-url <url>          ComfyUI base URL (default: "http://localhost:8000")
  --out-dir <path>           Output icon directory, default: <yaml-dir>/icons
  --checkpoint <name>        Checkpoint model name in ComfyUI (default: "sd_xl_base_1.0.safetensors")
  --lora <name>              LoRA model name in ComfyUI (default: "game_icon_v1.0.safetensors")
  --lora-strength-model <n>  LoRA strength for model branch (default: 1)
  --lora-strength-clip <n>   LoRA strength for CLIP branch (default: 1)
  --width <n>                Image width (default: 1024)
  --height <n>               Image height (default: 1024)
  --steps <n>                Sampling steps (default: 40)
  --cfg <n>                  CFG scale (default: 6)
  --sampler <name>           Sampler name (default: "euler")
  --scheduler <name>         Scheduler name (default: "normal")
  --denoise <n>              Denoise value (default: 1)
  --seed <n>                 Base seed for deterministic runs
  --draft                    Use quick draft settings (512x512, 16 steps, cfg 5)
  --fast                     Alias for --draft
  --limit <n>                Generate only the first N eligible cards
  --list-models              List checkpoint and LoRA names visible to ComfyUI and exit
  --overwrite                Regenerate even when card already has icon
  --write-yaml <path>        Write a YAML file with updated icon fields
  --in-place                 Overwrite the input YAML with updated icon fields
  -V, --version              Output version number
  -h, --help                 Display help
```

Fast iteration example:

```bash
node bin/loot-card-icons.js examples/loot.yaml --in-place --draft --limit 3
```

## Remove White Backgrounds With rembg

Use the batch helper script to remove backgrounds from generated images:

```bash
bin/remove-bg-rembg.sh items/icons items/icons-transparent
```

If your images are in another folder, pass that folder as the first argument.  
Optional: choose model with `REMBG_MODEL` (default is `u2net`):

```bash
REMBG_MODEL=u2net_human_seg bin/remove-bg-rembg.sh examples/icons
```

## Fit Transparent Icons To 1024 Canvas

After background removal, normalize each icon so the visible object fills a
`1024x1024` image using its alpha bounding box, with a small edge margin:

```bash
bin/fit-icons-to-canvas.py items/icons-transparent items/icons-fit-1024
```

Optional tuning:

```bash
bin/fit-icons-to-canvas.py items/icons-transparent items/icons-fit-1024 --size 1024 --margin 48 --alpha-threshold 1
```

## Generate Prompts With Ollama

Generate `prompt` and `negative_prompt` fields for each card using your local Ollama (`http://localhost:11434`):

```bash
node bin/loot-card-prompts.js examples/loot.yaml --in-place --model llama3.1:8b
```

Write to a separate file instead of overwriting:

```bash
node bin/loot-card-prompts.js examples/loot.yaml --write-yaml examples/loot.with-prompts.yaml --model llama3.1
```

### Prompt CLI Reference

```
Usage: loot-card-prompts <input> [options]

Arguments:
  input                      YAML file path

Options:
  --ollama-url <url>         Ollama base URL (default: "http://localhost:11434")
  --model <name>             Ollama model name (default: "llama3.1")
  --temperature <n>          Sampling temperature (default: 0.4)
  --top-p <n>                Top-p sampling value (default: 0.9)
  --max-tokens <n>           Max generated tokens (default: 220)
  --limit <n>                Generate only first N eligible cards
  --overwrite                Regenerate even if prompt fields already exist
  --write-yaml <path>        Write output YAML to a new file
  --in-place                 Overwrite input YAML file (default behavior)
  -V, --version              Output version number
  -h, --help                 Display help
```

## YAML Schema

The top-level key is `cards`, which holds a list of card objects.

```yaml
cards:
  - name: My Item
    rarity: rare
    description: Does something **cool**.
```

### Field Reference

| Field | Required | Type | Description |
|---|---|---|---|
| `name` | ✅ | string | Card heading |
| `rarity` | ✅ | enum | Controls border and label colour — see values below |
| `description` | ✅ | string | Main body text. Supports `**bold**` and `*italic*`. Use a YAML block scalar (`\|`) for multiple lines. |
| `type` | — | string | Subtitle beneath the rarity label (e.g. `Wondrous Item (requires attunement)`) |
| `flavor` | — | string | Italic quote shown at the bottom of the card body with a gold left border |
| `price` | — | string | Free-form string shown in the card footer (e.g. `2,500 gp`, `Priceless`) |
| `icon` | — | string | Local path relative to the YAML file, or an `https://` URL |
| `imagePrompt` | — | string | Optional short text used by `loot-card-icons` for generation prompt subject |
| `category` | — | string | Generated item class (`weapon`, `armor`, `clothing`, etc.) from `loot-card-prompts` |
| `prompt` | — | string | Stable Diffusion positive prompt text (used by your image pipeline) |
| `negative_prompt` | — | string | Stable Diffusion negative prompt text |
| `tags` | — | string[] | Small-caps chips shown in the card footer |

### Rarity Values

| Value | Colour |
|---|---|
| `common` | Grey `#9d9d9d` |
| `uncommon` | Green `#1eff00` |
| `rare` | Blue `#0070dd` |
| `very rare` | Purple `#a335ee` |
| `legendary` | Orange `#ff8000` |
| `artifact` | Gold `#e6cc80` |

## Mini-Markdown in `description`

Only `description` is processed for inline formatting:

| Syntax | Result |
|---|---|
| `**text**` | **bold** |
| `*text*` | *italic* |

For multi-line descriptions use a YAML block scalar:

```yaml
description: |
  First sentence with **bold**.
  Second sentence with *italic*.
```

## Icon Field

```yaml
# Local path — resolved relative to the YAML file's directory
icon: icons/flame.png

# Remote URL — Puppeteer fetches it directly (requires network access)
icon: https://example.com/icons/flame.png
```

Supported local formats: PNG, JPG, SVG, WebP (anything a browser can render).

## CLI Reference

```
Usage: loot-cards <input> [options]

Arguments:
  input                   YAML file path

Options:
  -o, --output <path>     Output PDF path (default: ./loot-cards.pdf)
  -t, --theme <path>      Custom CSS override file
  -c, --columns <n>       Cards per row (default: 3)
  -r, --rows <n>          Rows per page (default: 3)
  --no-bleed              Disable bleed marks
  --auto-icon             Auto-find icons from game-icons.net for cards with no explicit icon
  --debug-html <path>     Write intermediate HTML for browser inspection
  --open                  Open PDF after generation
  -V, --version           Output version number
  -h, --help              Display help
```

### Common invocations

```bash
# Preview layout in browser (fast, no PDF)
node bin/loot-cards.js examples/loot.yaml --debug-html /tmp/preview.html && open /tmp/preview.html

# 2-column layout, custom output path
node bin/loot-cards.js examples/loot.yaml -c 2 -r 4 -o output.pdf

# Apply a custom theme
node bin/loot-cards.js examples/loot.yaml --theme examples/custom-theme.css -o output.pdf

# Auto-fill icons from game-icons.net for cards with no explicit icon
node bin/loot-cards.js examples/loot.yaml --auto-icon -o output.pdf
```

## Auto-Icon (`--auto-icon`)

Pass `--auto-icon` to automatically assign icons from [game-icons.net](https://game-icons.net) (CC BY 3.0) to any card that doesn't have an explicit `icon:` field.

The lookup searches the card's `name`, `type`, and `tags` for keywords (e.g. `sword`, `potion`, `fire`, `ring`) and maps them to a suitable SVG icon CDN URL. The explicit `icon:` field always takes priority and is never overridden.

**Limitations:**
- Requires network access — Puppeteer fetches the icon URLs at render time.
- Match quality depends on keyword overlap; uncommon or very specific item names may get no icon or a loosely related one.
- Icons are CC BY 3.0 — free for personal and commercial use with attribution to game-icons.net.

## Theming

All visual values are CSS custom properties on `:root` in `styles/default.css`. To override them, create a CSS file that redeclares only the variables you want to change and pass it via `--theme`.

```bash
node bin/loot-cards.js examples/loot.yaml --theme my-theme.css -o output.pdf
```

See `examples/custom-theme.css` for a minimal working example. Key properties:

| Property | Controls |
|---|---|
| `--font-title` | Card title font stack |
| `--font-body` | Body / flavor text font stack |
| `--card-bg` | Card background color |
| `--border-width` | Rarity border thickness |
| `--card-radius` | Card corner radius |
| `--footer-bg` | Footer background |

The parchment texture is loaded from `assets/parchment.jpg` (falls back to `.png` then `.svg`). Replace the file to change the card background texture.
