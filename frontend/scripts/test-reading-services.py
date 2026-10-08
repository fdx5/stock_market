"""Browser QA with independent fixtures. No requests are sent to service databases."""
import json
import os
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = os.environ.get('READING_TEST_URL', 'http://127.0.0.1:4182')
OUT = Path(os.environ.get('READING_TEST_OUTPUT', str(Path(__file__).resolve().parents[2] / 'tmp/reading-services-qa')))
OUT.mkdir(parents=True, exist_ok=True)
names = {'005930': '삼성전자', '000660': 'SK하이닉스', '035420': 'NAVER', '105560': 'KB금융', '055550': '신한지주', '069500': 'KODEX 200', 'AAPL': 'Apple', 'MSFT': 'Microsoft', 'NVDA': 'NVIDIA', 'SPY': 'SPDR S&P 500 ETF'}
def item(code, index):
    return dict(code=code, name=names[code], close=78000 if code[0].isdigit() else 230, change=1000, change_pct=1.6-index, marcap=4e14/(index+1), market_cap=1e12/(index+1), sector='반도체/전자' if index < 3 else '금융', rank=index+1, volume=1000000, points=[10,12,11,14], session='regular')
kr = [item(c, i) for i, c in enumerate(['005930','000660','035420','105560','055550'])]
us = [item(c, i) for i, c in enumerate(['AAPL','MSFT','NVDA'])]
days = []
day = date(2025, 10, 1)
while len(days) < 265:
    if day.weekday() < 5: days.append(day.isoformat())
    day += timedelta(days=1)
def points(code):
    base, step = (65000, 50) if code[0].isdigit() else (100, .5)
    return [dict(date=d, open=base+i*step, high=base+i*step+step, low=base+i*step-step, close=base+i*step, volume=2000000, volume_ma20=1000000, sma5=base+(i-2)*step, sma20=base+(i-10)*step, sma60=None, sma120=None, ema12=None, ema26=None, macd=None, macd_signal=None, macd_hist=None, rsi14=61, bb_upper=None, bb_mid=None, bb_lower=None, obv=None, atr14=None, volatility20=.02) for i, d in enumerate(days)]
state = {'quote_fail': False, 'sparse': False, 'hang_history': False}
counts = Counter()
pending_routes = []
def serve(r):
    u = urlparse(r.request.url)
    if not u.path.startswith('/api/'):
        if u.netloc != urlparse(BASE).netloc: return r.abort()
        return r.continue_()
    counts[u.path] += 1
    if u.path == '/api/visitors/count': return r.fulfill(json={'count':1,'total':1,'today':1})
    if r.request.method != 'GET': return r.fulfill(json={'ok': True})
    q = parse_qs(u.query)
    parts = u.path.strip('/').split('/')
    data = None
    if len(parts) == 4 and parts[1] in ['stock','us-stock']:
        code, feed = parts[2:]
        if code not in names: return r.fulfill(status=404, json={'detail': 'fixture unknown stock'})
        if feed == 'quote':
            if state['quote_fail']: return r.fulfill(status=503, json={'detail': 'fixture quote unavailable'})
            data = dict(code=code, name=names[code], close=78000 if code[0].isdigit() else 232, change=1000 if code[0].isdigit() else 2, change_pct=1.6, marcap=4e14, session='regular')
        elif feed == 'summary': data = dict(code=code, name=names[code], date=days[-1], close=points(code)[-1]['close'], change=500, change_pct=.6, volume=2000000)
        elif feed == 'indicators':
            if state['hang_history']:
                pending_routes.append(r)
                return
            data = {'points': points(code)[:3] if state['sparse'] else points(code)}
        elif feed == 'overview': data = dict(code=code, name=names[code], overview=['반도체와 전자제품을 만드는 기업입니다.'], per_estimate='18.0', shares_outstanding=5000000000)
    elif u.path in ['/api/market/map','/api/market/kosdaq-map','/api/market/sp500-map','/api/market/nasdaq100-map']:
        data = dict(generated_at='2026-10-07T15:30:00+09:00', count=len(kr), items=us if 'sp500' in u.path or 'nasdaq' in u.path else kr, session='regular')
    elif u.path == '/api/market/returns': data = {'items': {c: dict(w1=2,d20=8,d60=10,d120=15,d240=30) for c in q.get('codes',[''])[0].split(',')}}
    elif u.path in ['/api/market/sector-map','/api/market/us-sector-map']:
        data = dict(generated_at='2026-10-07T15:30:00+09:00', code=q.get('code',['005930'])[0], market='KOSPI', sector='반도체/전자', avg_change_pct=.6, count=3, items=us if 'us-sector' in u.path else kr[:3])
    elif u.path == '/api/market/sector': data = dict(market='KOSPI', sector='반도체/전자')
    elif u.path.startswith('/api/global/') and u.path.endswith('/enrichment'): data = dict(logo_url='',marcap_usd=1e12,marcap_krw=1e15,description='A technology company.')
    elif 'index' in u.path and 'history' in u.path: data = {'points': points('005930')}
    if data is None: return r.fulfill(status=503, json={'detail': 'fixture feed unavailable'})
    return r.fulfill(json=data)

