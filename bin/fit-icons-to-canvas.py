#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fit transparent icons to a fixed square canvas by detecting the "
            "non-transparent object bounds."
        )
    )
    parser.add_argument("input_dir", type=Path, help="Directory with source icons")
    parser.add_argument(
        "output_dir",
        type=Path,
        nargs="?",
        help="Directory for processed icons (default: <input_dir>/fit-1024)",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=1024,
        help="Output width/height in pixels (default: 1024)",
    )
    parser.add_argument(
        "--margin",
        type=int,
        default=48,
        help="Margin from object to canvas edge in pixels (default: 48)",
    )
    parser.add_argument(
        "--alpha-threshold",
        type=int,
        default=1,
        help=(
            "Alpha threshold for object detection, 0-255 (default: 1). "
            "Higher values ignore faint edge pixels."
        ),
    )
    return parser.parse_args()


def find_object_bbox(img: Image.Image, alpha_threshold: int) -> tuple[int, int, int, int] | None:
    alpha = img.getchannel("A")
    mask = alpha.point(lambda value: 255 if value >= alpha_threshold else 0, mode="L")
    return mask.getbbox()


def fit_icon(
    src_path: Path,
    dst_path: Path,
    size: int,
    margin: int,
    alpha_threshold: int,
) -> bool:
    with Image.open(src_path) as source:
        rgba = source.convert("RGBA")
        bbox = find_object_bbox(rgba, alpha_threshold)

        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

        if bbox is None:
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(dst_path, format="PNG")
            return True

        cropped = rgba.crop(bbox)
        obj_w, obj_h = cropped.size
        max_dim = size - (margin * 2)
        if max_dim <= 0:
            raise ValueError(f"Margin {margin} is too large for canvas size {size}.")

        scale = min(max_dim / obj_w, max_dim / obj_h)
        new_w = max(1, round(obj_w * scale))
        new_h = max(1, round(obj_h * scale))
        resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)

        paste_x = (size - new_w) // 2
        paste_y = (size - new_h) // 2
        canvas.paste(resized, (paste_x, paste_y), resized)

        dst_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(dst_path, format="PNG")
        return True


def main() -> int:
    args = parse_args()

    input_dir = args.input_dir
    output_dir = args.output_dir or (input_dir / "fit-1024")
    size = args.size
    margin = args.margin
    alpha_threshold = args.alpha_threshold

    if not input_dir.is_dir():
        print(f"Error: input directory not found: {input_dir}")
        return 1
    if size <= 0:
        print("Error: --size must be greater than 0.")
        return 1
    if margin < 0:
        print("Error: --margin cannot be negative.")
        return 1
    if not (0 <= alpha_threshold <= 255):
        print("Error: --alpha-threshold must be in range 0..255.")
        return 1

    files = [
        path
        for path in input_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    ]
    if not files:
        print(f"No supported image files found in: {input_dir}")
        return 1

    processed = 0
    for src_path in files:
        rel = src_path.relative_to(input_dir).with_suffix(".png")
        dst_path = output_dir / rel
        fit_icon(src_path, dst_path, size=size, margin=margin, alpha_threshold=alpha_threshold)
        print(f"fit: {src_path} -> {dst_path}")
        processed += 1

    print(f"Done. Processed {processed} image(s). Output: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
