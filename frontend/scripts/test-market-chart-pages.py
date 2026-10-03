import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]/'tmp'
root.mkdir(exist_ok=True)
report=[]
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 context=browser.new_context()
 cache={}
 def route(r):
  u=urlparse(r.request.url)
  if not u.path.startswith('/api/'):return r.continue_()
  if r.request.method!='GET':return r.abort()
  key=u.path+('?' + u.query if u.query else '')
  if key in cache:return r.fulfill(status=cache[key][0],body=cache[key][1],content_type='application/json')
  try:
   result=r.fetch(url='https://kospimap.com'+key,timeout=45000)
   cache[key]=(result.status,result.body());r.fulfill(response=result)
  except:return r.abort()
 context.route('**/*',route)
 for width,paths in [(1440,['/desk','/global','/stocks?code=005930','/stock/005930','/stock/AAPL','/index/KOSPI','/kospi-100','/global-top100']),
                     (390,['/desk','/global','/stocks?code=005930','/stock/005930'])]:
  for path in paths:
   page=context.new_page(viewport=None) if False else context.new_page()
   page.set_viewport_size({'width':width,'height':950})
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto('http://localhost:5173'+path,wait_until='domcontentloaded')
   page.wait_for_timeout(4500)
   if path.startswith('/stocks') and width<600:
    page.locator('tr[data-code="005930"]').first.click()
    page.wait_for_timeout(1200)
   charts=page.locator('[data-chart-library="echarts"]')
   charts.first.wait_for(timeout=60000)
   count=charts.count()
   # Render representative sections without forcing every tiny offscreen chart.
   for index in sorted(set([0,min(2,count-1),min(5,count-1),count-1])):
    if not charts.nth(index).is_visible():continue
    charts.nth(index).scroll_into_view_if_needed()
    charts.nth(index).wait_for(state='visible')
    page.wait_for_function('(el)=>el.dataset.chartReady==="true"',arg=charts.nth(index).element_handle(),timeout=30000)
   assert not page.locator('[data-chart-error=true]').count()
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,path,'horizontal overflow')
   financial=page.locator('.market-financial')
   (financial.first if financial.count() else charts.first).scroll_into_view_if_needed()
   page.wait_for_timeout(800)
   page.screenshot(path=str(root/f'market-charts-{width}-{path.split("?")[0].replace("/","-")}.png'))
   assert not errors,(path,errors)
   report.append(dict(path=path,width=width,charts=count,errors=errors))
   print(report[-1],flush=True)
   page.close()
 browser.close()
root.joinpath('market-chart-pages-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
