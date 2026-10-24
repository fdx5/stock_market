"""Search, code application and keyboard flows with isolated synthetic API responses."""
import json
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:5184"
OUT = ROOT / "tmp/research-symbol-search-qa"
OUT.mkdir(parents=True, exist_ok=True)
fixture = {"__file__": str(Path(__file__).with_name("test-all-research-services.py"))}
exec(Path(__file__).with_name("test-all-research-services.py").read_text(encoding="utf-8").split("with sync_playwright() as pw:")[0], fixture)
stocks = [
    {"code":"005930","name":"삼성전자","market":"KOSPI","asset_type":"STOCK"},
    {"code":"000660","name":"SK하이닉스","market":"KOSPI","asset_type":"STOCK"},
    {"code":"247540","name":"에코프로비엠","market":"KOSDAQ","asset_type":"STOCK"},
    {"code":"AAPL","name":"애플 Apple","market":"US","asset_type":"STOCK"},
    {"code":"NOTIN100","name":"표본 밖 기업","market":"US","asset_type":"STOCK"},
    {"code":"069500","name":"KODEX 200","market":"KOSPI","asset_type":"ETF"},
    {"code":"102110","name":"TIGER 200","market":"KOSPI","asset_type":"ETF"},
    {"code":"VOO","name":"Vanguard S&P 500 ETF","market":"US","asset_type":"ETF"},
    {"code":"SPY","name":"SPDR S&P 500 ETF","market":"US","asset_type":"ETF"},
]

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True,args=["--mute-audio"])
    context = browser.new_context(viewport={"width":1440,"height":1000},reduced_motion="reduce")
    calls=[]; errors=[]; checks=[]
    def route(r):
        if not r.request.url.startswith(BASE): r.abort(); return
        url=urlsplit(r.request.url)
        if not url.path.startswith('/api/'): r.continue_(); return
        calls.append(r.request.url)
        if url.path=='/api/search':
            q=parse_qs(url.query).get('q',[''])[0]
            if q=='FAIL': r.fulfill(status=503,body='{}',content_type='application/json'); return
            items=[s for s in stocks if q.casefold() in (s['name']+' '+s['code']).casefold()]
            r.fulfill(body=json.dumps(items,ensure_ascii=False),content_type='application/json'); return
        r.fulfill(body=json.dumps(fixture['payload'](r.request.url),ensure_ascii=False),content_type='application/json')
    context.route('**/*',route)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    paths=['liquidity-quality','stock-context','earnings-gap','signal-crosscheck','news-evidence','theme-evidence','gap-context','fundamental-gap','decision-brief','currency-lens']
    for path in paths:
        page.goto(BASE+'/'+path)
        picker=page.locator('.rs-context [role=combobox]')
        picker.fill('Apple' if path=='currency-lens' else '삼성')
        expect(page.locator('[role=option]')).to_have_count(1)
        picker.press('ArrowDown');picker.press('Enter')
        expect(picker).to_have_value('AAPL' if path=='currency-lens' else '005930')
        params=parse_qs(urlsplit(page.url).query)
        assert params['code']==['AAPL' if path=='currency-lens' else '005930']
        expect(page.get_by_role('listbox')).to_have_count(0)
        checks.append('name search and keyboard selection '+path)
    page.goto(BASE+'/stock-context')
    picker=page.get_by_role('combobox',name='종목명 · 코드 검색',exact=True)
    picker.fill('에코프로');page.get_by_role('option',name='에코프로비엠',exact=False).click()
    assert parse_qs(urlsplit(page.url).query)['market']==['kosdaq']
    picker.fill('Apple');page.locator('[role=option]').click()
    assert parse_qs(urlsplit(page.url).query)['market']==['nasdaq']
    expect(page.locator('.rs-context select').first).to_have_value('nasdaq')
    checks.append('KOSDAQ and US market automatically follow selection')
    picker.fill('SK하이닉스');expect(page.locator('[role=option]')).to_have_count(1)
    picker.press('Escape');expect(page.get_by_role('listbox')).to_have_count(0);expect(picker).to_be_focused()
    checks.append('Escape closes results and keeps input focus')
    picker.fill('없음없음');expect(page.locator('.rs-symbol-status')).to_contain_text('일치하는 종목이 없습니다')
    picker.fill('FAIL');expect(page.locator('.rs-symbol-status')).to_contain_text('검색을 불러오지 못했습니다')
    picker.fill('000660');page.get_by_role('button',name='종목 적용',exact=True).click()
    assert parse_qs(urlsplit(page.url).query)['code']==['000660']
    checks.append('empty and failed search preserve manual code entry')
    for path in ['etf-overlap','etf-tradeoffs','dividend-reality']:
        page.goto(BASE+'/'+path)
        picker=page.get_by_role('combobox',name='ETF A 코드',exact=True)
        picker.fill('TIGER');expect(page.locator('[role=option]')).to_have_count(1);page.locator('[role=option]').click()
        assert parse_qs(urlsplit(page.url).query)['code']==['102110']
        if path!='dividend-reality':
            picker=page.get_by_role('combobox',name='ETF B 코드',exact=True)
            picker.fill('KODEX');page.locator('[role=option]').click()
            params=parse_qs(urlsplit(page.url).query);assert params['code']==['102110'] and params['peer']==['069500']
        checks.append('ETF name search and automatic A/B application '+path)
    page.goto(BASE+'/etf-overlap?region=US&code=VOO')
    picker=page.get_by_role('combobox',name='ETF A 코드',exact=True)
    picker.fill('S&P');expect(page.locator('[role=option]')).to_have_count(2)
    picker.press('ArrowDown');picker.press('Enter')
    assert any('include_etf=true' in call for call in calls if '/api/search?' in call)
    checks.append('US ETF-only results and correct search API option')
    for path in ['stock-tradeoffs','recovery-lab','stock-compare']:
        print('local search '+path,flush=True)
        page.goto(BASE+'/'+path)
        picker=page.locator('.rs-symbol-picker [role=combobox]')
        picker.fill('현대' if path=='stock-compare' else '삼성');expect(page.locator('[role=option]')).to_have_count(1);picker.press('Enter')
        expect(page.get_by_role('listbox')).to_have_count(0)
        if path=='stock-tradeoffs': assert 'base=' in page.url
        if path=='stock-compare': assert 'codes=' in page.url
        checks.append('local TOP100 name search '+path)
    page.goto(BASE+'/decision-brief?market=nasdaq&code=NOTIN100')
    expect(page.locator('.rs-stats strong').first).to_have_text('NOTIN100')
    expect(page.locator('.rs-stats strong').nth(1)).to_contain_text('—')
    checks.append('out-of-sample selection never shows another company facts')
    page.set_viewport_size({'width':390,'height':844})
    page.goto(BASE+'/stock-context');picker=page.locator('.rs-context [role=combobox]');picker.fill('삼성')
    expect(page.locator('[role=option]')).to_have_count(1)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    picker.scroll_into_view_if_needed();page.screenshot(path=str(OUT/'stock-search-mobile.png'),full_page=False)
    page.locator('[role=option]').click();expect(picker).to_have_value('005930')
    checks.append('mobile results fit viewport and select by touch')
    page.set_viewport_size({'width':1440,'height':1000});picker.fill('Apple');expect(page.locator('[role=option]')).to_have_count(1)
    page.screenshot(path=str(OUT/'stock-search-desktop.png'),full_page=False)
    assert not errors,errors
    (OUT/'result.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'data':'synthetic; no existing DB'},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(checks),'screenshots':str(OUT)}))
    browser.close()
