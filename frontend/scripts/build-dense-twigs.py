"""Bake small photographic leaf-group tiles offline; no texture baking at runtime.
Uses existing photographed sprays, preserving their existing CC0 asset provenance.
"""
import asyncio,base64,gzip,json,struct,io
from pathlib import Path
import numpy as np
from PIL import Image
import etcpak
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1]/'public'/'3d'

async def bake():
 async with async_playwright()as pw:
  browser=await pw.chromium.launch(channel='msedge',headless=True)
  page=await browser.new_page()
  source='data:image/webp;base64,'+base64.b64encode((root/'twigs.webp').read_bytes()).decode()
  bark='data:image/webp;base64,'+base64.b64encode((root/'bark-plane.webp').read_bytes()).decode()
  data=await page.evaluate(r'''async ([source,barkSource])=>{
    const photo=new Image();photo.src=source;await photo.decode();
    const bark=new Image();bark.src=barkSource;await bark.decode();
    const atlas=document.createElement('canvas');atlas.width=1024;atlas.height=576;
    const a=atlas.getContext('2d');
    a.fillStyle='#354832';a.fillRect(0,0,1024,576);
    for(let cell=0;cell<20;cell++){
      const tile=document.createElement('canvas');tile.width=128;tile.height=192;const g=tile.getContext('2d');
      const sample=document.createElement('canvas');sample.width=256;sample.height=512;
      const s=sample.getContext('2d');s.drawImage(photo,cell%8*256,Math.floor(cell/8)*512,256,512,0,0,256,512);
      const pixels=s.getImageData(0,0,256,512).data,avg=[0,0,0];let count=0;
      for(let k=0;k<pixels.length;k+=4)if(pixels[k+3]>200){for(let c=0;c<3;c++)avg[c]+=pixels[k+c];count++;}
      g.fillStyle=`rgb(${avg.map(v=>Math.round(v/Math.max(1,count)*.74)).join(',')})`;g.fillRect(0,0,128,192);
      let seed=17+Math.floor(cell/2)*137;
      const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
      // Actual leaf photographs at a branch-sized scale, with baked overlap
      // shadows. No transparent holes, expensive runtime bake or extra sampler.
      for(let n=0;n<128;n++){
        const x=rnd()*156-14,y=rnd()*220-14,w=25+rnd()*22,h=w*1.8;
        g.save();g.translate(x,y);g.rotate(rnd()*Math.PI*2);g.globalAlpha=.88;
        g.shadowColor='rgba(12,23,9,.40)';g.shadowBlur=1.2;g.shadowOffsetY=1;
        const k=Math.floor(cell/2)*2+(n%2);g.drawImage(photo,k%8*256,Math.floor(k/8)*512,256,512,-w/2,-h/2,w,h);g.restore();
      }
      a.drawImage(tile,cell%8*128,Math.floor(cell/8)*192);
    }
    // Cell 20: bark shares the same material with woodland leaves and branches.
    a.drawImage(bark,4*128,2*192,128,192);
    return atlas.toDataURL('image/png').split(',')[1];
  }''',[source,bark])
  await browser.close()
  return Image.open(io.BytesIO(base64.b64decode(data))).convert('RGBA')

def compress(image,kind):
 # Orientation matches bitmapTexture(..., true), which already bakes the flip.
 level=np.asarray(image)[::-1].copy();blocks=bytearray();header=[]
 while True:
  h,w=level.shape[:2];H=(h+3)//4*4;W=(w+3)//4*4
  pixels=np.pad(level,((0,H-h),(0,W-w),(0,0)),mode='edge')
  encode=etcpak.compress_bc7 if kind=='bc7'else etcpak.compress_etc2_rgba
  data=encode(np.ascontiguousarray(pixels).tobytes(),W,H)
  header.append([w,h,len(blocks),len(data)]);blocks.extend(data)
  if max(w,h)==1:break
  level=np.asarray(Image.fromarray(level).resize((max(1,w//2),max(1,h//2)),Image.Resampling.BOX))
 head=json.dumps({'width':image.width,'height':image.height,'levels':header},separators=(',',':')).encode()
 packed=(b'BC7A'if kind=='bc7'else b'ETC2')+struct.pack('<I',len(head))+head+blocks
 (root/f'dense-twigs.{kind}.gz').write_bytes(gzip.compress(packed,9,mtime=0))

image=asyncio.run(bake());image.save(root/'dense-twigs.webp',quality=88,method=6)
for kind in ['bc7','etc2']:compress(image,kind)
print(json.dumps({p.name:p.stat().st_size for p in root.glob('dense-twigs.*')}))
