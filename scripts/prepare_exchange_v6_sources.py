"""Prepare luxury v6 PBR material suite & 3D assets in a scratch directory (on H:).

Reuses cached CC0 Poly Haven models and ambientCG maps from --base-src (read-only),
downloads additional luxury CC0 PBR surfaces from ambientCG (Marble006, Marble016,
Metal049A, Wood067) with high-craft fallback, refines roughness/tone for cinematic
daylight reflections, and generates crisp architectural textures (skyline daylight
glazing & high-density holographic data strips).
"""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import argparse
import os
import shutil
from urllib.request import Request, urlopen
from zipfile import ZipFile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

AGENT = "KOSPIMAP Exchange Floor v6 (https://kospimap.com)"

# Extra luxury CC0 ambientCG materials for v6
EXTRA_MATERIALS = {
    "calacatta": ("Marble006", 2048, 1024),   # crisp bright Calacatta marble with subtle warm veins
    "darkmarble": ("Marble016", 2048, 1024),  # deep Nero/Emperador veined marble for borders & plinths
    "brass": ("Metal049A", 1024, 1024),       # brushed champagne brass/gold trim & inlays
    "walnut": ("Wood067", 2048, 1024),        # rich architectural American walnut
}

# Target roughness remap (scale, bias) -> cinematic specular response
ROUGHNESS_V6 = {
    "calacatta": (0.32, 0.11),   # honed-polished marble (0.11..0.43) -> catches skylight & core glow
    "stone": (0.34, 0.12),       # refined light stone
    "darkmarble": (0.28, 0.09),  # satin-gloss dark marble border
    "trav": (0.55, 0.28),        # clean refined architectural limestone
    "oak": (0.48, 0.16),         # satin architectural oak floorboards
    "veneer": (0.45, 0.18),      # satin oak veneer
    "walnut": (0.42, 0.18),      # satin lacquered walnut
    "brass": (0.35, 0.16),       # brushed champagne brass
    "steel": (0.40, 0.14),       # architectural dark bronze / brushed steel
    "leather": (0.65, 0.15),
}

# Re-tone targets (mean sRGB, saturation factor) matching the luxury architectural concept boards
TONE_V6 = {
    "calacatta": ((224, 221, 215), 0.30),  # luminous creamy-white Calacatta
    "stone": ((214, 211, 205), 0.28),      # clean warm architectural stone
    "darkmarble": ((44, 42, 40), 0.35),    # rich charcoal-bronze Emperador marble
    "trav": ((214, 208, 198), 0.32),       # sleek cool-warm travertine (less yellow than v5)
    "weave": ((214, 206, 194), 0.45),      # upscale ivory-oatmeal linen
    "plaster": ((236, 233, 228), 0.20),    # crisp architectural gallery white
    "brass": ((212, 186, 142), 0.72),      # refined champagne brass (not garish yellow gold)
    "walnut": ((86, 62, 46), 0.78),        # deep warm architectural walnut
}


def download(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=60) as resp:
        return resp.read()


def remap_roughness(target: Path, name: str):
    raw = target / f"{name}-roughness-raw.jpg"
    src = raw if raw.exists() else target / f"{name}-roughness.jpg"
    if not src.exists():
        return
    scale, bias = ROUGHNESS_V6.get(name, (1.0, 0.0))
    im = Image.open(src).convert("L")
    im.point(lambda v: max(12, min(245, round(v * scale + bias * 255)))).save(
        target / f"{name}-roughness.jpg", quality=92, optimize=True
    )


