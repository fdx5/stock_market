"""Flag large black patches in the daytime HoWon-dong QA camera view.

This is a visual review gate, not a renderer correctness proof. It detects the
partial-facade failure in TEST1.png that the old >99% black-frame gate missed.
Use only daytime screenshots with the buildings in the central scene region;
night scenes or a different camera need their own region/baseline.
"""
import argparse
import json
from pathlib import Path

from PIL import Image


def inspect_daytime_facades(image):
    image = image.convert("RGB")
    width, height = image.size
    step = max(8, round(width * 16 / 1845))
    tiles = set()
    for y in range(round(height * .39), round(height * .76) - step, step):
        for x in range(round(width * .12), round(width * .65) - step, step):
            pixels = list(image.crop((x, y, x + step, y + step)).getdata())
            if sum(max(pixel) < 32 for pixel in pixels) / len(pixels) > .92:
                tiles.add((x // step, y // step))
    largest = 0
    while tiles:
        todo = [tiles.pop()]
        count = 0
        while todo:
            x, y = todo.pop()
            count += 1
            for adjacent in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]:
                if adjacent in tiles:
                    tiles.remove(adjacent)
                    todo.append(adjacent)
        largest = max(largest, count)
    return {
        "largeBlackPatchTiles": largest,
        "largeBlackPatchPixels": largest * step * step,
        "needsVisualReview": largest >= 24,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path)
    args = parser.parse_args()
    flagged = False
    for path in args.images:
        with Image.open(path) as image:
            result = inspect_daytime_facades(image)
        print(json.dumps({"path": str(path), **result}, ensure_ascii=False))
        flagged |= result["needsVisualReview"]
    raise SystemExit(1 if flagged else 0)