report = {'base': BASE, 'checks': [], 'responsive': [], 'errors': []}
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width':1440,'height':950}, reduced_motion='reduce')
    context.route('**/*', serve)
    page = context.new_page()
    page.on('pageerror', lambda e: (report['errors'].append(str(e)), print(str(e),flush=True)))
    page.goto(BASE+'/map', wait_until='domcontentloaded')
    page.locator('.kospi-map-tile').first.wait_for()
    page.locator('.reading-recents').click()
    page.locator('.recent-sheet-empty').wait_for()
    page.get_by_role('button',name='닫기',exact=True).click()
    report['checks'].append('first visit has an accessible empty recent-stock state')
    page.get_by_role('radio', name='1개월').check()
    page.get_by_label('업종', exact=True).select_option('반도체/전자')
    page.locator('.kospi-map-tile').first.scroll_into_view_if_needed()
    y = page.evaluate('scrollY')
    page.locator('.kospi-map-tile').filter(has_text='삼성전자').first.click()
    page.wait_for_url(BASE+'/stock/005930')
    page.locator('.stock-insights').wait_for()
    page.wait_for_function("document.querySelector('[data-brief-metric=month]').textContent !== '—'")
    metrics = page.locator('[data-brief-metric]').all_text_contents()
    page.locator('.brief-report-link').click()
    page.wait_for_url(BASE+'/stock/005930/report')
    page.locator('.brief-metrics').wait_for()
    page.wait_for_function("document.querySelector('[data-brief-metric=month]').textContent !== '—'")
    assert page.locator('[data-brief-metric]').all_text_contents() == metrics
    page.locator('.reading-resume').click()
    page.wait_for_url(BASE+'/map')
    page.locator('.kospi-map-tile').first.wait_for()
    assert page.get_by_role('radio', name='1개월').is_checked()
    assert page.get_by_label('업종', exact=True).input_value() == '반도체/전자'
    assert page.locator('.is-last-selected').count() == 1
    page.wait_for_timeout(500)
    assert abs(page.evaluate('scrollY')-y) < 12, (y,page.evaluate('scrollY'))
    report['checks'].append('map→stock→report→map: period, sector, selection, scroll restored; shared metrics match')
    # Native back also restores the report entry and the stock's reading position.
    page.go_back(wait_until='domcontentloaded')
    page.locator('.report-page').wait_for()
    page.go_back(wait_until='domcontentloaded')
    page.locator('.stock-insights').wait_for()
    report['checks'].append('native back works across report and stock routes')
    # Same pathname, different query must remount the desk's stock context.
    page.goto(BASE+'/desk?code=000660', wait_until='domcontentloaded')
    page.locator('#d2-front').wait_for()
    page.locator('.d2-mast-nav a[href="/map"]').click()
    page.locator('.kospi-map-tile').first.wait_for()
    page.locator('.d2-mast-nav a[href="/desk"]').click()
    page.wait_for_url(BASE+'/desk?code=000660')
    assert not page.locator('.d2-world').count()
    report['checks'].append('front page retains its code context and stays /desk after a map visit')
    # Mobile recent history uses local data only, with a native modal focus trap.
    page.set_viewport_size({'width':390,'height':844})
    page.goto(BASE+'/stock/SPY/report?asset=ETF', wait_until='domcontentloaded')
    page.locator('.brief-metrics').wait_for()
    page.wait_for_function("JSON.parse(localStorage.getItem('kstock_recents')).some(x=>x.code==='SPY'&&x.asset_type==='ETF')")
    before = {k:v for k,v in counts.items() if k.endswith('/quote')}
    page.locator('.reading-recents').click()
    page.locator('dialog[open]').wait_for()
    assert page.locator('.recent-sheet-report').first.get_attribute('href') == '/stock/SPY/report?asset=ETF'
    for _ in range(15): page.keyboard.press('Tab')
    assert page.evaluate("document.querySelector('dialog').contains(document.activeElement)")
    page.keyboard.press('Escape')
    assert page.locator('dialog[open]').count() == 0
    assert page.locator('.reading-recents').evaluate('el=>el===document.activeElement')
    assert {k:v for k,v in counts.items() if k.endswith('/quote')} == before, 'recent menu must not start quote requests'
    page.locator('.reading-recents').click()
    page.locator('.recent-sheet-stock').first.click()
    page.wait_for_url(BASE+'/stock/SPY?asset=ETF')
    page.locator('.stock-insights').wait_for()
    assert page.locator('dialog[open]').count() == 0
    assert not page.locator('#sk-peers').count()
    report['checks'].append('mobile recents: keyboard focus, Escape, no polling, ETF type preserved, selection closes modal')
    page.set_viewport_size({'width':1440,'height':950})
    for map_path in ['/map','/kosdaq-map','/sp500-map','/nasdaq100-map']:
        colors = []
        for mode in ['light','dark']:
            page.evaluate('(mode)=>localStorage.setItem("site_theme",mode)',mode)
            page.goto(BASE+map_path,wait_until='domcontentloaded')
            page.locator('.kospi-map-tile').first.wait_for()
            page.wait_for_timeout(150)
            assert page.locator('.map-canvas-night').evaluate('el=>getComputedStyle(el).colorScheme') == 'dark'
            colors.append(page.locator('.kospi-map-tile').first.evaluate('el=>getComputedStyle(el).backgroundColor'))
        assert colors[0] == colors[1], (map_path, colors)
    report['checks'].append('all four stock heatmaps retain the same night palette in both editions')
    for width in [1440,1024,768,390,360]:
        page.set_viewport_size({'width':width,'height':950})
        for mode in ['light','dark']:
            for code in ['005930','AAPL','SPY']:
                page.evaluate('(mode)=>localStorage.setItem("site_theme",mode)', mode)
                path=f'/stock/{code}/report'+('?asset=ETF' if code=='SPY' else '')
                page.goto(BASE+path, wait_until='domcontentloaded')
                page.locator('.brief-metrics').wait_for()
                page.wait_for_function("document.querySelector('[data-brief-metric=month]').textContent !== '—'")
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), (width,mode,code,'overflow')
                assert page.evaluate('document.documentElement.dataset.theme') == mode
                report['responsive'].append({'width':width,'mode':mode,'code':code})
                if width in [1440,390] and mode=='light' and code=='005930':
                    page.screenshot(path=str(OUT/f'report-{width}.png'),full_page=True)
        print(json.dumps({'width':width,'responsive':'passed'}),flush=True)
    page.set_viewport_size({'width':1440,'height':950})
    page.goto(BASE+'/stock/005930/report', wait_until='domcontentloaded')
    page.locator('.brief-metrics').wait_for()
    page.wait_for_function("document.querySelector('[data-brief-metric=month]').textContent !== '—'")
    page.pdf(path=str(OUT/'report-print.pdf'),format='A4',print_background=True,margin={'top':'12mm','bottom':'12mm','left':'12mm','right':'12mm'})
    state['quote_fail'] = True
    page.get_by_role('button',name='자료 새로고침',exact=True).click()
    page.locator('.brief-pending').wait_for()
    assert '78,000' in page.locator('.report-price').inner_text()
    report['checks'].append('failed refresh keeps last quote with an explicit pending status')
    state['sparse'] = True
    page.goto(BASE+'/stock/AAPL/report', wait_until='domcontentloaded')
    page.locator('.brief-pending').wait_for()
    assert page.locator('[data-brief-metric=day]').inner_text() == '—'
    assert page.locator('[data-brief-metric=month]').inner_text() == '—'
    assert 'NaN' not in page.locator('.report-main').inner_text()
    report['checks'].append('quote failure and short history show unavailable values without fake zeroes')
    page.goto(BASE+'/stock/UNKNOWN/report', wait_until='domcontentloaded')
    page.locator('.report-status').wait_for()
    assert 'UNKNOWN' in page.locator('.report-cover h1').inner_text()
    assert page.locator('[data-brief-metric=day]').inner_text() == '—'
    report['checks'].append('unknown ticker remains a usable report with missing-data states')
    state.update(quote_fail=False,sparse=False,hang_history=True)
    hanging = context.new_page()
    hanging.on('pageerror', lambda e: report['errors'].append(str(e)))
    hanging.clock.install()
    hanging.goto(BASE+'/stock/005930/report',wait_until='domcontentloaded')
    hanging.wait_for_function("document.querySelector('[data-brief-metric=day]')?.textContent === '+1.60%'")
    assert '78,000' in hanging.locator('.report-price').inner_text()
    hanging.clock.fast_forward(26000)
    hanging.get_by_role('button',name='자료 새로고침',exact=True).wait_for()
    assert hanging.get_by_role('button',name='자료 새로고침',exact=True).is_enabled()
    assert '일별 지표' in hanging.locator('.report-status').inner_text()
    report['checks'].append('a hung history request times out; the quote stays readable and refresh becomes available')
    for pending in pending_routes:
        try: pending.abort()
        except Exception: pass  # The browser may already have cancelled the route.
    hanging.close()
    assert not report['errors'], report['errors']
    browser.close()
OUT.joinpath('report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'result':'passed','checks':len(report['checks']),'responsive':len(report['responsive'])}),flush=True)
