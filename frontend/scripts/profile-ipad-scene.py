"""Comparative local GPU workload, not a physical iPad benchmark. No GPU readbacks."""
import argparse,asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright

parser=argparse.ArgumentParser()
parser.add_argument('base')
parser.add_argument('--out',required=True)
parser.add_argument('--browser',choices=['chromium','webkit'],default='chromium')
parser.add_argument('--pressure',action='store_true',help='Inject slow display frames to verify the adaptive resolution controller')
args=parser.parse_args()
URL='/realestate-map?sido=11&period=3m&sgg=11680&dong=%EC%88%98%EC%84%9C%EB%8F%99&complex=11680%3A%EC%88%98%EC%84%9C%EB%8F%99%3A795%3A%EA%B0%95%EB%82%A8%EB%8D%B0%EC%8B%9C%EC%95%99%ED%8F%AC%EB%A0%88&area=85&3d=1&hour=12&renderer=webgl'

async def main():
 async with async_playwright() as p:
  browser=await (p.chromium.launch(channel='msedge',headless=True) if args.browser=='chromium' else p.webkit.launch(headless=True))
  page=await browser.new_page(viewport={'width':1024,'height':1366},device_scale_factor=2,has_touch=True)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.add_init_script("""Object.defineProperties(navigator,{platform:{get:()=> 'MacIntel'},maxTouchPoints:{get:()=>5},deviceMemory:{get:()=>undefined}});
   window.__work={calls:0,triangles:0,frames:[]};const old=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(kind,...a){const gl=old.call(this,kind,...a);if(kind==='webgl2'&&gl&&!gl.__profile){gl.__profile=true;window.__gl=gl;
    for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const f=gl[name];gl[name]=function(...a){if(window.__measuring){window.__work.calls++;if(a[0]===gl.TRIANGLES)window.__work.triangles+=(name.includes('Elements')?a[1]:a[2])/3*(name.includes('Instanced')?a[name.includes('Elements')?4:3]:1);}return f.apply(this,a);};}
   }return gl;};""")
  await page.goto(args.base+URL,wait_until='domcontentloaded')
  await page.wait_for_function("document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage')?.dataset.plantsPhase==='complete'",timeout=180000)
  await page.get_by_title('\ucc98\uc74c \uc2dc\uc810\uc73c\ub85c',exact=True).click()
  await page.wait_for_timeout(25000)
  await page.screenshot(path=str(Path(args.out).with_suffix('.png')))
  report=await page.evaluate("""async()=>{window.__measuring=true;window.__work.calls=window.__work.triangles=0;const frames=[];let start=performance.now(),last=start;
   await new Promise(done=>{function sample(now){frames.push(now-last);last=now;if(now-start<15000)requestAnimationFrame(sample);else done();}requestAnimationFrame(sample);});
   window.__measuring=false;const state={...document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage').dataset};const gl=window.__gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
   return {state,frames:frames.length,fps:frames.length*1000/(last-start),p95FrameMs:frames.sort((a,b)=>a-b)[Math.floor(frames.length*.95)],drawsPerFrame:window.__work.calls/frames.length,trianglesPerFrame:window.__work.triangles/frames.length,pixels:gl.canvas.width*gl.canvas.height,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};}""")
  if args.pressure:
   await page.evaluate("()=>{window.__savedRaf=window.requestAnimationFrame;window.requestAnimationFrame=cb=>window.__savedRaf(()=>setTimeout(()=>cb(performance.now()),80));}")
   await page.wait_for_timeout(22000)
   pressure=await page.locator(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage').evaluate('e=>({...e.dataset})')
   assert float(pressure['pixelRatio'])<=.71,pressure
   await page.evaluate('()=>{window.requestAnimationFrame=window.__savedRaf;}')
   await page.wait_for_timeout(17000)
   restored=await page.locator(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage').evaluate('e=>({...e.dataset})')
   assert .7<float(restored['pixelRatio'])<=1.5,restored
   report['pressure']=pressure;report['restored']=restored
  report['errors']=errors;Path(args.out).write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report));assert not errors,errors
  await browser.close()
asyncio.run(main())
