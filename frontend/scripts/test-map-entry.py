"""Verify the actual App/map routes with synthetic public map responses."""
import json
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5193'
results = []

def mock(route):
    path = urlparse(route.request.url).path
    if not path.startswith('/api/'):
        return route.continue_()
    if path in ['/api/market/map', '/api/market/kosdaq-map', '/api/market/sp500-map', '/api/market/nasdaq100-map']:
        items = [{'code': str(i+1).zfill(6), 'name': f'Fixture {i}', 'sector': 'Test sector', 'marcap': 100000000-i*10000, 'market_cap':100000000, 'close':1000, 'change':10, 'change_pct':1} for i in range(20)]
        return route.fulfill(json={'generated_at':'2026-10-23T10:00:00', 'count':len(items), 'items':items})
    if path == '/api/geo/country':
        return route.fulfill(json={'country':'KR'})
    if path == '/api/realestate/regions':
        return route.fulfill(json={'source':'Fixture', 'sido':[{'code':'11','name':'Seoul','sgg':[{'code':'11680','name':'Gangnam','dongs':['Test']}]}]})
    if path == '/api/realestate/explore':
        item = {'id':'fixture','name':'Fixture apartment','brand':None,'sgg':'Gangnam','sgg_code':'11680','dong':'Test','group':'Test','price':100000,'area':84,'pyeong':25,'deal_date':'2026-10-20','floor':10,'built':2020,'base_price':99000,'base_date':'2026-07-20','change_pct':1,'trades':5,'trades_all':5,'history':[],'high_1y':None,'low_1y':None,'trades_1y':5,'types':[]}
        return route.fulfill(json={'generated_at':'2026-10-23','level':'dong','period':'3m','top_n':100,'group_floor':None,'latest_deal_date':'2026-10-20','window_start':'2026-07-23','status':{'configured':True,'coverage':1,'collecting':False,'error':None,'calls_today':0},'count':1,'items':[item]})
    return route.fulfill(status=503, json={'detail':'Synthetic test: backend disabled'})

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width in (1280, 390):
        for path in ('/map', '/kosdaq-map', '/sp500-map', '/nasdaq100-map', '/realestate-map'):
            context = browser.new_context(viewport={'width':width, 'height':800}, reduced_motion='reduce')
            context.route('**/api/**', mock)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(base+path, wait_until='domcontentloaded')
            page.wait_for_selector('[data-scroll-start="map"][data-scroll-ready="true"]')
            page.wait_for_timeout(900)
            geometry = page.evaluate('''() => {
              const map = document.querySelector('[data-scroll-start="map"]');
              let bottom = 0;
              for (const bar of document.querySelectorAll('.ng-header,.ng-top-rail,.app-header,.desk-command,[data-d2-sticky],.re-map-crumbs')) {
                const s=getComputedStyle(bar), r=bar.getBoundingClientRect();
                if (['sticky','fixed'].includes(s.position) && r.height && Number.isFinite(parseFloat(s.top))) bottom=Math.max(bottom,parseFloat(s.top)+r.height);
              }
              return {top:map.getBoundingClientRect().top, expected:bottom+12, y:scrollY};
            }''')
            assert abs(geometry['top']-geometry['expected']) < 3, (width,path,geometry,errors)
            assert not errors, errors
            results.append({'width':width,'path':path,**geometry})
            print('PASS',width,path,geometry,flush=True)
            context.close()
    browser.close()
print(json.dumps(results,indent=2))
