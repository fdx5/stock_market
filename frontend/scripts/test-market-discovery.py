"""Browser QA with synthetic in-memory API responses; no backend or saved DB access.

Start Vite on 127.0.0.1:5184 before running. All /api requests are intercepted.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:5184"
OUT = Path(__file__).resolve().parents[2] / "tmp" / "market-discovery-qa"
OUT.mkdir(parents=True, exist_ok=True)
ROUTES = {"/markets": "시장 탐색", "/market-inside": "시장 속사정", "/stock-tradeoffs": "종목 선택의 대가", "/recovery-lab": "회복 거리 실험실", "/market-radar": "주도주 레이더", "/stock-screener": "종목 스크리너", "/stock-compare": "종목 비교", "/sector-strength": "업종 강도판"}


def board(market):
    roster = [("005930", "삼성전자", "반도체", 500, 10), ("000660", "SK하이닉스", "반도체", 250, 0), ("005380", "현대차", "자동차", 150, 0), ("000270", "기아", "자동차", 100, -10), ("035420", "네이버", "인터넷", 50, -2), ("035720", "카카오", "인터넷", 40, -3)]
    if market == "kosdaq":
        roster = [("086520", "에코프로", "화학", 200, 5), ("247540", "에코프로비엠", "화학", 100, -3), ("035900", "JYP", "엔터", 50, 1)]
    if market == "nasdaq":
        roster = [("NVDA", "엔비디아", "반도체", 500, 5), ("AAPL", "애플", "전자", 450, -1), ("MSFT", "마이크로소프트", "소프트웨어", 400, 2), ("AMD", "AMD", "반도체", 150, -2), ("AMZN", "아마존", "인터넷", 100, 1)]
    items = []
    for i, (code, name, sector, cap, change) in enumerate(roster):
        items.append(dict(rank=i + 1, code=code, name=name, sector=sector, close=90000 + i * 1000, change_pct=change, change=change, marcap=cap * 1e9 if market != "nasdaq" else 5, market_cap=cap * 1e9 if market == "nasdaq" else None, per=10 + i * 4 if i != 4 else None, roe=15 + i, volume=10000 + i * 100, week52_high=100000, week52_low=50000, returns={"w1": 1 + i, "m1": 3 + i, "m3": 5 + i, "ytd": 10 + i}, points=[]))
    return dict(market=market, label=market, currency="USD" if market == "nasdaq" else "KRW", marcap_kind="weight" if market == "nasdaq" else "krw", session="regular", generated_at="2026-10-25T12:00:00+09:00", count=len(items), items=items, sectors=[], breadth={}, spark_dates=[])


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    requests = []
    fail_market = {"value": None}

    def handle(route):
        url = route.request.url
        if not url.startswith(BASE):
            route.abort()
            return
        if not url.startswith(BASE + "/api/"):
            route.continue_()
            return
        requests.append({"url": url, "body": route.request.post_data or ""})
        if "/market/board?" in url:
            from urllib.parse import urlsplit, parse_qs
            market = parse_qs(urlsplit(url).query)["market"][0]
            if market == fail_market["value"]:
                route.fulfill(status=503, content_type="application/json", body='{"detail":"synthetic outage"}')
            else:
                route.fulfill(content_type="application/json", body=json.dumps(board(market), ensure_ascii=False))
        else:
            route.fulfill(content_type="application/json", body='{"enabled":false,"items":[],"count":0,"total":0}')

    context.route("**/*", handle)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    checks = []
    for route, title in ROUTES.items():
        page.goto(BASE + route)
        expect(page.get_by_role("heading", name=title, exact=True)).to_be_visible(timeout=20000)
        expect(page.get_by_role("button", name="집계 새로고침", exact=True)).to_be_enabled(timeout=20000)
        page.screenshot(path=str(OUT / (route.strip("/") + "-desktop.png")), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), route
        checks.append("desktop " + route)

    page.goto(BASE + "/stock-screener")
    expect(page.get_by_role("button", name="집계 새로고침", exact=True)).to_be_enabled()
    page.get_by_label("최대 PER (배)").fill("15")
    expect(page.locator(".mdis-table tbody tr")).to_have_count(2)
    page.reload()
    expect(page.get_by_label("최대 PER (배)")).to_have_value("15")
    expect(page.locator(".mdis-table tbody tr")).to_have_count(2)
    with page.expect_download() as download:
        page.get_by_role("button", name="결과 CSV").click()
    assert download.value.suggested_filename.endswith(".csv")
    page.get_by_role("button", name="조건 초기화", exact=True).click()
    page.get_by_label("삼성전자 비교 선택").check()
    page.get_by_label("SK하이닉스 비교 선택").check()
    page.get_by_role("link", name="선택 종목 비교 ↗").click()
    expect(page.locator(".mdis-compare thead th")).to_have_count(3)
    checks += ["filter+URL restore", "CSV download", "selection -> comparison"]

    page.goto(BASE + "/stock-compare?codes=kospi:005930,kospi:000660,kospi:005380,kospi:000270")
    expect(page.get_by_role("button", name="집계 새로고침", exact=True)).to_be_enabled()
    assert page.locator(".mdis-candidates button:disabled").count() > 0
    checks.append("four-stock maximum")
    page.goto(BASE + "/market-inside")
    expect(page.locator(".mdis-verdict h2")).to_contain_text("오른 종목은 절반 미만")
    expect(page.locator(".mdis-counterfactual strong")).to_contain_text("-")
    checks.append("market divergence + counterfactual")
    page.goto(BASE + "/stock-tradeoffs")
    expect(page.locator(".mdis-tradeoff-card")).to_have_count(1)
    expect(page.locator(".mdis-tradeoff-card")).to_contain_text("SK하이닉스")
    checks.append("same-sector tradeoffs")
    page.goto(BASE + "/recovery-lab")
    page.get_by_label("가정한 하락률 (%)").fill("50")
    expect(page.locator(".mdis-insight-metric strong").nth(2)).to_have_text("+100.00%")
    page.get_by_label("가정한 목표 가격 (KRW)").fill("1234567")
    assert "1234567" not in page.url
    assert not any("1234567" in r["url"] or "1234567" in r["body"] for r in requests)
    assert "1234567" not in page.evaluate("JSON.stringify({...localStorage,...sessionStorage})")
    page.reload()
    expect(page.get_by_label("가정한 목표 가격 (KRW)")).to_have_value("")
    page.get_by_label("가정한 하락률 (%)").fill("100")
    expect(page.locator('.mdis-notice[role="status"]')).to_contain_text("100 미만")
    checks += ["loss recovery boundaries", "private input absent from URL/storage/API"]

    # A failed refresh preserves the last valid market snapshot.
    page.goto(BASE + "/market-radar")
    expect(page.get_by_role("button", name="집계 새로고침", exact=True)).to_be_enabled()
    count = page.locator(".mdis-table tbody tr").count()
    fail_market["value"] = "kospi"
    page.get_by_role("button", name="집계 새로고침", exact=True).click()
    expect(page.locator(".mdis-data-status")).to_contain_text("이전 집계 표시")
    assert page.locator(".mdis-table tbody tr").count() == count
    fail_market["value"] = None
    checks.append("failed refresh retains last good data")
    page.get_by_role("button", name="링크 복사", exact=True).click()
    expect(page.locator('.mdis-share [role="status"]')).not_to_be_empty()
    checks.append("share link copy or visible fallback")
    for route in ROUTES:
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(BASE + route)
        expect(page.get_by_role("button", name="집계 새로고침", exact=True)).to_be_enabled()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), route
        page.screenshot(path=str(OUT / (route.strip("/") + "-mobile.png")), full_page=True)
        checks.append("mobile " + route)
    page.get_by_role("button", name="밝은 화면", exact=True).click()
    expect(page.locator("html")).to_have_attribute("data-theme", "light")
    page.wait_for_function("document.documentElement.classList.contains('is-desk2') && document.querySelector('.mdis-main').getBoundingClientRect().width >= 380")
    page.wait_for_timeout(300)
    assert page.locator(".mdis-sector-card").first.bounding_box()["width"] > 300
    page.screenshot(path=str(OUT / "sector-strength-light.png"), full_page=True)
    assert errors == [], errors
    checks += ["light theme", "no JavaScript exceptions"]
    (OUT / "result.json").write_text(json.dumps({"checks": checks, "javascript_errors": errors, "api": "all intercepted synthetic responses", "saved_database_access": False}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": len(checks), "screenshots": str(OUT)}, ensure_ascii=False))
    browser.close()
