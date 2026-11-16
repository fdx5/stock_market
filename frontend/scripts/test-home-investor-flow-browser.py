"""Home integration checks using in-memory API responses; no backend or DB."""
import json
import os
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL = os.environ.get("HOME_FLOW_URL", "http://127.0.0.1:5187")
OUTPUT = Path(__file__).resolve().parents[2] / "tmp" / "home-flow-review"
OUTPUT.mkdir(parents=True, exist_ok=True)
calls = 0

def fixture(route):
    global calls
    url = urlparse(route.request.url)
    if url.netloc != urlparse(URL).netloc:
        route.abort()
        return
    if not url.path.startswith('/api/'):
        route.continue_()
        return
    now = datetime.now(timezone.utc)
    data = {'items': [], 'points': [], 'count': 0, 'total': 0, 'snapshot': 'test'}
    if url.path == '/api/investor/indices':
        calls += 1
        day = now.astimezone(timezone(timedelta(hours=9))).strftime('%Y%m%d')
        data = {}
        for market, amounts in [('kospi', [6256,-9116,1235]), ('kosdaq',[2459,-1617,-645])]:
            data[market] = {'symbol':market.upper(),'name':market,'close':5000,'change':-24,'change_pct':-2.5,'market_status':'OPEN','updated_at':now.isoformat()}
            data[market+'_investor'] = dict(zip(['individual_amount','foreign_amount','institution_amount'],amounts),business_date=day,fetched_at=time.time())
    elif url.path in ('/api/market/map','/api/market/kosdaq-map','/api/market/nasdaq100-map'):
        data = {'items':[{'code':'005930','name':'삼성전자','sector':'반도체','close':72000,'change_pct':-1.2,'marcap':4e14,'volume':1000000},
                         {'code':'000660','name':'SK하이닉스','sector':'반도체','close':180000,'change_pct':1.8,'marcap':2e14,'volume':500000}], 'generated_at':now.isoformat()}
    elif url.path == '/api/geo/country':
        data = {'country':'KR'}
    route.fulfill(content_type='application/json',body=json.dumps(data,ensure_ascii=False))

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    page = browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
    page.route('**/*',fixture)
    page.add_init_script("localStorage.setItem('site_lang','ko');localStorage.setItem('kospimap_home_market','kospi');")
    errors = []
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(URL+'/')
    panel = page.locator('.sc-scanner > .pif-panel--inline')
    panel.locator('.pif-amount').first.wait_for(timeout=60000)
    page.wait_for_selector('.pif-panel--inline[data-mode=flowing]')
    assert calls == 1, 'Home and flow must share the existing index request'
    assert panel.get_attribute('data-market') == 'kospi'
    assert panel.bounding_box()['y']+panel.bounding_box()['height'] <= page.locator('.sc-controls').bounding_box()['y']+1
    samples = []
    for _ in range(8):
        samples.append(panel.locator('.pif-amount').evaluate_all("els=>els.map(el=>el.getAttribute('aria-label'))"))
        page.wait_for_timeout(140)
    assert len({tuple(row) for row in samples}) >= 7
    page.screenshot(path=str(OUTPUT/'desktop.png'))
    for width in [1600,1280,768,390,320]:
        page.set_viewport_size({'width':width,'height':900})
        # Existing scanner cells animate their layout after a resize.
        page.wait_for_timeout(800)
        assert panel.bounding_box()['height'] < (100 if width <= 520 else 65), width
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), (width, page.evaluate("['.ng-content','.ng-atlas','.sc-scanner','.pif-panel','.pif-content','.pif-rows','.sc-controls'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return [s,r.width,r.x,e.scrollWidth]})"))
        if width > 520:
            assert panel.locator('.pif-row').evaluate_all('els=>Math.max(...els.map(el=>el.getBoundingClientRect().top))-Math.min(...els.map(el=>el.getBoundingClientRect().top))<1'), width
        assert panel.locator('.pif-row').evaluate_all('els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)'), width
        assert panel.locator('.pif-rows').evaluate('el=>el.scrollWidth<=el.clientWidth+1'), width
        page.screenshot(path=str(OUTPUT/f'width-{width}.png'))
    print('PASS immediate rolling, shared poll, placement and no horizontal scrolling at 1600/1280/768/390/320px',flush=True)
    markets = page.get_by_role('group',name='시장 선택',exact=True)
    markets.get_by_role('button',name=re.compile('^KOSDAQ')).click()
    assert panel.get_attribute('data-market') == 'kosdaq'
    assert panel.locator('.pif-row[data-tone=sell]').count() == 2
    page.wait_for_selector('.pif-panel--inline[data-mode=flowing]')
    panel.get_by_role('button',name='숫자 흐름 멈추기',exact=True).click()
    page.wait_for_selector('.pif-panel--inline[data-mode=paused]')
    paused = panel.locator('.pif-amount').first.get_attribute('aria-label')
    page.wait_for_timeout(300)
    assert panel.locator('.pif-amount').first.get_attribute('aria-label') == paused
    panel.get_by_role('button',name='숫자 흐름 켜기',exact=True).click()
    markets.get_by_role('button',name=re.compile('^NASDAQ 100')).click()
    assert panel.count() == 0
    markets.get_by_role('button',name=re.compile('^KOSPI')).click()
    page.wait_for_selector('.pif-panel--inline[data-mode=flowing]')
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_selector('.pif-panel--inline[data-still=true]')
    assert panel.locator('.pif-controls button').is_disabled()
    assert not errors, errors
    browser.close()
    print('PASS KOSDAQ/KOSPI switch, NASDAQ exclusion, pause and reduced motion',flush=True)
