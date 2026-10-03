"""Export the original deterministic brushed-steel roughness pixels losslessly."""
import argparse,atexit,hashlib,json
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:39415');a=p.parse_args()
root=Path(__file__).resolve().parents[2];front=root/'frontend'
paths=[front/'src/__steelexport.ts',front/'__steelexport.html']
assert not any(x.exists() for x in paths)
atexit.register(lambda:[x.unlink(missing_ok=True) for x in paths])
paths[0].write_text('''import {heroSurface} from './components/heroVehicles';
(window as any).exportSteel=async()=>{const m=heroSurface('cyber'),t=m.roughnessMap!,c=t.image as HTMLCanvasElement;
const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));
const bytes=[...new Uint8Array(await blob.arrayBuffer())];t.dispose();m.dispose();return bytes};''',encoding='utf8')
paths[1].write_text('<script type="module" src="/src/__steelexport.ts"></script>',encoding='utf8')
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page();page.goto(a.base+'/__steelexport.html')
 page.wait_for_function('typeof exportSteel === "function"');data=bytes(page.evaluate('exportSteel()'));b.close()
digest=hashlib.sha256(data).hexdigest()[:20];out=front/'public/3d/steel'/f'{digest}.png';out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data)
print(json.dumps({'digest':digest,'bytes':len(data)}))
