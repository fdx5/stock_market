"""Cold/warm actual room-tour traffic. No DB tools, no API response substitutions."""
import json,re,sys,time,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
origin=next((x for x in sys.argv[1:] if x.startswith('http')),'https://kospimap.com');label=sys.argv[sys.argv.index('--label')+1] if '--label' in sys.argv else 'before'
out=Path('tmp/source-lookup-20261101');out.mkdir(exist_ok=True)
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio','--ignore-gpu-blocklist'])
 ctx=b.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1);page=ctx.new_page();cdp=ctx.new_cdp_session(page);cdp.send('Network.enable');requests={};transfers=[];errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 def response(e):requests[e['requestId']]=e['response']
 def finished(e):
  r=requests.pop(e['requestId'],None)
  if r:transfers.append({'url':r['url'],'status':r['status'],'bytes':e['encodedDataLength'],'diskCache':r.get('fromDiskCache',False)})
 cdp.on('Network.responseReceived',response);cdp.on('Network.loadingFinished',finished)
 for stage in ['cold','warm']:
  transfers.clear();errors.clear();started=time.perf_counter()
  page.goto(origin+'/walk?'+urllib.parse.urlencode({'tour':'1','id':'11680:수서동:708:삼익','area':'84.48','hour':'14','debug':'1'}),wait_until='domcontentloaded')
  page.locator('.wk-choose').wait_for(timeout=60000);page.locator('.wk-original-plan .wk-chips').first.get_by_role('button',name=re.compile('^115')).click(timeout=60000)
  page.wait_for_function('()=>document.querySelector(".wk-go")&&!document.querySelector(".wk-go").disabled',timeout=90000);page.locator('.wk-go').click()
  page.wait_for_function('()=>window.__walk?.interior?.perf.loadMs>0&&!document.querySelector(".wk-loading")',timeout=90000)
  perf=page.evaluate('''async()=>{const i=window.__walk.interior;i.perf.intervals=[];await new Promise(r=>setTimeout(r,5000));return i.stats();}''')
  assert not errors,errors
  totals={}
  for r in transfers:
   host=urllib.parse.urlparse(r['url']).netloc;totals[host]=totals.get(host,0)+r['bytes']
  results.append({'stage':stage,'seconds':time.perf_counter()-started,'bytesByHost':totals,'requests':list(transfers),'perf':perf,'errors':list(errors)});print(label,stage,totals,flush=True)
  page.screenshot(path=str(out/(label+'-'+stage+'.png')))
  page.goto('about:blank')
 b.close()
(out/('transfer-'+label+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
