"""Actual map popup -> original-plan chooser -> furnished bathrooms (Chrome)."""
import json,re,sys,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
ORIGIN=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5407'
LIVE='--live' in sys.argv
NATIVE='--native' in sys.argv or LIVE
OUT=ROOT/'tmp/roomtour-20261101'/('live' if LIVE else 'production' if NATIVE else 'local')
OUT.mkdir(parents=True,exist_ok=True)
CAT=json.loads((ROOT/'tmp/floorplan-complex-20261101/samick-before.json').read_text(encoding='utf8'))
ID='11680:수서동:708:삼익'
ITEM=dict(id=ID,name='삼익',brand=None,sgg='강남구',dong='수서동',group='강남구',price=150000,area=49.2,pyeong=14.9,deal_date='2026-10-20',floor=8,built=1992,base_price=None,base_date=None,change_pct=None,trades=1,trades_all=3,history=[],high_1y=None,low_1y=None,trades_1y=3,types=[])
TYPES=[dict(key=round(a),area=a,pyeong=a/3.3058,price=150000,deal_date='2026-10-20',floor=8,base_price=None,base_date=None,change_pct=None,trades=1,history=[],high_1y=None,low_1y=None,trades_1y=1,trades_total=1) for a in [49.2,60,84.48]]
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio','--ignore-gpu-blocklist','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'])
 for mobile in ([False] if '--desktop-only' in sys.argv else [False,True]):
  ctx=b.new_context(viewport={'width':390 if mobile else 1440,'height':844 if mobile else 1000},device_scale_factor=1)
  page=ctx.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def api(route):
   u=urllib.parse.urlparse(route.request.url);q=urllib.parse.parse_qs(u.query);path=u.path
   if not path.startswith('/api/'):return route.continue_()
   requests.append(path)
   if LIVE:return route.continue_()
   if path.endswith('/complex'):return route.fulfill(json={'id':ID,'item':ITEM,'period':'1y','types':TYPES})
   if path.endswith('/buildings'):return route.fulfill(json={'id':ID,'name':'삼익','built':1992,'found':True,'center':{'lat':37.488,'lon':127.1},'buildings':[{'floors':15}], 'vworld_key':None})
   if path.endswith('/units'):return route.fulfill(status=503,json={})
   if path.endswith('/floor-plans'):
    assert q.get('name')==['삼익'],q
    return route.continue_() if NATIVE else route.fulfill(json=CAT)
   if path.endswith('/floor-plan-image') or path.endswith('/floor-plan-analysis'):
    if NATIVE:return route.continue_()
    d=next(v for v in CAT['plans'] if v['key']==q['key'][0]);typ=d['typeName'];root=ROOT/'tmp/floorplan-complex-20261101'
    if path.endswith('/floor-plan-image'):return route.fulfill(path=str(root/f'samick-{typ}.jpg'),content_type='image/jpeg')
    return route.fulfill(json=json.loads((root/f'samick-{typ}-candidate.json').read_text(encoding='utf8')))
   return route.fulfill(status=503,json={})
  page.route('**/api/**',api)
  page.goto(ORIGIN+'/realestate-map?complex='+urllib.parse.quote(ID)+'&area=84',wait_until='domcontentloaded')
  tour=page.get_by_role('button',name='룸투어(임장)');tour.wait_for(timeout=60000)
  page.locator('.re-sheet-select select').select_option('84') if page.locator('.re-sheet-select select').count() else None
  old=page.url
  box=tour.bounding_box();three=page.get_by_role('button',name='3D 건물뷰',exact=True).bounding_box()
  assert box['x']>=three['x']+three['width'] and abs(box['y']-three['y'])<2,(box,three)
  css=tour.evaluate("e=>({border:getComputedStyle(e).borderColor,shadow:getComputedStyle(e).boxShadow,shine:getComputedStyle(e,'::after').animationName})")
  assert css['shadow']!='none' and css['shine']=='re-roomtour-shine',css
  page.emulate_media(reduced_motion='reduce')
  assert tour.evaluate("e=>getComputedStyle(e,'::after').animationName")=='none'
  page.emulate_media(reduced_motion='no-preference')
  page.wait_for_timeout(600)
  page.screenshot(path=str(OUT/f'popup-{mobile}.png'))
  tour.click();page.wait_for_url('**/walk?*',timeout=30000)
  q=urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
  assert q['id']==[ID] and q['area']==['84.48'] and q['back']==[urllib.parse.urlparse(old).path+'?'+urllib.parse.urlparse(old).query],q
  # Enable the existing renderer diagnostics without changing the selected route.
  page.goto(page.url+'&debug=1&hour=14',wait_until='domcontentloaded')
  page.locator('.wk-choose').wait_for(timeout=45000)
  page.wait_for_function('()=>document.querySelector(".wk-go")&&!document.querySelector(".wk-go").disabled',timeout=60000)
  assert page.locator('.wk-original-plan .wk-chips button.on').inner_text().startswith('115'),page.locator('.wk-choose').inner_text()
  assert not any(x.endswith('/building-floors') or x.endswith('/indoor-building') for x in requests),requests
  page.locator('.wk-go').click()
  page.wait_for_function('()=>window.__walk?.interior?.perf.loadMs>0&&!document.querySelector(".wk-loading")',timeout=90000)
  state=page.evaluate('''()=>{const i=window.__walk.interior;return {area:i.o.plan.areaExclusiveM2,source:i.o.plan.source,bathrooms:i.furn.bathrooms,rooms:i.o.plan.rooms,fixtures:i.furn.interactables.map(f=>({id:f.id,room:f.room.id,channel:f.channel})),canvas:[i.renderer?.domElement?.width,i.renderer?.domElement?.height]};}''')
  baths=[r for r in state['rooms'] if r['type'] in ['bathroom','ensuite']]
  assert state['source']=='image_analysis' and abs(state['area']-84.48)<.1 and len(state['bathrooms'])==len(baths)==2,state
  for r in baths:
   wc=next(f for f in state['fixtures'] if f['id']=='wc-'+r['id'])
   shower=next(f for f in state['fixtures'] if f['room']==r['id'] and f.get('channel')=='shower')
  assert page.locator('.wk-source-inspection').count()==0
  state['circulation']=page.evaluate('()=>window.__walk.interior.furn.circulation')
  assert any(c['kind']=='bed' for c in state['circulation']) and any(c['kind']=='sofa' for c in state['circulation']),state['circulation']
  assert all(c['path'] for c in state['circulation']),state['circulation']
  assert '통행 제한을 보존' not in page.locator('body').inner_text()
  state['movement']=page.evaluate('''()=>{const i=window.__walk.interior;const before=i.pos.clone();i.keys.add('KeyW');for(let k=0;k<12;k++)i.move(1/60);i.keys.clear();return {inspection:i.inspectionMode,distance:i.pos.distanceTo(before)};}''')
  assert not state['movement']['inspection'] and state['movement']['distance']>.01,state['movement']
  state['mirrors']=page.evaluate('''()=>{const i=window.__walk.interior;return i.mirrors.map(m=>({room:m.userData.room,reflection:m.userData.reflection}));}''')
  state['doorframe']=page.evaluate('''()=>{const m=window.__walk.interior.P.doorFrame;return {offset:m.polygonOffset,factor:m.polygonOffsetFactor,units:m.polygonOffsetUnits};}''')
  assert state['doorframe']['offset'] and state['doorframe']['factor']<0,state['doorframe']
  master=next(r for r in state['rooms'] if r['type']=='master')
  assert any(m['room']==master['id'] and m['reflection']=='local-plane' for m in state['mirrors']),state['mirrors']
  state['masterReflection']=page.evaluate('''()=>{const i=window.__walk.interior,mr=i.furn.mirrors.find(m=>i.o.plan.rooms.find(r=>r.id===m.room)?.type==='master'),m=i.mirrors.find(m=>m.userData.room===mr.room);i.camera.position.copy(mr.pos).addScaledVector(mr.normal,1.1);i.camera.lookAt(mr.pos);i.camera.updateMatrixWorld();i.scene.updateMatrixWorld(true);m.forceUpdate=true;m.onBeforeRender(i.renderer,i.scene,i.camera,m.geometry,m.material,null);const reflected=m._reflectionCameras.get(i.camera),actual=i.camera.position.clone().sub(m.position).dot(mr.normal),virtual=reflected.position.clone().sub(m.position).dot(mr.normal);return {room:mr.room,actual,virtual,error:Math.abs(actual+virtual)};}''')
  assert state['masterReflection']['error']<.0001,state['masterReflection']
  page.evaluate('''()=>{const i=window.__walk.interior,mr=i.furn.mirrors.find(m=>i.o.plan.rooms.find(r=>r.id===m.room)?.type==='master');i.pos.set(mr.pos.x+mr.normal.x*1.1,mr.pos.z+mr.normal.z*1.1);i.yaw=Math.atan2(mr.normal.x,mr.normal.z);i.pitch=-.18;i.vel.set(0,0);i.applyCamera(0);}''')
  page.wait_for_timeout(1000)
  state['mirrorPerf']=page.evaluate('''async()=>{const i=window.__walk.interior;i.perf.intervals=[];i.perf.worst=0;await new Promise(r=>setTimeout(r,5000));return i.stats();}''')
  page.screenshot(path=str(OUT/f'master-mirror-{mobile}.png'))
  state['narrowDoor']=page.evaluate('''()=>{
    const i=window.__walk.interior;
    // Test the real furnished source geometry and its door leaves, not a fake gap.
    for(const d of i.shell.doors)if(d.kind!=='front'){d.t=d.want=1;if(d.kind==='slide')d.leaf.position.copy(d.slideTo);else d.pivot.rotation.y=d.openYaw;}
    const crossings=(a,b,s)=>{const vx=b[0]-a[0],vz=b[1]-a[1],sx=s[2]-s[0],sz=s[3]-s[1],den=vx*sz-vz*sx;if(Math.abs(den)<1e-12)return false;const t=((s[0]-a[0])*sz-(s[1]-a[1])*sx)/den,u=((s[0]-a[0])*vz-(s[1]-a[1])*vx)/den;return t>=0&&t<=1&&u>=0&&u<=1;};
    for(const o of [...i.o.plan.openings].filter(o=>!['window','balcony_window','front_door'].includes(o.type)).sort((a,b)=>a.width-b.width)){
      const x=o.axis==='x',a=x?[o.at-.20,o.center]:[o.center,o.at-.20],b=x?[o.at+.20,o.center]:[o.center,o.at+.20];
      const segs=i.segsIn(a[0],a[1],b[0],b[1]);if(segs.some(s=>crossings(a,b,s)))continue;
      if(i.furnitureBounds.some(r=>a[0]>r[0]&&a[0]<r[2]&&a[1]>r[1]&&a[1]<r[3]))continue;
      i.pos.set(...a);i.vel.set(0,0);i.yaw=x?-Math.PI/2:Math.PI;i.seated=null;i.keys.add('KeyW');
      for(let k=0;k<30;k++)i.move(1/60);i.keys.clear();
      const crossed=x?i.pos.x>o.at+.01:i.pos.y>o.at+.01;
      if(crossed)return {width:o.width,from:a,to:[i.pos.x,i.pos.y],crossed};
    }
    return null;
  }''')
  assert state['narrowDoor'] and state['narrowDoor']['crossed'],state['narrowDoor']
  state['actions']=page.evaluate('''()=>{const i=window.__walk.interior;return i.furn.interactables.filter(f=>f.id.startsWith('wc-')||f.channel==='shower').map(f=>({id:f.id,result:f.act()}));}''')
  assert all(a['result']==('flush' if a['id'].startswith('wc-') else 'click') for a in state['actions']),state['actions']
  state['perf']=page.evaluate('''async()=>{const i=window.__walk.interior;i.perf.intervals=[];i.perf.worst=0;await new Promise(r=>setTimeout(r,5000));return i.stats();}''')
  state['gpu']=page.evaluate('''()=>{const r=window.__walk.renderer,g=r.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),canvas:[r.domElement.width,r.domElement.height],dpr:devicePixelRatio};}''')
  page.screenshot(path=str(OUT/f'interior-{mobile}.png'))
  assert not errors,errors
  results.append({'mobile':mobile,'css':css,'state':state,'errors':errors})
  print('ROOMTOUR_PASS',mobile,flush=True);ctx.close()
 b.close()
(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