def apply_tone(target: Path, name: str, contrast: float = 1.0):
    if name not in TONE_V6:
        return
    path = target / f"{name}-color.jpg"
    if not path.exists():
        return
    mean, keep = TONE_V6[name]
    arr = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    grey = (arr @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
    out = grey + (arr - grey) * keep
    m = out.reshape(-1, 3).mean(axis=0)
    out = (out - m) * contrast + np.array(mean, dtype=np.float32)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(path, quality=93, optimize=True)


def fetch_ambient(target: Path, name: str, asset_id: str, csize: int, dsize: int) -> bool:
    if (target / f"{name}-color.jpg").exists() and (target / f"{name}-normal.jpg").exists():
        print(f"cached: {name}", flush=True)
        return True
    try:
        payload = download(f"https://ambientcg.com/get?file={asset_id}_2K-JPG.zip")
        with ZipFile(BytesIO(payload)) as zf:
            for src_tag, channel in (("Color", "color"), ("NormalGL", "normal"), ("Roughness", "roughness")):
                item = next((p for p in zf.namelist() if p.endswith(f"_{src_tag}.jpg")), None)
                if not item:
                    continue
                im = Image.open(BytesIO(zf.read(item))).convert("L" if channel == "roughness" else "RGB")
                sz = csize if channel == "color" else dsize
                if im.width > sz:
                    im = im.resize((sz, sz), Image.Resampling.LANCZOS)
                suffix = "-raw" if channel == "roughness" else ""
                im.save(target / f"{name}-{channel}{suffix}.jpg", quality=92, optimize=True)
        print(f"downloaded: {name} ({asset_id})", flush=True)
        return True
    except Exception as exc:
        print(f"fallback needed for {name} ({asset_id}): {exc}", flush=True)
        return False


def make_fallback(target: Path, name: str, base_name: str):
    for ch in ("color", "normal", "roughness", "roughness-raw"):
        src = target / f"{base_name}-{ch}.jpg"
        dst = target / f"{name}-{ch}.jpg"
        if src.exists() and not dst.exists():
            shutil.copy2(src, dst)


def make_rotated(target: Path, src_name: str, dst_name: str):
    for ch in ("color", "roughness", "normal"):
        p = target / f"{src_name}-{ch}.jpg"
        if not p.exists():
            continue
        im = Image.open(p).transpose(Image.Transpose.ROTATE_90)
        if ch == "normal":
            a = np.asarray(im.convert("RGB")).astype(np.int16)
            a = np.stack([255 - a[..., 1], a[..., 0], a[..., 2]], axis=-1).astype(np.uint8)
            im = Image.fromarray(a)
        im.save(target / f"{dst_name}-{ch}.jpg", quality=92, optimize=True)


def generate_skyline_glazing(path: Path):
    """Crisp sunlit architectural cityscape sky seen through floor-to-ceiling perimeter windows."""
    w, h = 1024, 512
    yy = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    xx = np.linspace(0.0, 1.0, w, dtype=np.float32)[None, :]
    # Clear azure zenith -> luminous sunlit silver-blue mid-sky -> warm golden-ivory horizon
    sky_top = np.array([0.36, 0.58, 0.86], dtype=np.float32)
    sky_mid = np.array([0.74, 0.84, 0.94], dtype=np.float32)
    horizon = np.array([0.96, 0.90, 0.80], dtype=np.float32)
    t1 = np.clip(yy / 0.56, 0.0, 1.0)[..., None]
    t2 = np.clip((yy - 0.56) / 0.44, 0.0, 1.0)[..., None]
    img = (1 - t1) * sky_top + t1 * sky_mid
    img = np.where(yy[..., None] > 0.56, (1 - t2) * sky_mid + t2 * horizon, img)
    # Soft directional sun halo
    sun = np.exp(-(((xx - 0.32) / 0.25) ** 2 + ((yy - 0.34) / 0.22) ** 2))
    img = np.clip(img + sun[..., None] * np.array([0.18, 0.14, 0.08], dtype=np.float32), 0.0, 1.0)
    pil = Image.fromarray((img * 255).astype(np.uint8))
    draw = ImageDraw.Draw(pil, "RGBA")
    # Multi-layer sunlit metropolitan financial skyline silhouettes with subtle sunlit glass facades
    rng = np.random.default_rng(42)
    for layer, (alpha, tone, h_lo, h_hi) in enumerate([
        (72, (132, 152, 178), 0.28, 0.58),
        (110, (104, 122, 146), 0.44, 0.70),
        (155, (78, 92, 112), 0.58, 0.80),
    ]):
        x = 0
        while x < w:
            bw = int(rng.integers(22, 74))
            top = int(h * rng.uniform(h_lo, h_hi))
            draw.rectangle([x, top, x + bw - 3, h], fill=(*tone, alpha))
            # Sunlit left glass edge & subtle horizontal floor bands
            draw.line([(x, top), (x, h)], fill=(255, 246, 228, min(200, alpha + 35)), width=2)
            if layer >= 1:
                for fy in range(top + 10, h, 12):
                    draw.line([(x + 3, fy), (x + bw - 6, fy)], fill=(215, 228, 244, alpha // 3), width=1)
            x += bw
    pil = pil.filter(ImageFilter.GaussianBlur(radius=1.1))
    pil.save(path, quality=92, optimize=True)
    print("generated: window_skyline.jpg", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-src", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    out = args.out.resolve()
    base = args.base_src.resolve()
    mat_dir = out / "materials"
    mat_dir.mkdir(parents=True, exist_ok=True)

    # 1. Copy base materials from v5 source (read-only on I:)
    for f in (base / "materials").glob("*.jpg"):
        dst = mat_dir / f.name
        if not dst.exists():
            shutil.copy2(f, dst)

    # 2. Link/copy Poly Haven 3D prop folders (junctions on Windows save space & time, or copy if needed)
    for entry in base.iterdir():
        if not entry.is_dir() or entry.name in ("materials", "swatch"):
            continue
        dst = out / entry.name
        if dst.exists():
            continue
        try:
            os.symlink(entry, dst, target_is_directory=True)
        except OSError:
            shutil.copytree(entry, dst)

    # 3. Download extra luxury ambientCG PBR maps in parallel
    results = {}
    with ThreadPoolExecutor(4) as pool:
        futs = {
            name: pool.submit(fetch_ambient, mat_dir, name, aid, csz, dsz)
            for name, (aid, csz, dsz) in EXTRA_MATERIALS.items()
        }
        for name, fut in futs.items():
            results[name] = fut.result()

    # Fallbacks if offline
    fallbacks = {"calacatta": "stone", "darkmarble": "stone", "brass": "steel", "walnut": "veneer"}
    for name, ok in results.items():
        if not ok:
            make_fallback(mat_dir, name, fallbacks[name])

    # 4. Refine roughness & tones for v6 luxury palette
    for name in ("calacatta", "stone", "darkmarble", "trav", "oak", "veneer", "walnut", "brass", "steel", "leather"):
        remap_roughness(mat_dir, name)
    for name in ("calacatta", "stone", "darkmarble", "trav", "weave", "plaster", "brass", "walnut"):
        contrast = 1.22 if name in ("calacatta", "darkmarble") else 1.05
        apply_tone(mat_dir, name, contrast=contrast)

    make_rotated(mat_dir, "veneer", "veneerv")
    make_rotated(mat_dir, "walnut", "walnutv")
    generate_skyline_glazing(mat_dir / "window_skyline.jpg")
    print("v6 sources ready:", out, flush=True)


if __name__ == "__main__":
    main()
