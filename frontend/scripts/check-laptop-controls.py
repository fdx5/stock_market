"""Check actual LaptopScreen controls in native and fallback fullscreen."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
ORIGIN=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5407'
OUT=ROOT/'tmp/laptop-controls-20261101';OUT.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio'])
 for size in [(390,844),(844,390),(1440,1000)]:
  for mode in ['native','rejected','unsupported']:
   ctx=b.new_context(viewport={'width':size[0],'height':size[1]},device_scale_factor=1,has_touch=True)
   if mode=='rejected':ctx.add_init_script("Element.prototype.requestFullscreen=function(){return Promise.reject(new Error('not available'));}")
   if mode=='unsupported':ctx.add_init_script("Element.prototype.requestFullscreen=undefined;")
   page=ctx.new_page();errors=[];loads=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def game(route):
    loads.append(1);route.fulfill(content_type='text/html',body='<html><body style="margin:0;background:#163340;color:white">Game state remains here<input id="game-input" aria-label="게임 입력"></body></html>')
   page.route('https://cattower.code404.app/**',game)
   page.goto(ORIGIN+'/scripts/fixtures/laptop-screen-controls.html')
   toolbar=page.get_by_role('toolbar',name='노트북 화면 조작')
   toolbar.get_by_role('button',name='전체화면 ⛶',exact=True).click()
   page.wait_for_selector('.wk-laptop-layer.is-fullscreen')
   if mode=='native':page.wait_for_function('document.fullscreenElement?.classList.contains("wk-laptop-layer")')
   else:assert page.evaluate('document.fullscreenElement===null')
   page.evaluate('window.__hideLaptopScreen=true')
   page.wait_for_timeout(100)
   state=toolbar.evaluate('''e=>({viewport:[innerWidth,innerHeight],buttons:[...e.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,x:r.x,y:r.y,w:r.width,h:r.height,reachable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})})''')
   assert [v['text'] for v in state['buttons']]==['축소','닫기'],state
   for v in state['buttons']:
    assert v['w']>=44 and v['h']>=44 and v['reachable'] and v['x']>=0 and v['y']>=0 and v['x']+v['w']<=state['viewport'][0]+1 and v['y']+v['h']<=state['viewport'][1]+1,state
   gamebox=page.locator('.wk-laptop iframe').bounding_box();barbox=toolbar.bounding_box()
   assert gamebox['y']>=barbox['y']+barbox['height']-.5,(gamebox,barbox)
   page.frame_locator('.wk-laptop iframe').locator('#game-input').fill('preserved')
   page.screenshot(path=str(OUT/f'{size[0]}-{mode}.png'))
   page.evaluate('window.__hideLaptopScreen=false')
   toolbar.get_by_role('button',name='축소',exact=True).click()
   page.wait_for_function('!document.fullscreenElement&&!document.querySelector(".wk-laptop-layer.is-fullscreen")')
   assert page.frame_locator('.wk-laptop iframe').locator('#game-input').input_value()=='preserved'
   assert len(loads)==1,loads
   # Enter once more, then close directly from fullscreen.
   toolbar.get_by_role('button',name='전체화면 ⛶',exact=True).click()
   page.wait_for_selector('.wk-laptop-layer.is-fullscreen')
   toolbar.get_by_role('button',name='닫기',exact=True).click()
   page.wait_for_function('!document.fullscreenElement&&!document.querySelector(".wk-laptop-layer")')
   assert json.loads(page.locator('#state').inner_text())=={'open':False,'zoom':False}
   assert not errors,errors
   results.append({'size':size,'mode':mode,'state':state,'iframeLoads':len(loads),'errors':errors})
   print('LAPTOP_CONTROLS_PASS',size,mode,flush=True);ctx.close()
 b.close()
(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
