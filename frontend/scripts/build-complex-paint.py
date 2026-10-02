"""Generate lossless, seed-independent paint maps using the original browser painters.
Run against Vite: python scripts/build-complex-paint.py --base http://127.0.0.1:5180
Vite checks the painter source hash before using these files; stale maps are ignored.
"""
import argparse, atexit, base64, hashlib, json
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--base',default='http://127.0.0.1:5180');args=ap.parse_args()
root=Path(__file__).resolve().parents[1]
h=hashlib.sha256()
for name in ['complexScene.ts','normalKernel.ts']: h.update((root/'src/components'/name).read_text(encoding='utf-8').encode('utf-8'))
version=h.hexdigest()[:20]
out=root/'public/3d/paint'/version;out.mkdir(parents=True,exist_ok=True)
files=[root/'__bakepaint.html',root/'src/__bakepaint.ts']
assert not any(p.exists() for p in files)
atexit.register(lambda:[p.unlink(missing_ok=True) for p in files])
files[0].write_text('<html><script type="module" src="/src/__bakepaint.ts"></script></html>',encoding='utf-8')
files[1].write_text('''import {facadeSteps,plinthSteps,contextSteps,NEIGHBOUR_PALETTE,runNow} from './components/complexScene';
(window as any).bake=async(name:string)=>{
  const [kind,style,scaleText]=name.split('-');const scale=Number(kind==='facade'?style:scaleText)||1;
  const steps=kind==='plinth'?plinthSteps(13,'#8d8a84'):kind==='facade'||style==='apt'?facadeSteps(NEIGHBOUR_PALETTE,4242,scale):contextSteps(1000+style.length,style as any,scale);
  const made=runNow(steps), out:any={};
  for(const [key,t] of Object.entries(made)) {
    if(kind==='context'||key==='normalMap') {
      const c=t.image as HTMLCanvasElement;
      const blob=c instanceof OffscreenCanvas?await c.convertToBlob({type:'image/png'}):await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));
      const data=await new Promise<string>(r=>{const f=new FileReader();f.onload=()=>r(String(f.result).split(',')[1]);f.readAsDataURL(blob)});
      out[key]={data,params:{wrapS:t.wrapS,wrapT:t.wrapT,flipY:t.flipY,anisotropy:t.anisotropy,colorSpace:t.colorSpace,repeat:[t.repeat.x,t.repeat.y],offset:[t.offset.x,t.offset.y]}};
    }
    t.image.width=t.image.height=1;t.dispose();
  }
  return out;
};''',encoding='utf-8')
manifest={}
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page()
 page.goto(args.base+'/__bakepaint.html');page.wait_for_function("typeof window.bake==='function'")
 for job in ['facade-1','facade-2','plinth']+[f'context-{s}-{k}' for s in ['apt','villa','shop','office'] for k in [1,2]]:
  maps=page.evaluate('name=>bake(name)',job);manifest[job]={}
  for name,m in maps.items():
   filename=f'{job}-{name}.png';(out/filename).write_bytes(base64.b64decode(m['data']))
   params=m['params']
   if name in ['normalMap','rmMap']: params['surfaceKey']=job.replace('context-apt-', 'facade-')
   manifest[job][name]={'file':filename,'params':params}
 b.close()
(out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
print(json.dumps({'sourceHash':version,'maps':sum(len(v) for v in manifest.values()),'bytes':sum(p.stat().st_size for p in out.iterdir())}))
