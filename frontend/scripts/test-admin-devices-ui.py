"""Isolated browser regression, synthetic read-only responses, no production DB.
Requires Vite (default http://127.0.0.1:5173) and Playwright's Edge channel.
"""
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, expect

base = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5173")
output = Path(__file__).resolve().parents[2] / "tmp" / "admin-devices-qa"
output.mkdir(parents=True, exist_ok=True)
categories = [("desktop", 350), ("tablet", 80), ("mobile", 550), ("unknown", 20)]
names = {"desktop": "Windows PC", "tablet": "Apple iPad", "mobile": "Samsung · SM-S928N", "unknown": "기기 미확인"}
payload = {
    "metric": "human_pageviews", "total": 1000, "coverage_percentage": 98,
    "start_date": "2026-09-01", "end_date": "2026-09-30", "available_from": "2026-08-01",
    "generated_at": "2026-09-30T04:00:00Z", "aggregated_at": "2026-09-30T03:00:00Z",
    "history_ready": True, "missing_days": 0,
    "types": [{"type": kind, "count": count, "percentage": count / 10} for kind, count in categories],
    "devices": [{"type": kind, "name": names[kind], "count": count, "percentage": count / 10, "within_type_percentage": 100} for kind, count in categories],
    "operating_systems": [{"name": "Windows", "count": 350, "percentage": 35}, {"name": "Android", "count": 400, "percentage": 40}, {"name": "iOS", "count": 150, "percentage": 15}, {"name": "iPadOS", "count": 80, "percentage": 8}, {"name": "미확인", "count": 20, "percentage": 2}],
    "browsers": [{"name": "Chrome", "count": 600, "percentage": 60}, {"name": "Safari", "count": 250, "percentage": 25}, {"name": "Samsung Internet", "count": 100, "percentage": 10}, {"name": "미확인", "count": 50, "percentage": 5}],
}

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1100}, device_scale_factor=1)
    context.add_init_script("localStorage.setItem('admin_session', JSON.stringify({token:'fixture-only',expires_at:Date.now()/1000+3600}));")
    state = {"error": False, "hold": False, "mode": "normal"}
    held = []

    def respond(route):
        assert route.request.method == "GET", "Only read-only fixture requests allowed"
        days = int(parse_qs(urlparse(route.request.url).query)["days"][0])
        if state["hold"] and days == 365:
            held.append(route)
            return
        if state["error"]:
            route.fulfill(status=503, json={"detail": "테스트: 일시적인 조회 실패"})
        else:
            result = {**payload, "days": days, "start_date": "2026-09-24" if days == 7 else payload["start_date"]}
            if state["mode"] == "empty":
                result.update(total=0, coverage_percentage=0, devices=[], browsers=[], operating_systems=[], types=[{**row, "count": 0, "percentage": 0} for row in payload["types"]])
            elif state["mode"] == "partial":
                result.update(history_ready=False, missing_days=7)
            route.fulfill(json=result)

    context.route("**/api/admin/**", respond)
    errors = []
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base + "/tests/admin-devices.preview.html")
    expect(page.locator(".ad-device-donut-center strong")).to_have_text("1,000")
    legend = page.locator(".ad-device-legend button").filter(has_text="모바일")
    legend.click()
    expect(legend).to_have_attribute("aria-pressed", "true")
    expect(page.locator(".ad-device-card.is-selected h3")).to_contain_text("모바일")
    page.screenshot(path=str(output / "desktop-dark.png"), full_page=True)
    page.locator("select").select_option("7")
    expect(page.locator(".ad-device-head p")).to_have_text("2026-09-24 ~ 2026-09-30")
    state["error"] = True
    page.get_by_role("button", name="기기 통계 새로고침").click()
    expect(page.get_by_role("alert")).to_contain_text("마지막 성공 값")
    expect(page.locator(".ad-device-donut-center strong")).to_have_text("1,000")
    state["error"] = False
    page.get_by_role("button", name="다시 시도").click()
    expect(page.get_by_role("alert")).to_have_count(0)
    for theme in ["dark", "light"]:
        page.evaluate("theme => document.documentElement.dataset.theme = theme", theme)
        for width in [1440, 390, 320]:
            page.set_viewport_size({"width": width, "height": 950})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Horizontal overflow: {theme}/{width}"
            assert page.locator(".ad-device-donut svg").is_visible()
            page.screenshot(path=str(output / f"{theme}-{width}.png"), full_page=True)
    state["hold"] = True
    page.locator("select").select_option("365")
    expect(page.get_by_role("status")).to_contain_text("불러오는 중")
    page.wait_for_timeout(100)
    page.locator("select").select_option("90")
    expect(page.locator(".ad-device-donut-center strong")).to_have_text("1,000")
    assert len(held) == 1
    held[0].fulfill(json={**payload, "days": 365, "total": 42})
    page.wait_for_timeout(100)
    expect(page.locator(".ad-device-donut-center strong")).to_have_text("1,000")
    state["mode"] = "empty"
    page.locator("select").select_option("1")
    expect(page.locator(".ad-device-donut-center strong")).to_have_text("0")
    expect(page.locator(".ad-device-donut-center span")).to_have_text("데이터 없음")
    state["mode"] = "partial"
    page.locator("select").select_option("30")
    expect(page.get_by_role("status")).to_contain_text("7일 미완료")
    assert not errors, errors
    browser.close()
print(f"PASS: selection, period/race, failure/retry, empty/partial, dark/light, desktop/390/320px; screenshots {output}")
