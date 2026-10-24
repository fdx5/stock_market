"""36 routes + navigation and private calculators; every API call is in-memory mocked."""
import datetime as dt
import json
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:5184"
OUT = ROOT / "tmp" / "all-research-services-qa"
OUT.mkdir(parents=True, exist_ok=True)
SERVICES = json.loads((ROOT / "frontend/src/markets/serviceCatalog.json").read_text(encoding="utf-8"))
# Reuse the original independent fixture function, without executing its browser run.
fixture = {"__file__": str(Path(__file__).with_name("test-market-discovery.py"))}
exec(Path(__file__).with_name("test-market-discovery.py").read_text(encoding="utf-8").split("with sync_playwright() as p:")[0], fixture)
board = fixture["board"]
dates = [(dt.date(2026, 1, 1) + dt.timedelta(days=i)).isoformat() for i in range(120)]
hist = [{"date": date, "open": 100+i, "high": 103+i, "low": 98+i, "close": 101+i, "volume": 10000+i*10, "complete": True} for i, date in enumerate(dates)]
snapshot_rows = [{"id": "first", "market": "kospi", "recorded_at": "2026-10-24T10:00:00+09:00", "items": board("kospi")["items"]}, {"id": "second", "market": "kospi", "recorded_at": "2026-10-25T10:00:00+09:00", "items": [dict(row, close=row["close"]*1.02) for row in board("kospi")["items"]]}]
CURVE = [{"date": dates[i], "values": {"1MONTH":4.2,"3MONTH":4.1,"6MONTH":4,"1YEAR":3.8,"2YEAR":3.5+i*.001,"3YEAR":3.6,"5YEAR":3.8,"7YEAR":4,"10YEAR":4.1+i*.002,"20YEAR":4.4,"30YEAR":4.5}} for i in range(30)]


