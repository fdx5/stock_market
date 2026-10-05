import asyncio,json,argparse,statistics
from pathlib import Path
from playwright.async_api import async_playwright
p=argparse.ArgumentParser();p.add_argument('--kernel',action='store_true');a=p.parse_args()
counter="""const OriginalWorker=Worker;window.__liveWorkers=0;window.Worker=class extends OriginalWorker{constructor(...a){super(...a);window.__liveWorkers++;this.live=true;}terminate(){if(this.live){window.__liveWorkers--;this.live=false;}return super.terminate();}};"""
async def main():
 async with async_playwright() as pw:
  result={}
  for name in (['chromium'] if a.kernel else ['chromium','webkit','webkit-ipad']):
   engine=pw.webkit if name.startswith('webkit') else pw.chromium
   browser=await engine.launch(headless=True,**({'channel':'msedge'}if name=='chromium'else{}))
   options={k:v for k,v in pw.devices['iPad Pro 11'].items() if k!='default_browser_type'}if name=='webkit-ipad'else{}
   context=await browser.new_context(**options);page=await context.new_page();await page.add_init_script(counter)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:4196/__hybrid-bench');await page.wait_for_function('window.__hybridHarness')
   if a.kernel:
    result={'environment':await page.evaluate('({ua:navigator.userAgent,cores:navigator.hardwareConcurrency})'),'geometry':[],'instances':[]}
    for case in ['ganeung','shindonga']:
     r=await page.evaluate('name=>window.runGeometryCase(name,7)',case);assert r['mismatches']==0,r
     r['medianMs']={m:statistics.median(v['ms']for v in r['rows']if v['mode']==m)for m in ['js','wasm']};result['geometry'].append(r)
    for count in [1000,10000]:
     r=await page.evaluate('n=>window.runInstanceCase(n,7)',count);assert r['maxError']<2e-6 and r['memoryBefore']==r['memoryAfter'],r
     r['medianMs']={m:statistics.median(v['ms']for v in r['rows']if v['mode']==m)for m in ['js','wasm']};result['instances'].append(r)
    result['forestMemory']=await page.evaluate('window.runForestMemory()');assert result['forestMemory']['newBytes']<result['forestMemory']['oldBytes'] and result['forestMemory']['sharedAttributes'],result
   else:
    good=await page.evaluate('window.checkHybridLifecycle()');assert good['mode']=='rust-wasm' and good['instanceWasm'] and good['shared']==1 and good['closed']==0 and good['cancelled'],good
    await context.route('**/*.wasm',lambda r:r.abort())
    blocked=await page.evaluate('window.checkHybridLifecycle()');assert blocked['mode']=='javascript' and not blocked['instanceWasm'] and blocked['closed']==0,blocked
    await context.unroute('**/*.wasm');restored=await page.evaluate('window.checkHybridLifecycle()');assert restored['mode']=='rust-wasm' and restored['instanceWasm'] and restored['closed']==0,restored
    result[name]={'good':good,'blocked':blocked,'restored':restored,'errors':errors}
   assert not errors,errors;await browser.close()
  path=Path('tmp/hybrid-kernel.json' if a.kernel else 'tmp/hybrid-browser.json');path.write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result),flush=True)
asyncio.run(main())
