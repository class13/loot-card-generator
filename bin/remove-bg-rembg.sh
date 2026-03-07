#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bin/remove-bg-rembg.sh <input_dir> [output_dir]

Examples:
  bin/remove-bg-rembg.sh items/icons items/icons-transparent
  REMBG_MODEL=u2net_human_seg bin/remove-bg-rembg.sh examples/icons

Notes:
  - Requires `rembg` CLI in PATH.
  - Output files are always `.png` with alpha transparency.
  - Processes: png, jpg, jpeg, webp (case-insensitive).
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

INPUT_DIR="$1"
OUTPUT_DIR="${2:-$INPUT_DIR/no-bg}"
MODEL="${REMBG_MODEL:-u2net}"

if ! command -v rembg >/dev/null 2>&1; then
  echo "Error: rembg is not installed or not in PATH."
  echo "Install with: pip install rembg"
  exit 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
  echo "Error: input directory not found: $INPUT_DIR"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

processed=0
while IFS= read -r -d '' file; do
  rel_path="${file#$INPUT_DIR/}"
  rel_no_ext="${rel_path%.*}"
  out_file="$OUTPUT_DIR/$rel_no_ext.png"
  out_dir="$(dirname "$out_file")"

  mkdir -p "$out_dir"
  echo "rembg: $file -> $out_file"
  rembg i -m "$MODEL" "$file" "$out_file"
  processed=$((processed + 1))
done < <(find "$INPUT_DIR" -type f \( \
  -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.webp" \
\) -print0)

if [[ $processed -eq 0 ]]; then
  echo "No supported image files found in: $INPUT_DIR"
  exit 1
fi

echo "Done. Processed $processed image(s). Output: $OUTPUT_DIR"
