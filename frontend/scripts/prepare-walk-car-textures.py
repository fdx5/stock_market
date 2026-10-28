"""CC0 photographic rubber/alloy micro-surfaces for the walk's cars only."""
import io
import json
import urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

OUT=Path(__file__).resolve().parents[1]/'public/3d/walk/cars';OUT.mkdir(parents=True,exist_ok=True)
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'KStockHub/1.0 car-material-preparation'})
    with urllib.request.urlopen(req,timeout=90) as r:return r.read()
meta={}
for name,asset in [('rubber','rubber_tiles'),('alloy','metal_plate_02')]:
    files=json.loads(get('https://api.polyhaven.com/files/'+asset));info=json.loads(get('https://api.polyhaven.com/info/'+asset))
    urls={k:files[k]['2k']['jpg']['url'] for k in ['Diffuse','nor_gl','Rough']}
    images={k:Image.open(io.BytesIO(get(v))).convert('RGB') for k,v in urls.items()}
    # Preserve scanned fine grain rather than transferring the sample's overall
    # weathered colour to clean alloy wheels or copying floor-tile joints to tyres.
    diff=np.asarray(images['Diffuse'],dtype=np.float32)@np.array([.2126,.7152,.0722])
    blur=np.asarray(images['Diffuse'].filter(ImageFilter.GaussianBlur(28)),dtype=np.float32)@np.array([.2126,.7152,.0722])
    relative=np.clip(diff/np.maximum(blur,1)*128,80,180)
    normal=np.asarray(images['nor_gl']);rough=np.asarray(images['Rough'].convert('L'))
    packed=np.stack([normal[...,0],normal[...,1],rough,relative],axis=2).astype('uint8')
    Image.fromarray(packed).save(OUT/(name+'-scan-2k.webp'),quality=95,alpha_quality=100,method=6)
    meta[name]={'asset':asset,'source':'https://polyhaven.com/a/'+asset,'license':'CC0-1.0','authors':info.get('authors'),'urls':urls,
                'processing':'RGBA=OpenGL normal XY, roughness, relative photographed luminance; understated micro-detail, no source colour transfer'}
(OUT/'SOURCES.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared photographic 2048px rubber and metal surface maps.')
