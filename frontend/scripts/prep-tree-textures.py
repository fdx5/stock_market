"""Photographic leaf and bark sources for the mesh trees (Poly Haven, CC0).

  python frontend/scripts/prep-tree-textures.py <work_dir>

- <work_dir>/leafphoto.png + leafphoto.json: the photographed leaves of Poly Haven's
  island_tree_02 (colour + alpha) and each leaf's rectangle, for gen-mesh-trees.py to
  build the leaf-cluster clumps from real leaves instead of flat polygons.
- public/3d/bark-<species>.webp + bark.json: a scanned bark per species at 512 px, tiled
  over the bark tubes by the view (their real size in metres in bark.json).
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

work = Path(sys.argv[1]); work.mkdir(parents=True, exist_ok=True)
public = Path(__file__).resolve().parents[1] / 'public' / '3d'
UA = {'User-Agent': 'Mozilla/5.0 kospimap-tree-bake'}
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA)).read()

# ---- leaves
f = json.loads(get('https://api.polyhaven.com/files/island_tree_02'))
url = lambda key: f[key]['2k']['jpg']['url']
diff = Image.open(io.BytesIO(get(url('leaves_diff')))).convert('RGB')
alpha = Image.open(io.BytesIO(get(url('leaves_alpha')))).convert('L')
rgba = diff.copy(); rgba.putalpha(alpha)
rgba.save(work / 'leafphoto.png')
a = np.asarray(alpha) > 128
# connected leaves on a quarter-size mask (a plain flood fill)
small = np.asarray(alpha.resize((alpha.size[0] // 4, alpha.size[1] // 4))) > 96
seen = np.zeros_like(small, bool)
rects = []
W, H = alpha.size
h4, w4 = small.shape
for y0 in range(h4):
    for x0 in range(w4):
        if not small[y0, x0] or seen[y0, x0]:
            continue
        stack = [(y0, x0)]; seen[y0, x0] = True; ys, xs = [], []
        while stack:
            y, x = stack.pop(); ys.append(y); xs.append(x)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h4 and 0 <= xx < w4 and small[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True; stack.append((yy, xx))
        x1, x2, y1, y2 = min(xs) * 4, (max(xs) + 1) * 4, min(ys) * 4, (max(ys) + 1) * 4
        w, h = x2 - x1, y2 - y1
        if w * h < W * H * 0.004 or h < w:   # (specks, and anything lying sideways)
            continue
        rgb = np.asarray(diff)[y1:y2, x1:x2][a[y1:y2, x1:x2]]
        rects.append(dict(x=x1 / W, y=y1 / H, w=w / W, h=h / H, avg=[round(float(c) / 255, 4) for c in rgb.mean(0)]))
# Needle tufts (pines, conifers) and a petal (flowers), drawn here, beside the photographed
# leaves in the same atlas: the leaf atlas becomes 1024 wide leaves + one column of these.
from PIL import ImageDraw
import random as _r
S = rgba.size[1]
extra = Image.new('RGBA', (S // 2, S), (0, 0, 0, 0))
d = ImageDraw.Draw(extra)
rr = _r.Random(7)
for t in range(2):   # two tufts, stacked
    cx, cy, R = S // 4, S // 4 + t * S // 2, S // 4 - 8
    for _ in range(260):
        a = rr.uniform(-2.6, 2.6) - 1.5708
        l = rr.uniform(0.55, 1.0) * R
        g = rr.randint(70, 120)
        d.line([(cx, cy + R * 0.7), (cx + l * 1.05 * __import__('math').cos(a), cy + R * 0.7 + l * __import__('math').sin(a))], fill=(int(g * 0.55), g, int(g * 0.5), 255), width=6)
rects.append(dict(x=0, y=0, w=0, h=0, avg=[0.3, 0.37, 0.2], tuft=True))
tuft_rects = [dict(x=(rgba.size[0]) / (rgba.size[0] + S // 2), y=t * 0.5, w=(S // 2) / (rgba.size[0] + S // 2), h=0.5, avg=[0.3, 0.37, 0.2]) for t in range(2)]
# Flower heads, white (tinted per species), one 512 px quadrant each: five petals, a daisy,
# a tulip's cup from the side, a cluster of small florets (spikes and balls are built of it).
import math
Q = S // 4
def head(kind):
    im = Image.new('RGBA', (Q, Q), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = Q // 2
    if kind == 'five':
        for k in range(5):
            a = k / 5 * math.tau
            x, y = c + math.cos(a) * Q * 0.2, c + math.sin(a) * Q * 0.2
            d.ellipse([x - Q * 0.19, y - Q * 0.19, x + Q * 0.19, y + Q * 0.19], fill=(246, 243, 238, 255))
        d.ellipse([c - Q * 0.08, c - Q * 0.08, c + Q * 0.08, c + Q * 0.08], fill=(236, 200, 80, 255))
    elif kind == 'daisy':
        for k in range(18):
            a = k / 18 * math.tau
            pts = [(c + math.cos(a + o) * Q * r, c + math.sin(a + o) * Q * r) for o, r in ((0, 0.08), (0.12, 0.3), (0, 0.46), (-0.12, 0.3))]
            d.polygon(pts, fill=(248, 246, 240, 255))
        d.ellipse([c - Q * 0.11, c - Q * 0.11, c + Q * 0.11, c + Q * 0.11], fill=(222, 168, 40, 255))
    elif kind == 'bell':
        # tulip seen from the side: a cup of three overlapping petals, a stem below
        d.rectangle([c - Q * 0.02, c + Q * 0.1, c + Q * 0.02, Q - 4], fill=(70, 110, 50, 255))
        for dx, sh in ((-0.12, 228), (0.12, 228), (0.0, 246)):
            x = c + dx * Q
            d.polygon([(x - Q * 0.16, c - Q * 0.05), (x - Q * 0.1, c - Q * 0.33), (x, c - Q * 0.2), (x + Q * 0.1, c - Q * 0.33), (x + Q * 0.16, c - Q * 0.05)], fill=(sh, sh, sh - 4, 255))
            d.ellipse([x - Q * 0.16, c - Q * 0.2, x + Q * 0.16, c + Q * 0.16], fill=(sh, sh, sh - 4, 255))
    else:  # cluster
        rr2 = _r.Random(11)
        for _ in range(70):
            a, r = rr2.uniform(0, math.tau), Q * 0.36 * math.sqrt(rr2.random())
            x, y, s0 = c + math.cos(a) * r, c + math.sin(a) * r, Q * rr2.uniform(0.05, 0.08)
            g = rr2.randint(215, 250)
            d.ellipse([x - s0, y - s0, x + s0, y + s0], fill=(g, g, g - 6, 255))
    return im
heads = {k: head(k) for k in ('five', 'daisy', 'bell', 'cluster')}
full = Image.new('RGBA', (rgba.size[0] + S // 2, S), (0, 0, 0, 0))
full.paste(rgba, (0, 0)); full.paste(extra.resize((S // 2, S)), (rgba.size[0], 0))
tuft_rects = tuft_rects[:1]
head_rects = {}
for k, (name, im) in enumerate(heads.items()):
    x0, y0 = rgba.size[0] + (k % 2) * Q, S // 2 + (k // 2) * Q
    full.paste(Image.new('RGBA', (Q, Q), (0, 0, 0, 0)), (x0, y0))
    full.paste(im, (x0, y0))
    head_rects[name] = dict(x=x0 / full.size[0], y=y0 / S, w=Q / full.size[0], h=Q / S, avg=[0.95, 0.94, 0.92])
petal_rect = head_rects['five']
Wf = full.size[0]
for r in rects:   # (the leaves' x and w were fractions of the leaf image alone)
    r['x'] *= rgba.size[0] / Wf; r['w'] *= rgba.size[0] / Wf
# leaves at 1024 px tall for the view (webp with alpha), the full-size copy for Blender
full.save(work / 'leafphoto.png')
small = full.resize((full.size[0] // 2, full.size[1] // 2), Image.LANCZOS)
# (bleed colour under the transparent texels: no dark fringe in the mips)
arr = np.asarray(small).astype(np.float32); have = arr[..., 3] > 8; col = arr[..., :3].copy()
for _ in range(10):
    acc = sum(np.roll(np.roll(col * have[..., None], dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    cnt = sum(np.roll(np.roll(have.astype(np.float32), dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    fill = (~have) & (cnt > 0); col[fill] = acc[fill] / cnt[fill][:, None]; have = have | fill
arr[..., :3] = col
Image.fromarray(arr.astype(np.uint8), 'RGBA').save(public / 'leaves.webp', 'WEBP', quality=88, alpha_quality=95, method=6)
(work / 'leafphoto.json').write_text(json.dumps({'leaves': rects, 'tuft': tuft_rects[0], 'petal': petal_rect, 'heads': head_rects}, indent=1))
print('leaves', len(rects), 'atlas', full.size, (public / 'leaves.webp').stat().st_size, 'bytes')

# ---- bark per species
BARK = {'ginkgo': 'tree_bark_03', 'zelkova': 'japanese_zelkova_bark', 'cherry': 'sakura_bark', 'plane': 'bark_platanus',
        'fringe': 'japanese_hackberry_bark', 'pine': 'pine_bark', 'conifer': 'chinese_cedar_bark'}
meta = {}
for species, asset in BARK.items():
    files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
    info = json.loads(get(f'https://api.polyhaven.com/info/{asset}'))
    img = Image.open(io.BytesIO(get(files['Diffuse']['1k']['jpg']['url']))).convert('RGB').resize((512, 512), Image.LANCZOS)
    path = public / f'bark-{species}.webp'
    img.save(path, 'WEBP', quality=86, method=6)
    dims = info.get('dimensions') or [1500, 1500]
    meta[species] = dict(asset=asset, file=path.name, metres=round(dims[0] / 1000, 3), avg=[round(float(c) / 255, 4) for c in np.asarray(img).reshape(-1, 3).mean(0)])
    print(species, asset, path.stat().st_size, meta[species]['metres'])
(public / 'bark.json').write_text(json.dumps(meta, indent=1))
