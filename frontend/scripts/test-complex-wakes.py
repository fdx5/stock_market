"""Compare all boat wake pixels and sampling parameters to the original painter."""
import argparse, atexit, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:39413');a=p.parse_args()
root=Path(__file__).resolve().parents[2];front=root/'frontend'
files=[front/'src/components/__wakesOriginal.ts',front/'src/__wakesqa.ts',front/'__wakesqa.html']
assert not any(f.exists() for f in files)
atexit.register(lambda:[f.unlink(missing_ok=True) for f in files])
original=subprocess.check_output(['git','show','18d71c5:frontend/src/components/sceneBoats.ts'],cwd=root).decode('utf8')
files[0].write_text(original+'\nexport function originalWakes(){return wakeTextures();}\n',encoding='utf8')
files[2].write_text('<html><script type="module" src="/src/__wakesqa.ts"></script></html>',encoding='utf8')
files[1].write_text('''import {originalWakes} from './components/__wakesOriginal';import {prepareWakes} from './components/sceneBoats';
(window as any).check=async()=>{const a=originalWakes(),b=await prepareWakes();if(!b)throw Error('worker cancelled');const out:any={};for(const name of Object.keys(a)){const x=(a as any)[name],y=(b as any)[name];for(const k of ['wrapS','wrapT','flipY','colorSpace','minFilter','magFilter'])if(x[k]!==y[k])throw Error('sampling changed '+name+' '+k);const c=document.createElement('canvas');c.width=y.image.width;c.height=y.image.height;c.getContext('2d',{willReadFrequently:true})!.drawImage(y.image,0,0);const before=x.image.getContext('2d').getImageData(0,0,c.width,c.height).data,after=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let max=0,total=0;for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);max=Math.max(max,d);total+=d}out[name]={max,mean:total/before.length,workerBitmap:y.image instanceof ImageBitmap}}return out};''',encoding='utf8')
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.goto(a.base+'/__wakesqa.html');page.wait_for_function("typeof check==='function'")
    result=page.evaluate('check()');b.close()
print(json.dumps(result));assert not errors,errors;assert all(v['max']==0 and v['workerBitmap'] for v in result.values()),result
(root/'tmp/wakes-quality.json').write_text(json.dumps(result,indent=2),encoding='utf8')
