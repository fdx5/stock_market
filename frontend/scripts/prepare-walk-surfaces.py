"""Prepare CC0 scans for /walk. Writes assets only; never accesses app data.

Public API metadata supplies download URLs. Sources and processing are recorded in
public/3d/walk/out/surface-sources.json. Run from any working directory.
"""
import io
import json
import math
import random
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / 'public/3d/walk/out'
OUT.mkdir(parents=True, exist_ok=True)
META = {}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'KStockHub/1.0 walk-material-preparation'})
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read()


def scan(asset):
    files = json.loads(get('https://api.polyhaven.com/files/' + asset))
    info = json.loads(get('https://api.polyhaven.com/info/' + asset))
    META[asset] = {'source': 'https://polyhaven.com/a/' + asset, 'license': 'CC0-1.0',
                   'authors': info.get('authors'), 'dimensions_mm': info.get('dimensions'), 'files': {}}

    def image(key):
        url = files[key]['2k']['jpg']['url']
        META[asset]['files'][key] = url
        return Image.open(io.BytesIO(get(url)))
    return image


wall = scan('beige_wall_001')
diff = wall('Diffuse').convert('RGB')
normal = np.asarray(wall('nor_gl').convert('RGB'))
rough = np.asarray(wall('Rough').convert('L'))
lum = np.asarray(diff, dtype=np.float32) @ np.array([.2126, .7152, .0722])
# Relative brightness keeps the architectural paint while preserving photographed
# pores, trowel marks and weathering. Packed scan is sampled at its real metre scale.
base = np.asarray(diff.filter(ImageFilter.GaussianBlur(90)), dtype=np.float32) @ np.array([.2126, .7152, .0722])
packed = np.stack([np.clip(lum / np.maximum(base, 1) * 128, 0, 255), normal[..., 0], normal[..., 1], rough], axis=2).astype('uint8')
Image.fromarray(packed).save(OUT/'facade-render-2k.webp', quality=95, alpha_quality=100, method=6)

bark = scan('japanese_zelkova_bark')
bark('Diffuse').convert('RGB').save(OUT/'zelkova-bark-2k.webp', quality=92, method=6)
bark('nor_gl').convert('RGB').save(OUT/'zelkova-bark-normal-2k.webp', quality=95, method=6)
bark('Rough').convert('RGB').save(OUT/'zelkova-bark-rough-2k.webp', quality=90, method=6)

leaves = scan('island_tree_02')
diff = leaves('leaves_diff').convert('RGB')
alpha = leaves('leaves_alpha').convert('L')
# Extract connected photographed leaves. Components are found at quarter size.
small = np.asarray(alpha.resize((512, 512))) > 96
seen = np.zeros_like(small, bool)
rectangles = []
for y in range(512):
    for x in range(512):
        if not small[y, x] or seen[y, x]:
            continue
        todo = [(x, y)]; seen[y, x] = True; xx = []; yy = []
        while todo:
            a, b = todo.pop(); xx.append(a); yy.append(b)
            for c, d in [(a-1,b),(a+1,b),(a,b-1),(a,b+1)]:
                if 0 <= c < 512 and 0 <= d < 512 and small[d,c] and not seen[d,c]:
                    seen[d,c] = True; todo.append((c,d))
        box = (min(xx)*4, min(yy)*4, (max(xx)+1)*4, (max(yy)+1)*4)
        if (box[2]-box[0])*(box[3]-box[1]) > 16000:
            rectangles.append(box)
if not rectangles:
    raise RuntimeError('No photographed leaf components found')
tiles = []
for box in rectangles:
    leaf = diff.crop(box).convert('RGBA'); leaf.putalpha(alpha.crop(box))
    # Neutral luminance; the scene supplies seasonal colour per tree, not a white leaf.
    data = np.array(leaf)
    gray = np.asarray(leaf.convert('L'), dtype=np.float32)
    mask = data[...,3] > 128
    gray = np.clip(gray / max(float(gray[mask].mean()),1) * 188, 40, 245).astype('uint8')
    data[...,:3] = gray[...,None]
    tiles.append(Image.fromarray(data))
canvas = Image.new('RGBA',(1024,1024))
draw = ImageDraw.Draw(canvas)
rr = random.Random(712)
draw.line([(500,990),(490,520),(550,50)], fill=(116,110,87,255),width=8)
for row in range(9):
    stem_y = 130 + row*88
    for side in [-1,1]:
        end = (510+side*(210+rr.randrange(70)), stem_y-75)
        draw.line([(505,stem_y+55),end], fill=(132,126,103,255),width=4)
        for k in range(3):
            source = rr.choice(tiles).copy(); source.thumbnail((150,210),Image.Resampling.LANCZOS)
            source = source.rotate(side*(48+rr.randrange(30)),resample=Image.Resampling.BICUBIC,expand=True)
            px = int(510+(end[0]-510)*(k+1)/3)-source.width//2
            py = int(stem_y+55+(end[1]-stem_y-55)*(k+1)/3)-source.height//2
            canvas.alpha_composite(source,(px,py))

def save_cutout(im,name):
    # Bleed edge colour into transparent pixels for clean antialiased mipmaps.
    a = np.array(im).astype('float32'); have = a[...,3]>8; color=a[...,:3].copy()
    for _ in range(12):
        accum=sum(np.roll(np.roll(color*have[...,None],dy,0),dx,1) for dy in [-1,0,1] for dx in [-1,0,1])
        count=sum(np.roll(np.roll(have.astype('float32'),dy,0),dx,1) for dy in [-1,0,1] for dx in [-1,0,1])
        fill=(~have)&(count>0); color[fill]=accum[fill]/count[fill,None]; have|=fill
    a[...,:3]=color
    Image.fromarray(a.astype('uint8')).save(OUT/name,quality=94,alpha_quality=100,method=6)

save_cutout(canvas,'leaf-spray-1k.webp')
needles=Image.new('RGBA',(1024,1024)); draw=ImageDraw.Draw(needles)
for j in range(5):
    a=-math.pi/2+(j-2)*.4
    start=(512,950); end=(512+math.cos(a)*680,950+math.sin(a)*680)
    draw.line([start,end],fill=(122,113,88,255),width=5)
    for k in range(12,90):
        t=k/95; px=start[0]+(end[0]-start[0])*t; py=start[1]+(end[1]-start[1])*t
        for side in [-1,1]:
            angle=a+side*(.35+rr.random()*.55); length=65+rr.random()*90
            shade=rr.randrange(140,235)
            draw.line([(px,py),(px+math.cos(angle)*length,py+math.sin(angle)*length)],fill=(shade,shade,shade,255),width=3)
save_cutout(needles,'pine-spray-1k.webp')
(OUT/'surface-sources.json').write_text(json.dumps(META,ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared 2K plaster and bark scans, photographed 1K leaf spray, original pine spray.')
