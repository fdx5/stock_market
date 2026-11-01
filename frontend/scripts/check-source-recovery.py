"""Verify source retries stay within the same original unit and do not retain failures."""
import json,sys,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2];origin=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5407'
out=ROOT/'tmp/ho-won-floorplans-20261101/source-recovery';out.mkdir(exist_ok=True)
base=json.loads((ROOT/'tmp/floorplan-complex-20261101/samick-115-candidate.json').read_text(encoding='utf8'))
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio'])
 for case in ['same_unit_alternative','other_unit_blocked','both_fail','catalogue_retry','analysis_retry','manual_close_area']:
  ctx=b.new_context();page=ctx.new_page();requests=[];catalogues=[];errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  first={**base['drawing'],'key':'a'*24};second={**first,'key':'b'*24,'variant':'평면도 확장형'}
  if case=='other_unit_blocked':second={**second,'typeId':'different-type','typeName':'115B'}
  if case=='manual_close_area':second={**second,'typeId':'different-type','typeName':'115C','exclusiveArea':84.50}
  def api(route):
   u=urllib.parse.urlparse(route.request.url);q=urllib.parse.parse_qs(u.query)
   if not u.path.startswith('/api/'):return route.continue_()
   if u.path.endswith('/floor-plans'):
    catalogues.append(1)
    if case=='catalogue_retry' and len(catalogues)==1:return route.fulfill(json={'status':'unavailable','plans':[]})
    plans=[first] if case in ['catalogue_retry','analysis_retry'] else [first,second]
    return route.fulfill(json={'status':'available','name':'QA','plans':plans})
   if u.path.endswith('/floor-plan-analysis'):
    key=q['key'][0];requests.append(key)
    fail=case=='both_fail' or key==first['key'] and case not in ['catalogue_retry','manual_close_area'] and not(case=='analysis_retry' and len(requests)>1)
    return route.fulfill(json={'status':'needs_review','reason':'room_labels'} if fail else {**base,'drawing':first if key==first['key'] else second})
   return route.fulfill(status=503,json={})
  page.route('**/api/**',api);page.goto(origin+'/scripts/fixtures/source-recovery.html')
  if case=='other_unit_blocked':page.locator('.wk-chips button').first.click()
  if case=='manual_close_area':
   page.wait_for_function('JSON.parse(document.querySelector("#state").textContent).status==="ready"')
   page.locator('.wk-chips').first.get_by_role('button',name='115C',exact=False).click()
   page.wait_for_function('JSON.parse(document.querySelector("#state").textContent).typeId==="different-type"')
   page.wait_for_timeout(300)
   chosen=json.loads(page.locator('#state').inner_text());assert chosen['area']==84.50 and chosen['key']==second['key'],chosen
  if case=='catalogue_retry':
   page.wait_for_function('document.querySelector("#state").textContent.includes("unavailable")');page.get_by_role('button',name='재진입',exact=True).click()
  if case=='analysis_retry':
   page.wait_for_function('document.querySelector("#state").textContent.includes("needs_review")');page.get_by_role('button',name='재진입',exact=True).click()
  expected='needs_review' if case in ['other_unit_blocked','both_fail'] else 'ready'
  page.wait_for_function('(v)=>JSON.parse(document.querySelector("#state").textContent).status===v',arg=expected)
  page.wait_for_timeout(300)
  assert len(requests)==(1 if case in ['other_unit_blocked','catalogue_retry'] else 2),(case,requests)
  if case=='same_unit_alternative':assert json.loads(page.locator('#state').inner_text())['key']==second['key']
  assert not errors,errors
  results.append({'case':case,'analysisRequests':requests,'catalogueRequests':len(catalogues),'status':expected});print('SOURCE_RECOVERY_PASS',case,flush=True);ctx.close()
 b.close()
(out/'results.json').write_text(json.dumps(results,indent=2),encoding='utf8')
