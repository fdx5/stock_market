"""Derive the trading floor's v4 palette textures from the fetched CC0 sources (additive only).

    python scripts/derive_exchange_palette.py <sources>

The v3 hall leaned on gold leaf, brass and rose marble. v4 keeps the same CC0 surfaces but
recolours them into a quieter palette: greige travertine walls, white statuary pilasters,
champagne-nickel metalwork, smoked-oak furniture with taupe leather panels and
nickel chandeliers. Veining, grain and wear are kept: only
saturation and the mean colour change. New files are written next to the originals; nothing
existing is modified.
"""
from pathlib import Path
import shutil
import sys

import numpy as np
from PIL import Image


def recolour(src: Path, dst: Path, mean_rgb, keep_saturation: float, contrast: float = 1.0):
    image = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32)
    grey = image @ np.array([.2126, .7152, .0722], dtype=np.float32)
    grey = grey[..., None]
    out = grey + (image - grey) * keep_saturation
    centre = out.reshape(-1, 3).mean(axis=0)
    out = (out - centre) * contrast + np.array(mean_rgb, dtype=np.float32)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, quality=92, optimize=True)


def derive(root: Path):
    m = root / "materials"
    plan = {
        # key: (source key, mean sRGB, saturation kept, detail contrast)
        "greige": ("wallstone", (165, 157, 147), .3, 1.2),       # honed warm-greige travertine walls
        "statuary": ("cream", (222, 218, 210), .30, 1.0),        # white statuary pilasters and trims
        "nickel": ("brass", (198, 194, 186), 0.0, 4.0),          # brushed champagne nickel
        "pnickel": ("gold", (214, 211, 204), 0.0, 4.0),          # polished nickel, finer detail
        "smokedoak": ("walnut", (132, 114, 96), .45, 1.3),       # smoked oak: warm taupe-grey, pairs with navy
        "hide": ("leather", (170, 154, 136), 1.0, 2.2),          # taupe nappa leather for cabinet panels
    }
    for key, (source, mean, sat, contrast) in plan.items():
        recolour(m / f"{source}-color.jpg", m / f"{key}-color.jpg", mean, sat, contrast)
        for channel in ("normal", "roughness"):
            # Nickel stays satin everywhere: mirror-bright strips read as chrome, not as luxury.
            origin = "brass" if key == "pnickel" and channel == "roughness" else source
            shutil.copyfile(m / f"{origin}-{channel}.jpg", m / f"{key}-{channel}.jpg")
        print(key, "<-", source, flush=True)
    # Nickel chandeliers: a copy of the Poly Haven model with a desaturated diffuse map.
    src, dst = root / "Chandelier_03", root / "Chandelier_03_nickel"
    if not dst.exists():
        shutil.copytree(src, dst)
        (dst / "Chandelier_03.gltf").rename(dst / "Chandelier_03_nickel.gltf")
    recolour(src / "textures/Chandelier_03_diff_1k.jpg", dst / "textures/Chandelier_03_diff_1k.jpg", (172, 168, 160), .12, 1.0)
    print("Chandelier_03_nickel", flush=True)



if __name__ == "__main__":
    derive(Path(sys.argv[1]).resolve())
