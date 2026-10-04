import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as pw:
  report={}
  for engine in ['chromium','webkit','webkit-ipad']:
   launch={'channel':'msedge'} if engine=='chromium' else {}
   device=next(v for k,v in pw.devices.items() if k.startswith('iPad')) if engine=='webkit-ipad' else {}
   settings={k:v for k,v in device.items() if k!='default_browser_type'}
   b=await getattr(pw,'webkit' if engine=='webkit-ipad' else engine).launch(headless=True,**launch);context=await b.new_context(**settings);p=await context.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
   await p.goto('http://127.0.0.1:4196/__bvh-bench');await p.wait_for_function('!!window.checkBvhLifecycle')
   life=await p.evaluate('window.checkBvhLifecycle()');assert life['cancelled'] and life['aborted'] and life['unchanged'] and life['active']==0,life
   if engine=='webkit-ipad':assert life['peak']==1,life
   await context.route('**/*.wasm',lambda route:route.abort())
   fallback=await p.evaluate('window.checkBvhFallback()');assert fallback['fallback'] and isinstance(fallback['height'],(float,int)),fallback
   await context.unroute('**/*.wasm');good=await p.evaluate('window.checkBvhFallback()');assert not good['fallback'] and good['height']==fallback['height'],good
   async def slow(route):
    await asyncio.sleep(1.5)
    try:await route.abort()
    except Exception:pass
   await context.route('**/*.wasm',slow)
   timed=await p.evaluate('async()=>{const start=performance.now(),r=await window.checkBvhFallback();return {...r,ms:performance.now()-start};}')
   assert timed['fallback'] and 900<=timed['ms']<2000,timed
   await context.unroute_all(behavior='wait')
   await p.wait_for_timeout(600)
   assert not errors,errors;report[engine]={'lifecycle':life,'fallback':fallback,'wasmRestored':good,'timeoutFallback':timed,'errors':errors};await b.close()
  Path('tmp/bvh-browser-tests.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
asyncio.run(main())
