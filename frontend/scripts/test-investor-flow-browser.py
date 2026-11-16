"""Read-only browser fixtures: every /api request is fulfilled in memory.

Run Vite on :5186 first, then run this script. No backend, DB, ads or analytics.
"""
import json
import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "tmp" / "investor-flow-review"
OUTPUT.mkdir(parents=True, exist_ok=True)
URL = os.environ.get("FLOW_REVIEW_URL", "http://127.0.0.1:5186")
state = {"calls": 0, "closed": False, "unchanged": False, "missing": False, "stale": False}


def fixture(route):
    url = urlparse(route.request.url)
    if url.netloc != urlparse(URL).netloc:
        route.abort()
        return
    if not url.path.startswith("/api/"):
        route.continue_()
        return
    now = datetime.fromtimestamp(state.get("fixed_time", time.time()), timezone.utc)
    stamp = now.isoformat()
    day = now.astimezone(timezone(timedelta(hours=9))).strftime("%Y%m%d")
    data = {"items": [], "count": 0, "total": 0}
    if url.path == "/api/investor/indices":
        state["calls"] += 1
        step = 0 if state["unchanged"] else state["calls"]
        def source(market):
            return None if state["missing"] else {
                "individual_amount": (6256 if market == "kospi" else 2459) + step * 5,
                "foreign_amount": (-9116 if market == "kospi" else -1617) - step * 3,
                "institution_amount": (1235 if market == "kospi" else -645) + step * 2,
                "business_date": day, "fetched_at": now.timestamp() - (60 if state["stale"] else 0),
            }
        data = {market: {"symbol": market.upper(), "name": market, "close": 5160 if market == "kospi" else 674,
                        "change": -24, "change_pct": -2.45, "market_status": "CLOSE" if state["closed"] else "OPEN", "updated_at": stamp}
                for market in ("kospi", "kosdaq")}
        data.update({f"{market}_investor": source(market) for market in ("kospi", "kosdaq")})
    elif url.path in ("/api/market/map", "/api/market/kosdaq-map", "/api/market/nasdaq100-map"):
        data = {"items": [{"code": "005930", "name": "삼성전자", "close": 72000, "change_pct": -1.2, "marcap": 4e14, "sector": "반도체"},
                          {"code": "000660", "name": "SK하이닉스", "close": 180000, "change_pct": 1.8, "marcap": 2e14, "sector": "반도체"}], "generated_at": stamp}
    elif url.path == "/api/global/kospi-futures":
        data = {"close": 672.5, "change_pct": -.4, "quote_time": time.time(), "session_state": "open"}
    elif url.path == "/api/geo/country":
        data = {"country": "KR"}
    route.fulfill(content_type="application/json", body=json.dumps(data, ensure_ascii=False))


def amounts(page):
    return page.locator(".pif-amount").evaluate_all("els => els.map(el => el.getAttribute('aria-label'))")


