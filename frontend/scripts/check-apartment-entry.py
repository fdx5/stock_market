import sys,json,re,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]/'tmp'/'floorplan-entry-20261101'
origin=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5407'
native='--native' in sys.argv
OUT=ROOT/('production-browser' if native else 'browser');OUT.mkdir(exist_ok=True)
samick=json.loads((ROOT.parent/'floorplan-complex-20261101/samick-before.json').read_text(encoding='utf8'))
sh=json.loads((ROOT/'sh-catalogue.json').read_text(encoding='utf8'))
results=[]
cases=[
 {'label':'sh114-wrong-collected-phase','name':'수서1단지 에스에이치빌 114','dong':'114','complexId':'11680:일원동:711:수서1-2단지','pnu':'1168011400107110000','lat':37.49172379,'lon':127.08855363,'type':'33','register':'503','source':'sh'},
 {'label':'samick-sign-register503','name':'삼익 403동','dong':'403동','complexId':'11680:수서동:708:삼익','pnu':'1168011500107080000','lat':37.488,'lon':127.1,'type':'68','register':'503','source':'samick'},
 {'label':'sh114-sign-register503','name':'수서1단지 에스에이치빌 114','dong':'114','pnu':'1168011400107110000','lat':37.49172379,'lon':127.08855363,'type':'25','register':'503','source':'sh'},
 {'label':'sh114-missing-use-and-floors','name':'수서1단지 에스에이치빌 114','dong':'114','pnu':'1168011400107110000','lat':37.49172379,'lon':127.08855363,'type':'33','register':'empty','source':'sh'},
 {'label':'legacy-empty-handoff','name':'','dong':'','pnu':'1168011500107080000','lat':37.488,'lon':127.1,'type':'68','register':'503','source':'samick','legacy':True},
 {'label':'cold-sh-link','name':'수서1단지 에스에이치빌 114동','dong':'114동','pnu':'1168011400107110000','lat':37.49172379,'lon':127.08855363,'type':'33','register':'503','source':'sh','cold':True}
]
if '--phase-only' in sys.argv:cases=cases[:1]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio','--ignore-gpu-blocklist','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'])
 for case in cases:
  ctx=b.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
  ctx.add_init_script('window.__entryCase='+json.dumps(case,ensure_ascii=True)+';if(location.pathname==="/walk"){const at=new URLSearchParams(location.search).get("at");window.__arrivedEntry=JSON.parse(sessionStorage.getItem("walk.entry:"+at)||"null");}')
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGE_ERROR',str(e),flush=True)))
  catalogue=samick if case['source']=='samick' else sh
  lookups=[];facility_requests=[]
  def parcel(route):
   q=urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query)
   if q.get('data')==['LP_PA_CBND_BUBUN']:
    town='수서동 708' if case['source']=='samick' else '일원동 711'
    data={'response':{'status':'OK','result':{'featureCollection':{'features':[{'properties':{'pnu':case['pnu'],'addr':'서울특별시 강남구 '+town}}]}}}}
   else:
    lo,la=case['lon'],case['lat'];ring=[[lo-.0002,la-.00012],[lo+.0002,la-.00012],[lo+.0002,la+.00012],[lo-.0002,la+.00012],[lo-.0002,la-.00012]]
    data={'response':{'status':'OK','result':{'featureCollection':{'features':[{'id':'actual-gis-shape','properties':{'pnu':case['pnu'],'bld_nm':case['name'],'usability':'02000','grnd_flr':'15','height':'45'},'geometry':{'type':'Polygon','coordinates':[ring]}}]}}}}
   route.fulfill(content_type='application/javascript',body=q['callback'][0]+'('+json.dumps(data)+');')
  page.route('https://api.vworld.kr/req/data?*',parcel)
  def api(route):
   u=urllib.parse.urlparse(route.request.url);q=urllib.parse.parse_qs(u.query);path=u.path
   if not path.startswith('/api/'):return route.continue_()
   if path.endswith('walk-config'):return route.fulfill(json={'vworld_key':'test','vworld_domain':origin})
   if path.endswith('building-floors'):
    return route.fulfill(status=503,json={}) if case['register']=='503' else route.fulfill(json={'building':{'name':case['name'],'floors':0},'floors':[]})
   if path.endswith('places'):return route.fulfill(json={'items':[]})
   if path.endswith('explore'):
    return route.fulfill(json={'items':[{'id':'11680:수서동:708:삼익','name':'삼익','built':1992}] if case['source']=='samick' else []})
   if path.endswith('units'):
    return route.fulfill(status=503,json={})
   if path.endswith('floor-plans'):
    lookups.append(q);assert '403' not in q['name'][0] and '114' not in q['name'][0],q
    if native:return route.continue_()
    return route.fulfill(json=catalogue)
   if path.endswith('floor-plan-analysis') or path.endswith('floor-plan-image'):
    if native:return route.continue_()
    drawing=next(v for v in catalogue['plans'] if v['key']==q['key'][0]);typ=drawing['typeId'] if case['source']=='sh' else drawing['typeName']
    root=ROOT if case['source']=='sh' else ROOT.parent/'floorplan-complex-20261101';prefix='sh' if case['source']=='sh' else 'samick'
    if path.endswith('floor-plan-image'):return route.fulfill(path=str(root/(prefix+'-'+typ+'.jpg')),content_type='image/jpeg')
    return route.fulfill(json=json.loads((root/(prefix+'-'+typ+'-candidate.json')).read_text(encoding='utf8')))
   if path.endswith('indoor-building'):facility_requests.append(path);return route.fulfill(json={'status':'unavailable'})
   return route.fulfill(status=503,json={})
  page.route('**/api/**',api)
  if case.get('cold'):
   page.goto(origin+'/walk?at='+str(case['lat'])+','+str(case['lon'])+'&debug=1&hour=14')
  elif case.get('legacy') or native:
   # Production checks use the exact serialized drone handoff contract; the local
   # check below also executes the real card event and DroneSession methods.
   lo,la=case['lon'],case['lat'];entry={'lat':la,'lon':lo,'name':'' if case.get('legacy') else case['name'],'floors':0 if case.get('legacy') else 15,'heading':0,'foot':[[lo-.0002,la-.00012],[lo+.0002,la-.00012],[lo+.0002,la+.00012],[lo-.0002,la+.00012]],'campus':[],'door':[lo,la-.00012]}
   if not case.get('legacy'):entry.update(kind='apartment',dong=case['dong'],pnu=case['pnu'],complexId=case.get('complexId'))
   ctx.add_init_script('sessionStorage.setItem("walk.entry:'+f'{la:.6f},{lo:.6f}'+'",'+json.dumps(json.dumps(entry))+')')
   page.goto(origin+'/walk?at='+f'{la:.6f},{lo:.6f}'+'&debug=1&hour=14')
  else:
   page.goto(origin+'/scripts/fixtures/apartment-entry-handoff.html',wait_until='domcontentloaded')
   try:page.locator('.re-drone-card-inside').click(timeout=20000)
   except Exception:
    print('HANDOFF_ERROR',errors,page.locator('body').inner_text()[:3000],flush=True);raise
   page.wait_for_url('**/walk?at=*',timeout=20000)
   arrived=page.evaluate('window.__arrivedEntry');assert arrived['name']==case['name'] and arrived['kind']=='apartment' and arrived['pnu']==case['pnu'],arrived
  page.locator('.wk-choose').wait_for(timeout=60000)
  assert not facility_requests,facility_requests
  page.locator('.wk-original-plan .wk-chips').first.get_by_role('button',name=re.compile('^'+case['type'])).click(timeout=45000)
  page.wait_for_function('()=>document.querySelector(".wk-go")&&!document.querySelector(".wk-go").disabled',timeout=45000)
  text=page.locator('.wk-choose').inner_text();assert '원본 도면 검증 대기' not in text and '평균 추정' not in text
  page.screenshot(path=str(OUT/(case['label']+'-selection.png')))
  page.locator('.wk-go').click()
  try:page.wait_for_function('()=>window.__walk?.interior?.perf.loadMs>0&&!document.querySelector(".wk-loading")',timeout=90000)
  except Exception:
   page.screenshot(path=str(OUT/(case['label']+'-failed.png')));(OUT/(case['label']+'-failed.txt')).write_text(page.locator('body').inner_text(),encoding='utf8');raise
  state=page.evaluate('''()=>{const i=window.__walk.interior;return {source:i.o.plan.source,facility:!!i.o.plan.facility,name:i.o.plan.complexName,dong:i.o.plan.dong,type:i.o.plan.unitType,kitchens:i.furn.kitchens,inspection:i.inspectionMode,rooms:i.o.plan.rooms,sourceUrl:i.o.plan.imageAnalysis?.sourceUrl};}''')
  assert state['source']=='image_analysis' and not state['facility'] and len(state['kitchens'])==1,state
  if case['source']=='sh':assert state['dong']=='114동' and '공개도면' in state['type'],state
  page.screenshot(path=str(OUT/(case['label']+'-interior.png')))
  state['frameStats']=page.evaluate('''async()=>{const i=window.__walk.interior;i.perf.intervals=[];i.perf.worst=0;await new Promise(r=>setTimeout(r,5000));return i.stats();}''')
  state['gpu']=page.evaluate('''()=>{const gl=window.__walk.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}''')
  assert not errors,errors
  results.append({'case':case['label'],'lookups':lookups,'facilityRequests':facility_requests,'state':state,'errors':errors});print('ENTRY_AND_INTERIOR_PASS',case['label'],state['type'],flush=True)
  ctx.close()
 b.close()
(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
print('ENTRY_BROWSER_PASS',flush=True)
