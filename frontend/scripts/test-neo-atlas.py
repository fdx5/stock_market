"""Atlas hierarchy and truthful sector summaries, using independent read-only fixtures."""
import json
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

base='http://127.0.0.1:5521'
items=[
    dict(code='AAA',name='Alpha',sector='Information Technology',marcap=60,close=100,change_pct=2),
    dict(code='BBB',name='Beta',sector='Information Technology',marcap=30,close=100,change_pct=-1),
    dict(code='CCC',name='Gamma',sector='Financials',marcap=10,close=100,change_pct=5),
    dict(code='AAA',name='Duplicate',sector='Information Technology',marcap=60,close=100,change_pct=2),
    dict(code='MISSING',name='Unquoted',sector='Financials',marcap=25,close=0,change_pct=15),
]
with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    c=b.new_context(viewport={'width':1440,'height':1000})
    c.add_init_script("localStorage.setItem('site_lang','en')")
    def fixtures(route):
        path=urlsplit(route.request.url).path
        if not path.startswith('/api/'):return route.continue_()
        if 'sp500-map' in path:return route.fulfill(json={'items':items,'session':'regular','generated_at':'2026-10-21T04:00:00Z'})
        if 'nasdaq100-map' in path:return route.fulfill(json={'items':[]})
        return route.fulfill(status=503,json={'detail':'Independent fixture: unavailable'})
    c.route('**/*',fixtures)
    page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/global');page.locator('.ng-sector-digest article').first.wait_for()
    page.wait_for_function("document.querySelectorAll('.ng-sector-digest article').length===2")
    sectors=page.locator('.ng-sector-digest article').all_text_contents()
    assert 'Information Technology+1.00%Supplied index weight 90.0%' in sectors,sectors
    assert 'Financials+5.00%Supplied index weight 10.0%' in sectors,sectors
    assert page.locator('.ng-content h1').count()==1
    items.clear()
    page.reload();page.locator('.ng-sector-digest').wait_for()
    assert 'Waiting for sector data' in page.locator('.ng-sector-digest').inner_text()
    assert '0.00%' not in page.locator('.ng-sector-digest').inner_text()
    page.goto(base+'/')
    page.locator('.ng-region-board').wait_for()
    assert page.locator('.ng-region').count()==2
    assert page.locator('.ed-market-overview').count()==0
    assert page.locator('.ng-region-title').evaluate_all("els=>els.map(e=>e.getAttribute('href'))")==['/desk','/global']
    assert page.locator('.ng-asset-belt article').count()==4
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print(json.dumps({'atlas_regions':2,'cross_assets':4,'duplicate_summary':False,'sector_weighting':'passed','missing_sector':'dash, no fabricated zero','single_heading':True,'errors':errors}))
    c.close();b.close()
