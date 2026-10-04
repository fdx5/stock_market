"""Windows Playwright WebKit functional QA, not a physical iPad memory measurement."""
import asyncio,argparse,json
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image,ImageStat

parser=argparse.ArgumentParser()
parser.add_argument('base')
parser.add_argument('--out',default='tmp/safari-scene.json')
args=parser.parse_args()
URL='/realestate-map?sido=41&period=3m&sgg=41150&dong=%EC%8B%A0%EA%B3%A1%EB%8F%99&complex=41150%3A%EC%8B%A0%EA%B3%A1%EB%8F%99%3A580%3A%EC%8B%A0%EB%8F%99%EC%95%84%ED%8C%8C%EB%B0%80%EB%A6%AC%EC%97%90&3d=1&area=85&pr=4'

async def main():
 async with async_playwright() as p:
  browser=await p.webkit.launch(headless=True)
  page=await browser.new_page(viewport={'width':1024,'height':1366},device_scale_factor=2,has_touch=True)
  await page.add_init_script("Object.defineProperties(navigator,{platform:{get:()=> 'MacIntel'},maxTouchPoints:{get:()=>5}});const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...a){const c=old.call(this,kind,...a);if(kind==='webgl2')window.__gl=c;return c;};window.__canvasPeak=0;for(const key of ['width','height']){const d=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key);Object.defineProperty(HTMLCanvasElement.prototype,key,{...d,set(v){d.set.call(this,v);if(this.closest('.re-holo-stage'))window.__canvasPeak=Math.max(window.__canvasPeak,this.width*this.height);}});}")
  errors=[];warnings=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:warnings.append(m.text) if m.type in ['error','warning'] else None)
  await page.goto(args.base+URL,wait_until='domcontentloaded')
  stage=page.locator(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage')
  await page.wait_for_function("document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage')?.dataset.shownAt",timeout=120000)
  select=page.locator(':is(.re-holo-layer,.re-holo--expanded) .re-holo-nearby')
  await select.wait_for(timeout=90000)
  results=[]
  for cycle in range(3):
   if cycle:await page.set_viewport_size({'width':1366,'height':1024} if cycle==1 else {'width':1024,'height':1366})
   if cycle:
    previous=await stage.evaluate('e=>e.dataset.shownAt')
    await select.select_option('41150:신곡동:456:신일1' if cycle==1 else '')
    await page.wait_for_function("old=>{const s=document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage');return s?.dataset.shownAt&&s.dataset.shownAt!==old;}",arg=previous,timeout=120000)
   await page.wait_for_timeout(18000)
   state=await stage.evaluate('e=>({...e.dataset})')
   pixels=await stage.locator('canvas').evaluate_all('es=>es.map(e=>({width:e.width,height:e.height,pixels:e.width*e.height}))')
   assert state['memoryBudget']=='bounded',state
   assert all(c['pixels']<=2000000 for c in pixels),pixels
   peak=await page.evaluate('window.__canvasPeak');assert peak<=2000000,peak
   shot=Path(args.out).with_name(Path(args.out).stem+f'-{cycle}.png')
   await stage.screenshot(path=str(shot))
   with Image.open(shot) as image:
    rgb=image.convert('RGB');std=ImageStat.Stat(rgb).stddev
   results.append({'cycle':cycle,'state':state,'canvases':pixels,'canvasPeak':peak,'imageStd':std,'errors':errors.copy(),'warnings':warnings.copy()})
   Path(args.out).write_text(json.dumps(results,indent=2),encoding='utf8')
   assert max(std)>15,{'blank':std,'state':state,'warnings':warnings}
  available=await page.evaluate("!!window.__gl?.getExtension('WEBGL_lose_context')")
  if available:
   previous=await stage.evaluate('e=>e.dataset.shownAt')
   await page.evaluate("window.__loss=window.__gl.getExtension('WEBGL_lose_context');window.__loss.loseContext()")
   await page.wait_for_function("document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage')?.dataset.contextRecovery==='waiting'",timeout=10000)
   await page.wait_for_timeout(1000)
   await page.evaluate('window.__loss.restoreContext()')
   await page.wait_for_function("document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage')?.dataset.contextRecovery==='restored'",timeout=30000)
   await page.wait_for_function("old=>{const s=document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage');return s?.dataset.shownAt&&s.dataset.shownAt!==old;}",arg=previous,timeout=120000)
   await page.wait_for_timeout(4000)
   await stage.screenshot(path=str(Path(args.out).with_name(Path(args.out).stem+'-restored.png')))
   results.append({'recovery':await stage.evaluate('e=>({...e.dataset})'),'errors':errors.copy()})
  Path(args.out).write_text(json.dumps(results,indent=2),encoding='utf8')
  assert not errors,errors
  print(json.dumps({'cycles':3,'errors':errors,'contextRecovery':available,'pixels':pixels}))
  await browser.close()
asyncio.run(main())
