"""Source-backed entry for Sindo6/studio and mobile laptop controls. No DB tooling."""
import json,re,sys,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'tmp/ho-won-floorplans-20261101'
origin=next((a for a in sys.argv[1:] if a.startswith('http')),'http://127.0.0.1:5407');production=origin.startswith('https:')
out=BASE/('production-entry' if production else 'local-entry');out.mkdir(exist_ok=True)
studio=json.loads((BASE/'sample-14794-catalogue.json').read_text(encoding='utf8'))['plans'][0]
raw=(BASE/'search-신일엘리시움.html').read_text(encoding='utf8');info=json.loads(re.search(r'baseQueryResult\s*=\s*({[^\r\n]+});',raw)[1])
cases=[dict(name='신도6',id='41150:호원동:401-1:신도6',lat=37.726955,lon=127.038392,town='호원동',region='41150',area=59.9,typ='81B',naver='2127'),
 dict(name='신일엘리시움',id='41150:호원동:459:신일엘리시움',lat=float(info['complexMapYCrdn']),lon=float(info['complexMapXCrdn']),town='호원동',region='41150',area=studio['exclusiveArea'],typ=studio['typeName'],naver='14794',studio=True),
 dict(name='삼익',id='11680:수서동:708:삼익',lat=37.488,lon=127.1,town='수서동',region='11680',area=84.48,typ='115',naver='668',laptop=True)]
