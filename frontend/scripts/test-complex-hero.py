"""Compare worker-built hero vehicles to the checked-in original: exact geometry and pixels."""
import argparse, atexit, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:39413');a=p.parse_args()
root=Path(__file__).resolve().parents[2];front=root/'frontend'
files=[front/'src/components/__heroOriginal.ts',front/'src/__heroqa.ts',front/'__heroqa.html']
assert not any(p.exists() for p in files)
atexit.register(lambda:[p.unlink(missing_ok=True) for p in files])
files[0].write_bytes(subprocess.check_output(['git','show','18d71c5:frontend/src/components/heroVehicles.ts'],cwd=root))
files[2].write_text('<html><script type="module" src="/src/__heroqa.ts"></script></html>',encoding='utf8')
files[1].write_text('''import {coupangTruck,cybertruck} from './components/__heroOriginal';
import {heroSurface} from './components/heroVehicles';import {vehicleShapes,heroGeometry} from './components/vehicleClient';
function geo(a:any,b:any){if(JSON.stringify(a.groups)!==JSON.stringify(b.groups))throw Error('groups changed');for(const key of Object.keys(a.attributes)){const x=a.attributes[key].array,y=b.attributes[key].array;if(x.length!==y.length||x.some((v:number,i:number)=>v!==y[i]))throw Error('geometry changed '+key)}if(JSON.stringify(a.index?.array)!==JSON.stringify(b.index?.array))throw Error('index changed')}
function pixels(a:any,b:any){const x=a.getContext('2d').getImageData(0,0,a.width,a.height).data,y=b.getContext('2d').getImageData(0,0,b.width,b.height).data;if(x.length!==y.length)throw Error('image size changed');let max=0,total=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);max=Math.max(max,d);total+=d}return{max,mean:total/x.length}}
(window as any).check=async()=>{await document.fonts.ready;const s=await vehicleShapes(),out:any={};for(const[name,make]of [['coupang',coupangTruck],['cyber',cybertruck]] as const){const a=make(),b=heroGeometry(s.heroes[name]!);geo(a.geometry,b.geometry);geo(a.wheel,b.wheel);for(const k of ['dims','wheels','plate','radius'])if(JSON.stringify(a[k as keyof typeof a])!==JSON.stringify(b[k as keyof typeof b]))throw Error('metadata changed '+k);const m=heroSurface(name);out[name]={geometry:'exact',pixels:pixels((a.material as any)[name==='coupang'?'map':'roughnessMap'].image,m[name==='coupang'?'map':'roughnessMap']!.image)}}return out};''',encoding='utf8')
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.goto(a.base+'/__heroqa.html');page.wait_for_function("typeof check==='function'")
    result=page.evaluate('check()');b.close()
print(json.dumps(result));assert not errors,errors;assert all(v['pixels']['max']==0 for v in result.values()),result
(root/'tmp/hero-quality.json').write_text(json.dumps(result,indent=2),encoding='utf8')
