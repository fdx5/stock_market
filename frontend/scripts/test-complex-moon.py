"""Require identical moon halo pixels after moving painting to a worker."""
import argparse, atexit, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:39413');a=p.parse_args()
root=Path(__file__).resolve().parents[2];front=root/'frontend'
files=[front/'src/components/__moonOriginal.ts',front/'src/__moonqa.ts',front/'__moonqa.html']
assert not any(f.exists() for f in files)
atexit.register(lambda:[f.unlink(missing_ok=True) for f in files])
files[0].write_bytes(subprocess.check_output(['git','show','18d71c5:frontend/src/components/complexScene.ts'],cwd=root))
files[2].write_text('<html><script type="module" src="/src/__moonqa.ts"></script></html>',encoding='utf8')
files[1].write_text('''import {moonInSky} from './components/__moonOriginal';import {moonGlow} from './components/moonGlow';
(window as any).check=async()=>{const original=moonInSky(),job=moonGlow();try{for(let i=0;i<500&&!job.texture.image;i++)await new Promise(r=>setTimeout(r,10));if(!job.texture.image)throw Error('worker timeout');const old=(original.group.children[0] as any).material.map;const canvas=document.createElement('canvas');canvas.width=canvas.height=128;canvas.getContext('2d')!.drawImage(job.texture.image,0,0);const x=old.image.getContext('2d').getImageData(0,0,128,128).data,y=canvas.getContext('2d')!.getImageData(0,0,128,128).data;let max=0,total=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);max=Math.max(max,d);total+=d}if(old.colorSpace!==job.texture.colorSpace||old.flipY!==job.texture.flipY)throw Error('texture properties changed');return{max,mean:total/x.length,workerBitmap:job.texture.image instanceof ImageBitmap}}finally{original.dispose();job.dispose();const cancelled=moonGlow();cancelled.dispose()}};''',encoding='utf8')
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.goto(a.base+'/__moonqa.html');page.wait_for_function("typeof check==='function'")
    result=page.evaluate('check()');page.wait_for_timeout(250);b.close()
print(json.dumps(result));assert not errors,errors;assert result['max']==0,result;assert result['workerBitmap'],result
(root/'tmp/moon-quality.json').write_text(json.dumps(result,indent=2),encoding='utf8')
