"""All requests use synthetic fixtures; never send visitor events to live stores."""
import runpy
import time
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:4191"
NOW = time.time()
shared = []
OUT = Path(__file__).resolve().parents[2] / "qa/audience-map"
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True, args=["--mute-audio"])
    context = browser.new_context(viewport={"width": 1440, "height": 1100})
    context.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'synthetic-only',expires_at:Date.now()/1000+3600}));")
    def intercept(route):
        url = urlparse(route.request.url)
        if url.hostname == "tile.openstreetmap.org" and os.environ.get("AUDIENCE_MAP_REAL_TILES") == "1": return route.continue_()
        if url.hostname not in {"127.0.0.1", "localhost"}: return route.abort()
        if not url.path.startswith("/api/"): return route.continue_()
        if url.path.endswith("/activity/audience-config"):
            return route.fulfill(json={"enabled":True,"location_enabled":True,"presence_enabled":True})
        if url.path.endswith("/activity/audience-location"):
            shared.append(route.request.post_data_json)
            return route.fulfill(json={"accepted":True})
        if url.path.endswith("/activity/audience-presence"):
            return route.fulfill(json={"accepted":True})
        if url.path.endswith("/traffic/audience"):
            return route.fulfill(json={"enabled": True, "edge_configured": True, "days":30,"start_date":"2026-09-24","end_date":"2026-10-23",
                "available_from":"2026-10-23","browsers":2,"sessions":3,"repeat_browsers":0,"regular_browsers":0,"network_days":2,
                "located_browser_days":2,"browser_days":2,"regions":[{"country":"KR","region":"Gyeonggi-do","city":"Suwon","source":"dbip_city_lite","browser_days":2}]})
        if url.path.endswith("/traffic/audience/live"):
            return route.fulfill(json={"enabled":True,"updated_at":NOW,"located":2,"unlocated":1,"diagnostics":{"received":3,"stored":3,"failed":0},
                "sessions":[{"id":"precise123456","source":"browser_location","seen_at":NOW,"captured_at":NOW,"country":"KR","region":"Gyeonggi-do","city":"Suwon","latitude":37.264123,"longitude":127.029456,"accuracy_m":12},
                    {"id":"estimate123456","source":"ip_estimate","seen_at":NOW,"captured_at":NOW,"country":"US","region":"California","city":"San Francisco","latitude":37.77,"longitude":-122.41,"accuracy_m":50000},
                    {"id":"unknown123456","source":"unknown","seen_at":NOW,"captured_at":NOW,"country":"","region":"","city":""}]})
        if url.path == "/api/admin/summary":return route.fulfill(json={"online_now":3,"total_visits":100,"views_last_24h":10,"top_pages":[]})
        return route.fulfill(status=503,json={"detail":"Synthetic QA fixture"})
    context.route("**/*",intercept)
    page=context.new_page();errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    for width in ([1440] if os.environ.get("AUDIENCE_MAP_REAL_TILES") == "1" else [1440,1024,390,320]):
        page.set_viewport_size({"width":width,"height":1100})
        page.wait_for_function("(width) => innerWidth === width", arg=width)
        page.goto(BASE+"/admin/dashboard#traffic")
        expect(page.locator(".aa-live")).to_be_visible(timeout=30000)
        expect(page.locator(".aa-live-list>button")).to_have_count(3)
        expect(page.locator(".aa-table tbody")).to_contain_text("경기도")
        expect(page.locator(".aa-table tbody")).to_contain_text("수원")
        assert "Gyeonggi" not in page.locator(".aa-table tbody").inner_text()
        page.locator(".aa-live-list>button").first.click()
        expect(page.locator(".aa-live .aa-header p")).to_contain_text("17단계")
        page.locator(".leaflet-control-zoom-in").click()
        expect(page.locator(".aa-live .aa-header p")).to_contain_text("18단계")
        page.wait_for_function("document.documentElement.scrollWidth <= innerWidth + 1")
        if os.environ.get("AUDIENCE_MAP_REAL_TILES") == "1":
            expect(page.locator(".leaflet-tile-loaded").first).to_be_visible(timeout=20000)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),width
        page.locator(".aa-live").screenshot(path=str(OUT/f"map-{width}.png"))
        if width == 1440:
            page.get_by_role("button",name="지도 크게 보기").click()
            page.wait_for_function("!!document.fullscreenElement")
            page.get_by_role("button",name="지도 크게 보기").click()
            page.wait_for_function("!document.fullscreenElement")
    page.add_init_script("window.__positionRequests=0;navigator.geolocation.getCurrentPosition=(ok)=>{window.__positionRequests++;ok({coords:{latitude:37.264123,longitude:127.029456,accuracy:12}});};")
    page.goto(BASE+"/global/treasuries/10")
    expect(page.locator(".audience-privacy")).to_be_visible()
    assert page.evaluate("window.__positionRequests") == 0
    page.locator(".audience-privacy summary").click()
    page.get_by_role("button",name="관리자에게 현재 위치 한 번 공유하기").click()
    expect(page.locator(".audience-privacy [role=status]")).to_contain_text("반영했습니다")
    assert page.evaluate("window.__positionRequests") == 1
    assert len(shared) == 1 and shared[0]["consent"] is True
    assert shared[0]["latitude"] == 37.264123 and shared[0]["accuracy_m"] == 12
    assert not errors,errors
    browser.close()
print("PASS: Korean labels, 3 live sessions, precise/IP/unknown, focus/zoom/fullscreen, responsive layout, explicit-only precise location consent; intercepted APIs.")