if '--laptop-only' in sys.argv:cases=[c for c in cases if c.get('laptop')]
if '--sindo-only' in sys.argv:cases=cases[:1]
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio','--ignore-gpu-blocklist','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'])
 for c in cases:
  mobile=bool(c.get('laptop'));ctx=b.new_context(viewport={'width':390 if mobile else 1440,'height':844 if mobile else 1000},has_touch=mobile,device_scale_factor=1)
  page=ctx.new_page();errors=[];lookups=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('https://cattower.code404.app/**',lambda r:r.fulfill(content_type='text/html',body='<html><body style="margin:0;background:#163340;color:white">Game<input id="game-input"></body></html>'))
  def api(route):
   u=urllib.parse.urlparse(route.request.url);path=u.path
   if not path.startswith('/api/'):return route.continue_()
   if '--live' in sys.argv:return route.continue_()
   if path.endswith('/floor-plans') or path.endswith('/floor-plan-analysis') or path.endswith('/floor-plan-image'):
    if path.endswith('/floor-plans'):lookups.append(urllib.parse.parse_qs(u.query))
    if production:return route.continue_()
    response=ctx.request.get('http://127.0.0.1:8021'+path+'?'+u.query,timeout=80000);return route.fulfill(response=response)
   if path.endswith('/buildings'):return route.fulfill(json={'id':c['id'],'name':c['name'],'built':1997,'center':{'lat':c['lat'],'lon':c['lon']},'buildings':[{'floors':15}],'vworld_key':None})
   return route.fulfill(status=503,json={})
  page.route('**/api/**',api)
  page.goto(origin+'/walk?'+urllib.parse.urlencode({'tour':'1','id':c['id'],'area':c['area'],'debug':'1','hour':'14'}),wait_until='domcontentloaded')
  page.locator('.wk-choose').wait_for(timeout=45000)
  page.locator('.wk-original-plan .wk-chips').first.get_by_role('button',name=re.compile('^'+re.escape(c['typ']))).click(timeout=60000)
  page.wait_for_function('()=>document.querySelector(".wk-go")&&!document.querySelector(".wk-go").disabled',timeout=80000)
  assert '원본 공간 구획 재확인 필요' not in page.locator('body').inner_text()
  page.locator('.wk-go').click()
  try:page.wait_for_function('()=>window.__walk?.interior?.perf.loadMs>0&&!document.querySelector(".wk-loading")',timeout=90000)
  except Exception:
   page.screenshot(path=str(out/(c['naver']+'-failed.png')))
   print('ENTRY_FAILURE',c['name'],page.locator('body').inner_text(),errors,flush=True)
   raise
  state=page.evaluate('''()=>{const i=window.__walk.interior;return {source:i.o.plan.source,url:i.o.plan.imageAnalysis.sourceUrl,rooms:i.o.plan.rooms,bathrooms:i.furn.bathrooms,circulation:i.furn.circulation.map(c=>({room:c.room,kind:c.kind,size:c.size})),inspection:i.inspectionMode};}''')
  assert state['source']=='image_analysis' and not state['inspection'] and 'rletNo='+c['naver'] in state['url'],state
  assert len(state['bathrooms'])==len([r for r in state['rooms'] if r['type'] in ['bathroom','ensuite']]),state
  if c.get('studio'):
   assert any(r['type']=='living' and 'bedroom' in r.get('combinedUses',[]) for r in state['rooms']),state
   assert any(v['kind']=='bed' and next(r for r in state['rooms'] if r['id']==v['room'])['type']=='living' for v in state['circulation']),state
  if c.get('laptop'):
   def open_laptop():
    page.evaluate('''()=>{const i=window.__walk.interior;if(!i.furn.laptop.on){i.target=i.furn.interactables.find(x=>x.id==='laptop');i.interact();}}''')
    page.wait_for_function('()=>window.__walk.interior.furn.laptop.open>=1')
    page.evaluate("window.__walk.interior.zoomScreen('laptop')")
    try:page.locator('.wk-laptop-bar').wait_for(timeout=15000)
    except Exception:
     print('LAPTOP_FAILURE',page.evaluate('''()=>{const i=window.__walk.interior;return {open:i.furn.laptop.open,on:i.furn.laptop.on,seated:i.seated,corners:i.laptopScreen(),layer:!!document.querySelector('.wk-laptop-layer')};}'''),flush=True)
     page.screenshot(path=str(out/'laptop-failed.png'));raise
   open_laptop();bar=page.get_by_role('toolbar',name='노트북 화면 조작')
   bar.get_by_role('button',name='전체화면 ⛶',exact=True).tap()
   page.wait_for_function('document.fullscreenElement?.classList.contains("wk-laptop-layer")')
   page.frame_locator('.wk-laptop iframe').locator('#game-input').fill('preserved')
   page.screenshot(path=str(out/'laptop-native.png'))
   assert bar.get_by_role('button',name='축소',exact=True).is_visible() and bar.get_by_role('button',name='닫기',exact=True).is_visible()
   bar.get_by_role('button',name='축소',exact=True).tap();page.wait_for_function('!document.fullscreenElement&&!document.querySelector(".wk-laptop-layer.is-fullscreen")')
   assert page.frame_locator('.wk-laptop iframe').locator('#game-input').input_value()=='preserved'
   open_laptop();bar.get_by_role('button',name='전체화면 ⛶',exact=True).tap();page.wait_for_function('!!document.fullscreenElement')
   # CDP keys sent into a cross-origin iframe do not invoke Chrome's own UI
   # Escape shortcut. Exercise the parent key handler, then native exit event.
   page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',key:'Escape',bubbles:true}))")
   page.wait_for_function('!document.fullscreenElement&&!document.querySelector(".wk-laptop-layer.is-fullscreen")')
   assert page.locator('.wk-laptop-layer').count()==1 and page.locator('.wk-choose').count()==0
   open_laptop();bar.get_by_role('button',name='전체화면 ⛶',exact=True).tap();page.wait_for_function('!!document.fullscreenElement')
   page.evaluate('document.exitFullscreen()');page.evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{code:'Escape',key:'Escape',bubbles:true}))")
   page.wait_for_function('!document.fullscreenElement&&!document.querySelector(".wk-laptop-layer.is-fullscreen")')
   assert page.locator('.wk-choose').count()==0
   page.evaluate("Element.prototype.requestFullscreen=()=>Promise.reject(new Error('unsupported'))")
   open_laptop();bar.get_by_role('button',name='전체화면 ⛶',exact=True).tap();page.wait_for_selector('.wk-laptop-layer.is-fullscreen')
   page.screenshot(path=str(out/'laptop-fallback.png'))
   pos=page.evaluate('()=>window.__walk.interior.pos.toArray()');bar.get_by_role('button',name='닫기',exact=True).focus();page.keyboard.press('KeyW');assert page.evaluate('()=>window.__walk.interior.pos.toArray()')==pos
   page.keyboard.press('Space');page.wait_for_selector('.wk-laptop-layer',state='detached')
   assert page.evaluate('()=>!window.__walk.interior.furn.laptop.on') and page.locator('.wk-choose').count()==0
   state['laptop']={'nativeControls':True,'shrunkWithStatePreserved':True,'escapeKeptInterior':True,'fallbackClosed':True}
  state['perf']=page.evaluate('''async()=>{const i=window.__walk.interior;i.perf.intervals=[];i.perf.worst=0;await new Promise(r=>setTimeout(r,5000));return i.stats();}''')
  state['gpu']=page.evaluate('''()=>{const r=window.__walk.renderer,g=r.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),canvas:[r.domElement.width,r.domElement.height],dpr:devicePixelRatio};}''')
  assert not errors,errors
  page.screenshot(path=str(out/(c['naver']+'-interior.png')))
  results.append({'case':c,'lookups':lookups,'state':state,'errors':errors});(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8');print('RECOVERY_ENTRY_PASS',c['name'],c['typ'],flush=True);ctx.close()
 b.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