def payload(url):
    u = urlsplit(url); query = parse_qs(u.query); path = u.path
    pack = lambda items, **kw: {"source": "SYNTHETIC QA ONLY", "received_at": "2026-10-25T12:00:00+09:00", "items": items, "coverage": "test fixture", **kw}
    if path == "/api/market/board": return board(query.get("market", ["kospi"])[0])
    if "/discovery/asset/" in path:
        code = path.split("/")[-1]
        return pack(hist if code != "USDKRW" else [dict(r, close=1300+i) for i,r in enumerate(hist)], currency="USD" if code in ["AAPL","VOO","MSFT"] else "KRW", price=220, dividends=[{"ex_date":"2026-09-01","amount":1.2,"payment_date":None,"kind":"과거 배당락"}])
    if "/discovery/finance/" in path: return pack([{"date":"202312","period":"2023.12","estimated":False,"values":{"매출액":100,"영업이익":20,"PER":10}},{"date":"202412","period":"2024.12","estimated":False,"values":{"매출액":120,"영업이익":23,"PER":11}},{"date":"202512","period":"2025.12","estimated":True,"values":{"매출액":130,"영업이익":25,"PER":12}}], unit="금액: 억원")
    if "/discovery/profile/" in path: return pack([{"text":"메모리 반도체와 전자제품을 생산합니다. 이 문장은 테스트 데이터입니다."}])
    if "/discovery/fund/" in path: return pack([{"code":"005930","name":"삼성전자","weight":35},{"code":"000660","name":"SK하이닉스","weight":25}], expense_pct=.15, nav=100, yield_pct=2, name=path.split("/")[-1], currency="KRW")
    if path.endswith("/curve"): return pack(CURVE)
    if path.endswith("/macro"): return pack([{"country":name,"code":code,"year":year,"value":value} for name,code,value in [("Korea","KOR",2.2),("USA","USA",2.5),("Japan","JPN",1.1),("China","CHN",4.5),("Germany","DEU",.8),("India","IND",6.5)] for year in [2023,2024]], label="실질 GDP 성장률",unit="%")
    if path.endswith("/calendar"): return pack([{"date":"2026-10-29","at":"2026-10-29T12:30:00Z","title":"GDP advance","source":"BEA","source_url":"https://www.bea.gov/news/schedule"},{"date":"2026-10-29","at":"2026-10-29T12:30:00Z","title":"Personal Income and Outlays","source":"BEA","source_url":"https://www.bea.gov/news/schedule"}])
    if path.endswith("/sessions"): return pack([{"date":"2026-10-26","region":"KR","open":True,"calendar_valid":True,"start":"2026-10-26T00:00:00Z","end":"2026-10-26T06:30:00Z","half_day":False}])
    if path.endswith("/snapshots"): return pack(snapshot_rows)
    if path.endswith("/crypto"): return pack([{"code":c,"name":name,"price":100000,"change":change,"turnover":10000000} for c,name,change in [("KRW-BTC","비트코인",2),("KRW-ETH","이더리움",1),("KRW-SOL","솔라나",-3)]])
    if path.endswith("/orderbook"): return pack([{"ask_price":100+i,"ask_size":100,"bid_price":99-i,"bid_size":100} for i in range(10)])
    if path.endswith("/derivatives"): return pack([{"time":1792800000000+i*3600000,"value":10000+i*20} for i in range(12)],price=100,index_price=99,funding_rate=.0001,open_interest_usd=1000000,funding_interval_hours=8)
    if path.endswith("/news"): return pack([{"date":"2026.10.25 10:00","title":"실적 발표 테스트 기사","press":"테스트","link":"https://example.com/news"}])
    if path == "/api/global-top100": return pack([{"symbol":"AAPL","name":"Apple","country":"US","sector":"Technology","market_cap_usd":1000000000000,"change_pct":2,"trailing_pe":25}])
    return {"enabled":False,"items":[],"count":0,"total":0}


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True,args=["--mute-audio"])
    context = browser.new_context(viewport={"width":1440,"height":1000}, reduced_motion="reduce")
    requests=[]
    def route(r):
        if not r.request.url.startswith(BASE): r.abort(); return
        if not r.request.url.startswith(BASE+"/api/"): r.continue_(); return
        requests.append({"url":r.request.url,"body":r.request.post_data or ""})
        r.fulfill(content_type="application/json",body=json.dumps(payload(r.request.url),ensure_ascii=False))
    context.route("**/*",route)
    page=context.new_page(); errors=[]; page.on("pageerror",lambda error:errors.append(str(error)))
    checks=[]
    capture={"/markets","/stock-context","/etf-overlap","/yield-curve-lab","/event-collision","/crypto-liquidity","/fundamental-gap","/bond-tradeoffs"}
    for service in SERVICES:
        page.goto(BASE+service["path"])
        expect(page.locator("h1")).to_contain_text(service["name"],timeout=20000)
        page.wait_for_timeout(180)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"),service["path"]
        assert not page.locator("[data-chart-error='true']").count(),service["path"]
        expect(page.locator(".ng-sidebar .ng-research-new")).to_have_count(36)
        if service["path"] in capture:page.screenshot(path=str(OUT/(service["path"].strip("/")+"-desktop.png")),full_page=True)
        checks.append("desktop "+service["path"])
    page.goto(BASE+"/stock-context?code=005930&market=kospi")
    page.locator(".rs-context input").fill("000660")
    page.get_by_role("button",name="종목 적용",exact=True).click()
    link=page.locator('.ng-sidebar a[href^="/signal-crosscheck"]')
    expect(link).to_have_attribute("href",__import__('re').compile("code=000660"))
    link.evaluate("el => { const group = el.closest('details'); if (group) group.open = true; }")
    link.click()
    expect(page.locator("h1")).to_contain_text("신호 교차 검증")
    expect(page.locator(".rs-context input")).to_have_value("000660")
    page.go_back()
    expect(page.locator(".rs-context input")).to_have_value("000660")
    checks.append("stock context and browser back preserved")
    page.goto(BASE+"/etf-overlap")
    expect(page.locator(".rs-stats strong").first).to_contain_text("60")
    expect(page.locator(".rs-table tbody tr")).to_have_count(2)
    checks.append("ETF overlap calculation")
    page.get_by_label("ETF A 코드",exact=True).fill("102110")
    page.get_by_role("button",name="ETF 자료 확인",exact=True).click()
    expect(page.locator('.service-connections a[href^="/etf-tradeoffs"]')).to_have_attribute("href",__import__('re').compile("code=102110"))
    checks.append("ETF selection carried into related services")
    page.locator("label.rs-field").filter(has_text="ETF 시장").locator("select").select_option("US")
    expect(page.get_by_label("ETF A 코드",exact=True)).to_have_value("VOO")
    expect(page.get_by_label("ETF B 코드",exact=True)).to_have_value("SPY")
    expect(page.locator('.service-connections a[href^="/etf-tradeoffs"]')).to_have_attribute("href",__import__('re').compile("code=VOO"))
    checks.append("ETF market switch resets compatible public codes")
    page.goto(BASE+"/event-collision")
    expect(page.locator(".rs-stats strong").last).to_have_text("1")
    checks.append("same-time event collision")
    page.goto(BASE+"/bond-tradeoffs")
    private_input="9876543.21"
    page.get_by_label("A 가격",exact=True).fill(private_input)
    assert private_input not in page.url
    assert not any(private_input in r['url'] or private_input in r['body'] for r in requests)
    assert private_input not in page.evaluate("JSON.stringify({...localStorage,...sessionStorage})")
    checks.append("calculator input stays private")
    page.goto(BASE+"/stock-context")
    page.locator('input[type="file"]').set_input_files({"name":"history.csv","mimeType":"text/csv","buffer":b'date,open,high,low,close,volume\n2026-01-01,1,2,1,2,100\n2026-01-02,2,3,2,3,110\n'})
    expect(page.locator(".rs-local [role=status]")).to_contain_text("2개 행")
    checks.append("local CSV import without upload")
    page.set_viewport_size({"width":390,"height":844})
    for service in SERVICES:
        page.goto(BASE+service["path"])
        expect(page.locator("h1")).to_contain_text(service["name"],timeout=20000)
        page.wait_for_timeout(180)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"),service["path"]
        if service["path"] in capture:page.screenshot(path=str(OUT/(service["path"].strip("/")+"-mobile.png")),full_page=True)
        checks.append("mobile "+service["path"])
    button=page.locator('.ng-mobile-nav button');button.click()
    expect(page.locator(".ng-dialog-menu")).to_be_visible()
    page.locator(".ng-directory-search input").fill("yield")
    page.locator(".ng-directory-search input").fill(next(s["name"] for s in SERVICES if s["path"]=="/yield-curve-lab"))
    page.locator('.ng-dialog-menu a[href^="/yield-curve-lab"]').click()
    expect(page.locator("h1")).to_contain_text(next(s["name"] for s in SERVICES if s["path"]=="/yield-curve-lab"))
    expect(page.locator(".ng-dialog-menu")).not_to_be_visible()
    button.click();page.keyboard.press("Escape");expect(button).to_be_focused()
    checks += ["existing NEO mobile menu search and close", "Escape returns focus"]
    assert page.locator(".ng-sidebar .ng-research-new").first.evaluate("el=>getComputedStyle(el).animationName")=="none"
    checks.append("neon badge respects reduced motion")
    page.goto(BASE+"/markets?design=classic")
    expect(page.locator("html")).to_have_attribute("data-design","neo")
    expect(page.locator(".ng-shell")).to_have_count(1)
    expect(page.locator(".smt-desktop")).to_have_count(0)
    expect(page.locator(".ng-research.d2")).to_have_count(0)
    assert page.locator('.mdis-masthead,.mdis-footer').count()==0
    page.screenshot(path=str(OUT/"neo-existing-shell-mobile.png"),full_page=True)
    assert not errors,errors
    checks.append("paper mode removed; existing NEO shell only; no JavaScript exceptions")
    (OUT/"result.json").write_text(json.dumps({"checks":checks,"errors":errors,"service_count":len(SERVICES),"api":"all synthetic responses; no database access"},ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"passed":len(checks),"routes":len(SERVICES),"screenshots":str(OUT)},ensure_ascii=False))
    browser.close()
