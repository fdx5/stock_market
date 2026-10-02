"""Export original GPU-canvas effects as lossless prepared pixels."""
import atexit, argparse, hashlib, json
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:39413');a=p.parse_args()
root=Path(__file__).resolve().parents[2]
paths=[root/'frontend/src/__effectsexport.ts',root/'frontend/__effectsexport.html']
assert not any(x.exists() for x in paths)
atexit.register(lambda:[x.unlink(missing_ok=True) for x in paths])
paths[0].write_text('''
import {paintWakes} from './components/sceneBoats';
async function png(image:CanvasImageSource,w:number,h:number){
 const c=new OffscreenCanvas(w,h);c.getContext('2d')!.drawImage(image,0,0);
 return [...new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer())];
}
(window as any).exportEffects=async()=>{
 const steps=paintWakes((w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c});
 let next=steps.next();while(!next.done)next=steps.next();
 const files:Record<string,number[]>={};
 for(const [name,t] of Object.entries(next.value)){files[name]=await png(t.image,t.image.width,t.image.height);t.dispose();}
 const c=new OffscreenCanvas(128,128),g=c.getContext('2d')!;
 const grad=g.createRadialGradient(64,64,0,64,64,64);
 grad.addColorStop(0,'rgba(255,250,235,0.32)');grad.addColorStop(.3,'rgba(225,232,255,0.1)');grad.addColorStop(1,'rgba(200,215,255,0)');
 g.fillStyle=grad;g.fillRect(0,0,128,128);
 files.moon=[...new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer())];
 return files;
};''',encoding='utf8')
paths[1].write_text('<script type="module" src="/src/__effectsexport.ts"></script>',encoding='utf8')
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page();page.goto(a.base+'/__effectsexport.html')
    page.wait_for_function('typeof exportEffects === "function"')
    files={k:bytes(v) for k,v in page.evaluate('exportEffects()').items()};browser.close()
digest=hashlib.sha256(b''.join(files[k] for k in sorted(files))).hexdigest()[:20]
out=root/'frontend/public/3d/effects'/digest;out.mkdir(parents=True,exist_ok=True)
for k,v in files.items():(out/(k+'.png')).write_bytes(v)
print(json.dumps({'digest':digest,'bytes':sum(map(len,files.values())),'files':list(files)}))
