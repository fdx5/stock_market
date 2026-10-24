"""Local UI regression with synthetic API responses; never opens a live store."""
import json
import os
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("AUDIENCE_MAP_TEST_URL", "http://127.0.0.1:4197")
OUT = Path(__file__).resolve().parents[2] / "qa/audience-country"
OUT.mkdir(parents=True, exist_ok=True)
NOW = time.time()
REGIONS = [
    {"country": "KR", "region": "Gyeonggi-do", "city": "Suwon", "source": "dbip_city_lite", "browser_days": 5},
    {"country": "US", "region": "California", "city": "San Francisco", "source": "dbip_city_lite", "browser_days": 2},
    {"country": "", "region": "", "city": "", "source": "unknown", "browser_days": 1},
]
SESSIONS = [{**row, "id": f"session-{i}", "source": "ip_estimate" if row["country"] else "unknown",
             "seen_at": NOW, "captured_at": NOW,
             **({"latitude": 37.2 if i == 0 else 37.77, "longitude": 127 if i == 0 else -122.4, "accuracy_m": 50000} if i < 2 else {})}
            for i, row in enumerate(REGIONS)]
requests = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1100})
    context.add_init_script("if(location.protocol==='http:')localStorage.setItem('admin_session',JSON.stringify({token:'synthetic-only',expires_at:Date.now()/1000+3600}));")
    def intercept(route):
        url = urlparse(route.request.url)
        if url.hostname == "flagcdn.com":
            return route.fulfill(content_type="image/svg+xml", body='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><path fill="blue" d="M0 0h24v16H0z"/></svg>')
        if url.hostname not in {"127.0.0.1", "localhost"}: return route.abort()
        if not url.path.startswith("/api/"): return route.continue_()
        query = parse_qs(url.query, keep_blank_values=True)
        country = query.get("country", [""])[0]
        keep = lambda row: not country or row["country"] == ("" if country == "unknown" else country)
        requests.append((url.path, country))
        if url.path.endswith("/traffic/audience"):
            return route.fulfill(json={"enabled": True, "edge_configured": True, "days": int(query.get("days", [30])[0]),
                "start_date": "2026-09-25", "end_date": "2026-10-24", "available_from": "2026-10-23",
                "browsers": 3, "sessions": 3, "repeat_browsers": 0, "regular_browsers": 0, "network_days": 3,
                "located_browser_days": 2, "browser_days": 3, "country": country,
                "countries": [{"country": row["country"], "browser_days": row["browser_days"]} for row in REGIONS],
                "regions": [row for row in REGIONS if keep(row)]})
        if url.path.endswith(("/traffic/audience/live", "/traffic/audience/regions")):
            rows = [row for row in SESSIONS if keep(row)]
            return route.fulfill(json={"enabled": True, "updated_at": NOW, "country": country, "sessions": rows,
                "total": len(rows), "located": sum("latitude" in row for row in rows),
                "unlocated": sum("latitude" not in row for row in rows), "diagnostics": {"received": 3, "stored": 3, "failed": 0}})
        if url.path == "/api/admin/summary":
            return route.fulfill(json={"online_now": 3, "total_visits": 10, "views_last_24h": 5, "top_pages": []})
        return route.fulfill(status=503, json={"detail": "Synthetic fixture"})
    context.route("**/*", intercept)
    page = context.new_page(); errors = []
    page.on("pageerror", lambda error: (errors.append(str(error)), print("JS ERROR:", error)))
    for width in (1440, 1024, 390, 320):
        page.set_viewport_size({"width": width, "height": 1100})
        page.goto("about:blank")
        page.goto(BASE + "/admin/dashboard#traffic")
        combo = page.get_by_role("combobox", name="조회 국가")
        expect(combo).to_contain_text("전체")
        expect(page.locator(".aa-live-list>button")).to_have_count(3, timeout=30000)
        expect(page.locator(".aa-live-summary")).to_contain_text("24시간 접속 세션 3")
        combo.click()
        expect(page.get_by_role("option", name="미국").locator("img")).to_have_attribute("src", "https://flagcdn.com/us.svg")
        page.get_by_role("option", name="미국").click()
        expect(page.locator(".aa-table tbody tr")).to_have_count(1)
        expect(page.locator(".aa-table tbody")).to_contain_text("미국")
        expect(page.locator(".aa-live-list>button")).to_have_count(1)
        expect(page.locator(".aa-live-list img")).to_have_attribute("src", "https://flagcdn.com/us.svg")
        page.get_by_role("button", name="선택 기간 방문 지역", exact=True).click()
        expect(page.locator(".aa-live-list>button")).to_have_count(1)
        combo.click(); page.get_by_role("option", name="국가 미확인").click()
        expect(page.locator(".aa-table tbody")).to_contain_text("지역 미확인")
        expect(page.locator(".aa-live-list>button")).to_have_count(1)
        combo.focus(); combo.press("Home"); combo.press("Enter")
        expect(combo).to_contain_text("전체")
        expect(page.locator(".aa-table tbody tr")).to_have_count(3, timeout=30000)
        expect(page.locator(".aa-live-list>button")).to_have_count(3, timeout=30000)
        combo.click(); combo.press("Escape")
        expect(combo).to_have_attribute("aria-expanded", "false")
        page.locator(".aa-panel").get_by_label("조회 기간").select_option("7")
        expect(page.locator(".aa-panel>header p")).to_contain_text("2026-09-25")
        page.wait_for_function("document.documentElement.scrollWidth <= innerWidth + 1")
        page.locator(".aa-panel").screenshot(path=str(OUT / f"country-{width}.png"))
    assert not errors, errors
    for suffix in ("/traffic/audience", "/traffic/audience/live", "/traffic/audience/regions"):
        assert any(path.endswith(suffix) and country == "US" for path, country in requests)
    (OUT / "report.json").write_text(json.dumps({"widths": [1440, 1024, 390, 320], "errors": errors, "requests": requests}, indent=2), encoding="utf-8")
    browser.close()
print("PASS: all/country/unknown, flag images, map and list filters, keyboard, four viewport widths, no JS errors.")