def capture(page, name):
    page.screenshot(path=str(OUTPUT / f"{name}.png"))


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
    page.route("**/*", fixture)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("localStorage.setItem('site_lang','ko');")
    # UI checks exercise the supported no-WebGL fallback, avoiding expensive sea
    # shader compilation in headless Chrome. No rendering resolution is changed.
    page.add_init_script("""const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){
        return /webgl|webgpu/.test(kind)?null:original.call(this,kind,...args);
      };""")
    page.goto(f"{URL}/pulse-board")
    page.locator(".pif-panel[data-mode=flowing]").wait_for(timeout=60000)
    assert page.locator(".pb-market-prompt").inner_text().find("눌러서 시장 전환") >= 0
    assert page.locator(".pb-tab[aria-selected=false] .pb-tab-action").count() == 2
    capture(page, "desktop")
    page.locator(".pif-panel[data-mode=flowing]").wait_for(timeout=20000)
    assert state["calls"] == 1, "rolling must start on first entry without waiting for another poll"
    samples = []
    for _ in range(8):
        samples.append(amounts(page))
        page.wait_for_timeout(140)
    assert len({tuple(row) for row in samples}) >= 7, samples
    assert page.evaluate("document.querySelector('.pif-panel').getAnimations({subtree:true}).length") > 0
    assert page.locator(".pif-explain,.pif-foot,.pif-status").count() == 0
    assert page.locator(".pif-controls button").inner_text() == "Ⅱ"
    assert page.locator(".pif-panel").bounding_box()["height"] < 65
    capture(page, "rolling")
    print("PASS immediate first-entry rolling, icon control and compact panel", flush=True)

    # An ad stand-in exercises the exact layout selector without contacting AdSense.
    page.evaluate("""() => { const ad=document.createElement('ins');ad.className='ng-adsense-banner';ad.dataset.adStatus='filled';ad.style.cssText='display:block;width:100%;height:90px;background:#23192c';document.querySelector('.pb-banner').append(ad); }""")
    page.wait_for_timeout(150)
    panel = page.locator(".pif-panel").bounding_box()
    ad = page.locator(".pb-banner").bounding_box()
    assert panel["x"] + panel["width"] <= ad["x"], (panel, ad)
    capture(page, "beside-ad")
    for width in (1280, 768, 390, 320):
        page.set_viewport_size({"width": width, "height": 900})
        page.wait_for_timeout(200)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
        assert page.locator(".pif-panel").evaluate("el => el.scrollWidth <= el.clientWidth"), width
        assert page.locator(".pif-row").evaluate_all("els=>els.every(el=>el.scrollWidth<=el.clientWidth)"), width
        assert page.locator(".pif-panel").bounding_box()["height"] < 100, width
        capture(page, f"width-{width}")
    print("PASS banner-left desktop layout and 1280/768/390/320px without overflow", flush=True)

    page.set_viewport_size({"width": 1600, "height": 1000})
    page.get_by_role("button", name="숫자 흐름 멈추기", exact=True).click()
    page.locator(".pif-panel[data-mode=paused]").wait_for()
    paused = amounts(page)
    page.wait_for_timeout(550)
    assert paused == amounts(page)
    page.get_by_role("button", name="숫자 흐름 켜기", exact=True).click()
    page.get_by_role("tab", name="KOSDAQ", exact=False).click()
    assert page.locator(".pif-kicker").inner_text().startswith("KOSDAQ")
    assert page.locator(".pif-row[data-tone=sell]").count() == 2
    page.get_by_role("tab", name="NASDAQ 100", exact=False).click()
    assert page.locator(".pif-panel").count() == 0
    page.get_by_role("tab", name="KOSPI", exact=False).click()
    page.get_by_role("tab", name="KOSPI", exact=False).press("ArrowRight")
    assert page.get_by_role("tab", name="KOSDAQ", exact=False).get_attribute("aria-selected") == "true"
    page.get_by_role("tab", name="KOSDAQ", exact=False).press("ArrowLeft")
    assert page.get_by_role("tab", name="KOSPI", exact=False).get_attribute("aria-selected") == "true"
    page.emulate_media(reduced_motion="reduce")
    page.locator(".pif-panel[data-still=true]").wait_for()
    assert page.locator(".pif-controls button").is_disabled()
    assert page.locator(".pif-panel").evaluate("el=>el.getAnimations({subtree:true}).length") == 0
    page.emulate_media(reduced_motion="no-preference")
    print("PASS pause, market switching, NASDAQ exclusion and reduced motion", flush=True)

    state["closed"] = True
    page.locator(".pif-panel[data-mode=closed]").wait_for(timeout=20000)
    settled = amounts(page)
    page.wait_for_timeout(500)
    assert settled == amounts(page)
    capture(page, "closed")
    state["closed"] = False
    state["stale"] = True
    page.locator(".pif-panel[data-mode=delayed]").wait_for(timeout=20000)
    print("PASS closed and stale feeds stop at received amounts", flush=True)

    # Reload isolates the shared hook's in-memory retained snapshot for no-data testing.
    state["stale"] = False
    state["missing"] = True
    page.reload()
    page.locator(".pif-panel[data-mode=loading]").wait_for(timeout=30000)
    assert page.locator(".pif-empty").count() == 3
    state["missing"] = False
    state["unchanged"] = True
    state["fixed_time"] = time.time()
    page.clock.install(time=datetime.fromtimestamp(state["fixed_time"], timezone.utc))
    page.reload()
    page.locator(".pif-panel[data-mode=flowing]").wait_for(timeout=30000)
    original = amounts(page)
    reference = page.locator(".pif-row").first.get_attribute("title")
    page.clock.run_for(1000)
    assert amounts(page) != original
    state["unchanged"] = False
    for _ in range(5):
        state["fixed_time"] += 10
        page.clock.fast_forward(10000)
        page.wait_for_timeout(100)
        assert page.locator(".pif-panel").get_attribute("data-mode") == "flowing"
        assert page.locator(".pif-row").first.get_attribute("title") == reference, "reference must hold for one minute"
    state["fixed_time"] += 12
    page.clock.fast_forward(12000)
    page.wait_for_timeout(200)
    assert page.locator(".pif-row").first.get_attribute("title") != reference, "new reference must be accepted after one minute"
    assert page.locator(".pif-panel").get_attribute("data-mode") == "flowing"
    print("PASS a full minute of continuous rolling and minute reference refresh", flush=True)
    # Visibility is emulated only in this isolated test page; no user tabs change.
    page.evaluate("""() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
      document.dispatchEvent(new Event('visibilitychange')); }""")
    calls = state["calls"]
    state["fixed_time"] += 12
    page.clock.fast_forward(12000)
    assert state["calls"] == calls, "background tabs must not poll"
    # The shared scheduler deliberately staggers pollers by up to one interval.
    page.evaluate("""() => { delete document.hidden;delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange')); }""")
    state["fixed_time"] += 10
    page.clock.fast_forward(10000)
    page.wait_for_timeout(200)
    assert state["calls"] > calls
    assert page.locator(".pif-panel").get_attribute("data-mode") == "flowing"
    print("PASS hidden tabs pause and resume visual flow without replaying missed changes", flush=True)
    assert not errors, errors
    browser.close()
    print(json.dumps({"result": "PASS", "screenshots": str(OUTPUT), "page_errors": errors}, ensure_ascii=False), flush=True)
