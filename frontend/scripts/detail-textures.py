"""Photographic surface detail for the 3D complex view: public/3d/detail-<name>.webp (+ detail.json).

  python frontend/scripts/detail-textures.py

Poly Haven CC0 scans (painted render, granite, concrete, roof deck) reduced to one small RGBA
map each, tiled in world space over the painted facades by the WebGPU view:
  R  the scan's fine luminance relative to its own blur (x 0.5): its grain, pores and
     trowel marks, without its colour — the painted facade keeps its colours;
  G, B  the scan's normal (x, y, OpenGL);
  A  its roughness.
detail.json gives each map's real size in metres (Poly Haven's dimensions).
"""
import io
import json
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ASSETS = {
    'paint': 'beige_wall_001',          # painted render / exterior paint over concrete
    'granite': 'granite_tile',          # speckled honed granite (1-2층 cladding, plinths)
    'concrete': 'concrete_wall_008',    # exposed concrete (roof cores, neighbours' walls)
    'roof': 'concrete_floor_painted',   # painted roof deck
}
SIZE = 512
root = Path(__file__).resolve().parents[1] / 'public' / '3d'
UA = {'User-Agent': 'Mozilla/5.0 kospimap-detail-bake'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        return r.read()


meta = {}
for name, asset in ASSETS.items():
    files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
    info = json.loads(get(f'https://api.polyhaven.com/info/{asset}'))
    load = lambda key: Image.open(io.BytesIO(get(files[key]['1k']['jpg']['url'])))
    diff = load('Diffuse').convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    nor = load('nor_gl').convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    rough = load('Rough').convert('L').resize((SIZE, SIZE), Image.LANCZOS)
    d = np.asarray(diff).astype(np.float32) / 255
    lum = d @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    # (the blur wraps round: the map tiles)
    tiled = Image.fromarray((np.tile(lum, (3, 3)) * 255).astype(np.uint8))
    blur = np.asarray(tiled.filter(ImageFilter.GaussianBlur(SIZE / 12))).astype(np.float32)[SIZE:2 * SIZE, SIZE:2 * SIZE] / 255
    ratio = np.clip(lum / np.maximum(blur, 0.02) * 0.5, 0, 1)
    n = np.asarray(nor).astype(np.float32) / 255
    out = np.dstack([ratio, n[..., 0], n[..., 1], np.asarray(rough).astype(np.float32) / 255])
    img = Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')
    path = root / f'detail-{name}.webp'
    img.save(path, 'WEBP', quality=90, method=6, alpha_quality=90)
    dims = info.get('dimensions') or [2000, 2000]
    meta[name] = dict(asset=asset, metres=round(dims[0] / 1000, 3), file=path.name, avgRough=round(float(out[..., 3].mean()), 3))
    print(name, asset, path.stat().st_size, 'bytes', meta[name])
(root / 'detail.json').write_text(json.dumps(meta, indent=1))
