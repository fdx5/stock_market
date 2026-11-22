"""Pack the exchange's wall-painting previews from the existing 1K images."""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "frontend/public/3d/exchange-floor/art"
COLUMNS, TILE, BORDER = 8, 256, 8


def preview_tile(path):
    size = TILE - 2 * BORDER
    with Image.open(path) as artwork:
        center = artwork.convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    # Repeat edge texels to keep adjacent paintings from bleeding into the mipmaps.
    tile = Image.new("RGB", (TILE, TILE))
    tile.paste(center, (BORDER, BORDER))
    tile.paste(center.crop((0, 0, 1, size)).resize((BORDER, size)), (0, BORDER))
    tile.paste(center.crop((size - 1, 0, size, size)).resize((BORDER, size)), (BORDER + size, BORDER))
    tile.paste(tile.crop((0, BORDER, TILE, BORDER + 1)).resize((TILE, BORDER)), (0, 0))
    tile.paste(tile.crop((0, BORDER + size - 1, TILE, BORDER + size)).resize((TILE, BORDER)), (0, BORDER + size))
    return tile


if __name__ == "__main__":
    layout = json.loads((ROOT / "frontend/src/exchange/layout.json").read_text(encoding="utf-8"))
    walls = layout["artWalls"]
    rows = (len(walls) + COLUMNS - 1) // COLUMNS
    atlas = Image.new("RGB", (COLUMNS * TILE, rows * TILE))
    for index, wall in enumerate(walls):
        atlas.paste(preview_tile(ART / f"{wall['id']}-1k.webp"), (index % COLUMNS * TILE, index // COLUMNS * TILE))
    atlas.save(ART / "gallery-preview-v1.webp", quality=80, method=6)
