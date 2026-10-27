"""Local-only admin layout QA. Every API is intercepted with synthetic data.

Run Vite on 4187; no backend/app startup, production traffic, credentials or DB.
"""
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("ADMIN_WORKSPACE_TEST_URL", "http://127.0.0.1:4187")
OUT = Path(__file__).resolve().parents[2] / "tmp" / "admin-workspace-qa"
OUT.mkdir(parents=True, exist_ok=True)


def fixture(path, query):
    if path == "/api/admin/summary":
        return {"online_now": 3, "total_visits": 1234, "views_last_24h": 80, "top_pages": [{"path": "/desk", "count": 50}]}
    if path.endswith("/traffic/audience"):
        return {"enabled": True, "edge_configured": True, "days": int(query.get("days", [30])[0]),
                "start_date": "2026-09-24", "end_date": "2026-10-23", "available_from": "2026-09-24",
                "browsers": 120, "sessions": 240, "repeat_browsers": 42, "regular_browsers": 25,
                "network_days": 180, "located_browser_days": 190, "browser_days": 200,
                "regions": [{"country": "KR", "region": "서울특별시", "city": "서울", "source": "cloudflare_ip", "browser_days": 120},
                            {"country": "KR", "region": "경기도", "city": "수원시", "source": "browser_location", "browser_days": 70},
                            {"country": "", "region": "", "city": "", "source": "unknown", "browser_days": 10}]}
    if path.endswith("/traffic/devices"):
        return {"days": int(query.get("days", [30])[0]), "start_date": "2026-09-24", "end_date": "2026-10-23",
                "total": 0, "coverage_percentage": 0, "history_ready": True, "missing_days": 0,
                "available_from": None, "aggregated_at": None, "generated_at": "2026-10-23T03:00:00Z",
                "types": [], "devices": [], "operating_systems": [], "browsers": []}
    if path.endswith("/growth/overview"):
        daily = [{"date": f"2026-10-{day:02}", "visitors": 100 + day, "pageviews": 300,
                  "search": 50, "email": 0, "social": 10, "referral": 20, "direct": 20,
                  "multiplier": 1.2, "achievement_pct": 1.2} for day in range(10, 24)]
        return {"days": 14, "goal": {"started_at": "2026-10-10", "baseline_daily_visitors": 100, "target_multiplier": 100},
                "today": daily[-1], "current_multiplier": 1.23, "achievement_pct": 1.23, "daily": daily,
                "channels": [], "pages": [], "search_sources": [], "campaigns": []}
    if path.endswith("/db/sources"):
        return {"sources": [{"id": "fixture", "label": "테스트 전용", "kind": "sqlite"}]}
    if path.endswith("/db/tables"):
        return {"tables": [{"name": "example_observations", "type": "table", "rows": 10}]}
    if path.endswith("/support-log"):
        return {"since": "2026-10-22T00:00:00Z", "until": "2026-10-23T00:00:00Z", "total": 0, "offset": 0, "limit": 50,
                "summary": {"sessions": 0, "views": 0, "clicks": 0, "pay_clicks": 0, "seconds": 0}, "items": []}
    if path.endswith("/live/sessions"):
        return {"sessions": []}
    if path.endswith("/live/tail"):
        return {"events": []}
    return None


with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'synthetic-only',expires_at:Date.now()/1000+3600}));")
    def intercept(route):
        url = urlparse(route.request.url)
        if url.hostname not in {"127.0.0.1", "localhost"}:
            return route.abort()
        if not url.path.startswith("/api/"):
            return route.continue_()
        value = fixture(url.path, parse_qs(url.query))
        return route.fulfill(status=200 if value is not None else 503,
                             json=value if value is not None else {"detail": "Synthetic unavailable fixture"})
    context.route("**/*", intercept)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    report = []
    paths = ["/admin/dashboard", "/admin/growth", "/admin/db", "/admin/support-log",
             "/admin/system-atlas", "/admin/monitor", "/admin/live"]
    for width in [1440, 1024, 390, 320]:
        page.set_viewport_size({"width": width, "height": 1000})
        for path in paths:
            page.goto(BASE + path)
            expect(page.locator(".aw-header")).to_be_visible()
            expect(page.locator(".aw-content > *").first).to_be_visible()
            page.wait_for_timeout(250)
            assert page.locator(".ac-side,.sa-rail").count() == 0, path
            dimensions = page.evaluate("({scroll:document.documentElement.scrollWidth,width:innerWidth})")
            assert dimensions["scroll"] <= dimensions["width"] + 1, (path, width, dimensions)
            report.append({"path": path, "width": width, "no_overflow": True})
            if width in [1440, 390] and path in ["/admin/dashboard", "/admin/growth", "/admin/db"]:
                page.screenshot(path=str(OUT / f"{path.rsplit('/',1)[1]}-{width}.png"), full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.goto(BASE + "/admin/dashboard")
    expect(page.locator(".aa-panel")).to_have_count(0)
    page.get_by_role("button", name="트래픽 방문·순위").click()
    expect(page.locator(".aa-panel")).to_be_visible()
    expect(page.locator(".aa-metrics strong").first).to_have_text("120")
    assert page.url.endswith("#traffic")
    page.reload()
    expect(page.get_by_role("button", name="트래픽 방문·순위")).to_have_attribute("aria-pressed", "true")
    # Simulate a 240px site left menu on a wide viewport. Container queries must
    # adapt to the remaining content width without creating a second nav rail.
    for path in paths:
        page.goto(BASE + path)
        page.evaluate("document.body.style.marginLeft='240px';document.body.style.width='calc(100% - 240px)'")
        expect(page.locator(".aw-header")).to_be_visible()
        assert page.locator(".ac-side,.sa-rail").count() == 0
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth+1"), path
    assert not errors, errors
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    browser.close()
print(f"PASS: {len(report)} admin viewport checks, hash/reload, simulated site menu, no JS errors. {OUT}")
