"""Compare original page painters and off-thread painters at 1x and 2x, including data maps."""
import argparse, atexit, json
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--base',default='http://127.0.0.1:5180');a=ap.parse_args()
root=Path(__file__).resolve().parents[2]
files=[root/'frontend/__paintqa.html',root/'frontend/src/__paintqa.ts']
assert not any(p.exists() for p in files)
atexit.register(lambda:[p.unlink(missing_ok=True) for p in files])
files[0].write_text('<html><body><script type="module" src="/src/__paintqa.ts"></script></body></html>',encoding='utf-8')
files[1].write_text('''import {facadeSteps,plinthSteps,contextSteps,NEIGHBOUR_PALETTE,paletteFor,runNow} from './components/complexScene';
import {preparedContext} from './components/preparedPaint';
import {paintTextures} from './components/paintClient';
(window as any).assetVersion=import.meta.env.VITE_PAINT_ASSETS;
const w=new Worker(new URL('./components/paintRasterWorker.ts',import.meta.url),{type:'module'});
let id=0;
const raster=(job:any)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('raster timeout '+JSON.stringify(job))),15000);w.onerror=e=>{clearTimeout(timer);reject(Error(e.message))};w.onmessage=e=>{clearTimeout(timer);resolve(e.data)};w.postMessage({id:++id,job})});
const pixels=(image:any,flip=false)=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const g=c.getContext('2d',{willReadFrequently:true})!;if(flip){g.translate(0,c.height);g.scale(1,-1)}g.drawImage(image,0,0);return g.getImageData(0,0,c.width,c.height).data};
(window as any).check=async()=>{const reports=[];
const jobs:any[]=[{kind:'facade',palette:paletteFor('래미안'),seed:123},{kind:'facade',palette:paletteFor('자이'),seed:991},{kind:'facade',palette:paletteFor('힐스테이트'),seed:431,scale:2},{kind:'plinth',seed:136,tone:'#8d8a84'},{kind:'plinth',seed:1031,tone:'#3c3f45'},...['apt','villa','shop','office'].flatMap(style=>[1,2].map(scale=>({kind:'context',style,scale})))];
for(const job of jobs){console.log('paint-start',JSON.stringify(job));const steps=job.kind==='facade'?facadeSteps(job.palette,job.seed,job.scale??1):job.kind==='plinth'?plinthSteps(job.seed,job.tone):job.style==='apt'?facadeSteps(NEIGHBOUR_PALETTE,4242,job.scale):contextSteps(1000+job.style.length,job.style,job.scale);
const original=runNow(steps);console.log('original-ready');const reply=await preparedContext(job)??await raster(job);console.log('worker-ready');if(!reply.bitmaps)throw Error('worker failed');
const normalized=await paintTextures(job,async()=>true);if(!normalized)throw Error('normalization failed');
for(const name of Object.keys(original)){const t=original[name],bmp=reply.bitmaps[name];if(t.image.width!==bmp.width||t.image.height!==bmp.height)throw Error('resolution changed');
const x=pixels(t.image),y=pixels(bmp,t.flipY!==reply.params[name].flipY);let max=0,sum=0,changed=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);max=Math.max(max,d);sum+=d;if(d)changed++}
const p=reply.params[name];if(p.flipY!==false||t.anisotropy!==p.anisotropy||t.colorSpace!==p.colorSpace||t.repeat.x!==p.repeat[0]||t.repeat.y!==p.repeat[1]||t.offset.x!==p.offset[0]||t.offset.y!==p.offset[1])throw Error('texture sampling changed');
const nt=normalized[name];if(nt.flipY)throw Error('ImageBitmap orientation relies on unsupported WebGL flipY');
const nx=pixels(nt.image,t.flipY);for(let i=0;i<x.length;i++)if(Math.abs(nx[i]-x[i])>1)throw Error('WebGL/WebGPU texel orientation changed');nt.dispose();
reports.push({job:job.kind,style:job.style,scale:job.scale,name,width:bmp.width,height:bmp.height,max,mean:sum/x.length,changed});bmp.close();t.image.width=t.image.height=1;t.dispose()}}
w.terminate();return reports};
''',encoding='utf-8')
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m:print(m.text,flush=True) if m.type!='debug' else None);page.goto(a.base+'/__paintqa.html');page.wait_for_function("typeof window.check === 'function'")
 version=page.evaluate('window.assetVersion');assert version,'Paint asset fast path is disabled; enable paintAssetsPlugin in Vite'
 report=page.evaluate('check()');b.close()
 out=root/'tmp/complex-paint-quality.json';out.write_text(json.dumps({'maps':report,'errors':errors},indent=2),encoding='utf-8')
 print(json.dumps({'maps':len(report),'max_pixel_difference':max(r['max'] for r in report),'mean_pixel_difference':sum(r['mean'] for r in report)/len(report),'errors':errors}))
 assert not errors,errors
 assert all(r['max']<=1 for r in report),report
