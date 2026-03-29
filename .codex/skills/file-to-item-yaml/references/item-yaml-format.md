# Item YAML Format

This repository renders loot cards from a top-level `cards:` array.

## Preferred Contract

Use the README and existing `items/*.yaml` files as the source of truth.

Important: `cards-schema.json` is narrower and stale. It only lists a small subset of allowed `rarity` and `type` values, while the renderer docs and real data support more values and optional fields.

## Card Fields

Common fields:

- `name`: card title.
- `rarity`: one of `common`, `uncommon`, `rare`, `very rare`, `legendary`, `artifact`.
- `type`: subtitle-style label such as `Treasure`, `Trash`, or `Coinage`.
- `description`: main card body text.
- `price`: free-form value label such as `1 gp`, `1d8 sp`, `worthless`, or `Priceless`.

Optional fields:

- `quantity`: duplicate count for the same card.
- `flavor`: italic quote block.
- `icon`: local path relative to the YAML file, or an `https://` URL.
- `imagePrompt`: short subject hint for image generation.
- `category`: generated item class such as `weapon`, `armor`, or `other`.
- `prompt`: positive image prompt.
- `negative_prompt`: negative image prompt.
- `tags`: YAML list of strings.

## Conversion Heuristics

### Markdown or prose lists

- Section headings often map to `type` or shared tags.
- Numbered or bulleted list entries usually map to one card each.
- Keep order stable.

Example pattern from `items/trash.md` to `items/trash.yaml`:

- Heading `## Trash` became `type: Trash`.
- Subheading `### The Organic & Grotesque` became a shared tag like `the-organic-grotesque`.
- Each numbered line became one card.
- Missing values were normalized for renderability, such as `rarity: common` and `price: worthless`.

### Structured variant lists

When a source encodes variants under one concept, split them into multiple cards only if the variants are explicit.

Example pattern from `items/coinage.md` to `items/coinage.yaml`:

- Currency section (`Gold`, `Silver`, `Copper`) became both `price` units and a tag.
- Dice size (`d20`, `d12`, etc.) became part of `name`, `price`, and `tags`.
- Leading counts became `quantity`.
- Shared family label became `type: Coinage`.

## YAML Style

- Use plain scalars unless quoting is needed.
- Use `description: |` only for multi-line text.
- Keep `tags` as a YAML sequence, not a comma-delimited string.
- Do not add unsupported top-level keys outside `cards`.

## Minimal Safe Example

```yaml
cards:
  - name: Bent Brooch
    rarity: common
    type: Treasure
    description: A tarnished silver brooch with a crooked pin and faded floral engraving.
    price: 1 gp
    tags: []
```
