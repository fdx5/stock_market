"""Append baked tree cells (bake-plants.py output) to the plant atlas.

  python frontend/scripts/bake-plants-pack.py <bake_out_dir> name:kind [name:kind ...]

Each cell is reduced from 640 to 320 px with premultiplied alpha, and colour is bled
into the transparent texels so mipmaps and alpha testing show no dark fringes.
Rewrites frontend/public/3d/plants.webp and plants.json in place (existing cells keep
their indices; new rows are added as needed).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'public' / '3d'
src = Path(sys.argv[1])
specs = [a.split(':') for a in sys.argv[2:]]
metrics = json.loads((src / 'cells.json').read_text())
meta = json.loads((root / 'plants.json').read_text())
atlas = Image.open(root / 'plants.webp').convert('RGBA')
C, cols = meta['cell'], meta['cols']
done = {a['name'] for a in meta['assets']}


def cell(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255
    rgb, al = a[..., :3] * a[..., 3:], a[..., 3:]
    small = lambda x: np.asarray(Image.fromarray((x * 255).astype(np.uint8).squeeze()).resize((C, C), Image.LANCZOS)).astype(np.float32) / 255
    pm = np.stack([small(rgb[..., i]) for i in range(3)], -1)
    alpha = small(al[..., 0])[..., None]
    col = np.where(alpha > 1e-3, pm / np.maximum(alpha, 1e-3), 0)
    # bleed: transparent texels take the mean colour of their covered neighbours
    have = (alpha[..., 0] > 0.02).astype(np.float32)
    for _ in range(24):
        acc = sum(np.roll(np.roll(col * have[..., None], dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        n = sum(np.roll(np.roll(have, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        fill = (have == 0) & (n > 0)
        col[fill] = acc[fill] / n[fill][:, None]
        have = np.maximum(have, fill.astype(np.float32))
    out = np.concatenate([np.clip(col, 0, 1), alpha], -1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')


used = meta['used']
new = [(n, k) for n, k in specs if n not in done]
rows = -(-(used + 2 * len(new)) // cols)
if rows > meta['rows']:
    bigger = Image.new('RGBA', (cols * C, rows * C), (0, 0, 0, 0))
    bigger.paste(atlas, (0, 0))
    atlas = bigger
    meta['rows'] = rows
for name, kind in new:
    idx = []
    for view in ('side', 'top'):
        i = used
        used += 1
        atlas.paste(cell(src / f'{name}_{view}.png'), ((i % cols) * C, (i // cols) * C))
        idx.append(i)
    m = metrics[name]
    meta['assets'].append(dict(name=name, kind=kind, side=idx[0], top=idx[1], span=m['span'], topSpan=m['topSpan'],
                               groundV=m['groundV'], height=m['height'], width=m['width']))
    print('added', name, kind, idx)
meta['used'] = used
atlas.save(root / 'plants.webp', 'WEBP', quality=88, method=6, exact=True)
(root / 'plants.json').write_text(json.dumps(meta, separators=(',', ':')))
print('atlas', atlas.size, 'cells', used)
