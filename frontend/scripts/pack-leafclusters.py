"""Pack the leafy twigs rendered by gen-mesh-trees.py into public/3d/twigs.webp (+ twigs.json).

  python frontend/scripts/pack-leafclusters.py <work_dir>

Cells of 256 x 512 px (a twig 0.6 m tall), in the generator's order, 8 across; colour bled
into the transparent texels so the mips and the alpha test show no dark fringes.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

work = Path(sys.argv[1])
order = json.loads((work / 'twigs.json').read_text())
root = Path(__file__).resolve().parents[1] / 'public' / '3d'
CW, CH, COLS = 256, 512, 8
rows = -(-len(order) // COLS)
atlas = Image.new('RGBA', (CW * COLS, CH * rows), (0, 0, 0, 0))
for k, name in enumerate(order):
    a = np.asarray(Image.open(work / f'twig_{name}.png').convert('RGBA').resize((CW, CH), Image.LANCZOS)).astype(np.float32)
    have = a[..., 3] > 8
    col = a[..., :3].copy()
    for _ in range(16):
        acc = sum(np.roll(np.roll(col * have[..., None], dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        cnt = sum(np.roll(np.roll(have.astype(np.float32), dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        fill = (~have) & (cnt > 0)
        col[fill] = acc[fill] / cnt[fill][:, None]
        have = have | fill
    a[..., :3] = col
    atlas.paste(Image.fromarray(a.astype(np.uint8), 'RGBA'), ((k % COLS) * CW, (k // COLS) * CH))
atlas.save(root / 'twigs.webp', 'WEBP', quality=88, alpha_quality=95, method=6)
(root / 'twigs.json').write_text(json.dumps({'cols': COLS, 'rows': rows, 'order': order}))
print('twigs.webp', atlas.size, (root / 'twigs.webp').stat().st_size, 'bytes')
