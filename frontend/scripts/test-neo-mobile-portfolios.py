"""Public-feed portrait regressions: every investor card remains in its grid."""
import datetime as dt,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
base=os.getenv('NEO_TEST_URL','http://127.0.0.1:5521')
out=Path(__file__).resolve().parents[2]/'qa'/('portfolio-mobile-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S'));out.mkdir()
report=[]
with sync_playwright() as p:
  for engine in ('chrome','webkit'):
    b=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']) if engine=='chrome' else p.webkit.launch(headless=True)
    c=b.new_context(viewport={'width':390,'height':1000})
    c.add_init_script("localStorage.setItem('site_lang','ko')")
    c.route('**/api/**',lambda r:r.continue_() if r.request.method=='GET' and not any(x in r.request.url for x in ('/activity','/tracking','/visitors/')) else r.fulfill(json={}))
    page=c.new_page()
    for path in ('/desk','/global','/investors'):
      page.goto(base+path);page.locator('.ed-investor-card').first.wait_for(timeout=30000)
      for width in (360,390,430):
        page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(500)
        cards=page.locator('.ed-investor-card').evaluate_all('es=>es.map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,client:e.clientWidth,scroll:e.scrollWidth}))')
        assert len(cards)>=6,(path,len(cards))
        assert all(card['width']>110 and 150<card['height']<600 and card['left']>=0 and card['right']<=width+1 and card['scroll']<=card['client']+1 for card in cards),(engine,path,width,cards)
        grid=page.locator('.ed-investor-grid').first
        assert grid.evaluate('e=>getComputedStyle(e).gridAutoFlow')=='row'
        assert grid.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        grid.scroll_into_view_if_needed();page.screenshot(path=str(out/f'{engine}-{width}-{path[1:]}.png'))
        report.append({'engine':engine,'path':path,'width':width,'cards':len(cards),'contained':True})
    c.close();b.close()
(out/'result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'cases':len(report),'passed':True,'output':str(out)}))
