"""Exercise actual worker transfers, closing in flight, reopening and the no-worker fallback."""
import argparse
import atexit
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument('--base', default='http://127.0.0.1:5186')
args = p.parse_args()
root = Path(__file__).resolve().parents[2]
files = [root / 'frontend/__neighbourqa.html', root / 'frontend/src/__neighbourqa.ts']
assert not any(f.exists() for f in files)
atexit.register(lambda: [f.unlink(missing_ok=True) for f in files])
files[0].write_text('<html><script type="module" src="/src/__neighbourqa.ts"></script></html>', encoding='utf8')
files[1].write_text('''
import {sceneWork} from './components/sceneWorkerClient';
import {neighbourArrays,neighbourGeometry} from './components/neighbourGeometry';
import {retainSceneMemory} from './components/sceneMemory';
const jobs=Array.from({length:275},(_,i)=>({building:{rings:[[[i,0],[i+18,0],[i+18,14],[i,14]]],
  height:14+i%4*6,base:i%2*3,floors:5+i%8},ground:i/8,floorM:2.9,color:[.137,.502,.973]}));
function compare(rows:any[]){
  if(rows.length!==jobs.length)throw Error('Buildings lost');
  let bytes=0;
  rows.forEach((row,i)=>{const original=neighbourArrays(jobs[i] as any);
    for(const key of Object.keys(original)){
      const a=new Uint8Array((original as any)[key].buffer),b=new Uint8Array(row[key].buffer);
      bytes+=b.length;
      if(a.length!==b.length||a.some((v,j)=>v!==b[j]))throw Error('Transferred pixels/vertices changed: '+key);
    }
    const geo=neighbourGeometry(row);geo.dispose();
  });return bytes;
}
(window as any).check=async()=>{
  const close=retainSceneMemory();
  const pending=sceneWork('neighbours',{jobs:jobs as any});
  if(!pending)throw Error('Worker did not start');
  close();
  let cancelled=false;
  try{await pending}catch(e){cancelled=String(e).includes('view released')}
  if(!cancelled)throw Error('Closing did not reject the pending build');
  const closeReopened=retainSceneMemory();
  const reopened=await sceneWork('neighbours',{jobs:jobs as any});
  if(!reopened)throw Error('Reopening did not replace the terminated worker');
  const bytes=compare(reopened);closeReopened();
  const closeFallback=retainSceneMemory(),WorkerOriginal=window.Worker;
  (window as any).Worker=class{constructor(){throw Error('Unsupported module worker')}};
  try{
    if(sceneWork('neighbours',{jobs:jobs as any})!==null)throw Error('Failed worker must select fallback');
    compare(jobs.map(job=>neighbourArrays(job as any)));
  }finally{window.Worker=WorkerOriginal;closeFallback()}
  return {buildings:jobs.length,transferredBytes:bytes,cancelled,reopened:true,fallback:true};
};
''', encoding='utf8')
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.base + '/__neighbourqa.html')
    page.wait_for_function('typeof window.check === "function"')
    report = page.evaluate('check()')
    browser.close()
assert not errors, errors
report['errors'] = errors
(root / 'tmp/neighbour-worker-quality.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
