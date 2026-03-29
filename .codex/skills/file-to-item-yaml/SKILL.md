---
name: file-to-item-yaml
description: Convert arbitrary local source files into the Loot Card Generator item YAML format used by this repository. Use when asked to transform markdown, txt, pdf, docx, screenshots, OCR output, lists, tables, or prose notes into a `cards:` YAML document or an `items/*.yaml` file.
---

# File To Item YAML

Use this skill when the target output is the repo's loot-card item YAML format, not generic YAML.

## Workflow

1. Inspect the source file before deciding on a mapping.
   Common patterns:
   - Plain text or markdown: read directly and use headings, bullets, and numbering.
   - CSV/TSV/spreadsheets exported as text: treat each row as one card unless the file clearly defines grouped variants.
   - PDF: extract text with local tools if available, then reconstruct headings, rows, and lists.
   - Images or screenshots: inspect the image and OCR if available; do not guess unreadable text.
2. Identify record boundaries and shared defaults.
   - Preserve the original item count and order unless the source clearly contains duplicates or section summaries.
   - Promote section headings into shared fields such as `type` or default `tags`.
   - Only split one source entry into multiple cards when the source explicitly encodes variants such as dice sizes, denominations, or quantities.
3. Normalize each record into the item YAML contract.
   - Always emit a top-level `cards:` array.
   - Every card should include `name`, `rarity`, `type`, and `description`.
   - Include `price` when the source provides one or when the user expects ready-to-render loot data; if you infer it, say so.
   - Keep optional fields only when supported by the repo format.
4. Validate before finalizing.
   - Recount source items versus YAML cards.
   - Check that field names match the repo contract exactly.
   - Ensure the YAML is valid and indentation is consistent.

## Mapping Rules

- Prefer repo conventions over generic schema assumptions. Read [references/item-yaml-format.md](references/item-yaml-format.md) when you need the canonical field list or examples.
- `rarity` must be one of: `common`, `uncommon`, `rare`, `very rare`, `legendary`, `artifact`.
- `type` is a short display label such as `Treasure`, `Trash`, or `Coinage`.
- `description` should be concise card text, not a raw copy of surrounding prose.
- `quantity` is only for duplicate copies of the same card, not the count of source rows.
- `tags` should be a YAML list. Use `[]` when the source implies no meaningful tags and the surrounding dataset expects the field.
- Only include `icon`, `imagePrompt`, `category`, `prompt`, or `negative_prompt` when the user asks for image-pipeline-ready output or the source already contains that data.

## Inference Discipline

- State inferred defaults when they are not explicit in the source.
- Do not fabricate lore, prices, or rarity tiers unless the user wants a filled-in card set.
- If the source is ambiguous, preserve the source wording in `description` and keep the rest minimal.
- If the file format blocks reliable extraction, explain the limitation and ask for a text extract rather than inventing content.

## Output Pattern

Use this shape:

```yaml
cards:
  - name: Example Item
    rarity: common
    type: Treasure
    description: A short card-ready description.
    price: 1 gp
    tags: []
```

Use block scalars only for genuinely multi-line descriptions or flavor text.
