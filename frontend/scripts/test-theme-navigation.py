"""Read-only browser checks against a build or deployed site; proxy GET data only."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get("THEME_TEST_URL", "http://127.0.0.1:4178")
OUT = Path(os.environ.get("THEME_TEST_OUTPUT", str(Path(__file__).resolve().parents[2] / "tmp" / "theme-navigation")))
OUT.mkdir(parents=True, exist_ok=True)
PATHS = ["/desk", "/global", "/map", "/kosdaq-map", "/sp500-map", "/nasdaq100-map", "/realestate-map",
         "/stocks", "/stock/005930", "/stock/AAPL", "/kospi-100", "/kosdaq-100", "/nasdaq-100",
         "/etf", "/news", "/market-brief", "/ai-prediction", "/prediction-grading", "/global-top100",
         "/fight", "/dram-price", "/index/KOSPI", "/discussion-explorer", "/support", "/admin/login"]
report = {"url": BASE, "pages": [], "navigation": [], "cross_tab": False, "reload": False}

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    cache = {}

    def route(r):
        u = urlparse(r.request.url)
        if not u.path.startswith("/api/"):
            return r.continue_()
        if r.request.method != "GET":
            return r.fulfill(status=200, json={"ok": True})
        key = u.path + ("?" + u.query if u.query else "")
        if key not in cache:
            try:
                res = r.fetch(url="https://kospimap.com" + key, timeout=15000)
                cache[key] = (res.status, res.body())
            except Exception:
                cache[key] = (503, b'{"detail":"Test data upstream unavailable"}')
        status, body = cache[key]
        return r.fulfill(status=status, body=body, content_type="application/json")

    context.route("**/*", route)
    context.add_init_script("localStorage.setItem('site_theme','dark'); sessionStorage.setItem('d2:edition','us');")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    tile_colors = {}
    for mode in ["dark", "light"]:
        # The init script supplies a deterministic saved choice on every full load.
        context.add_init_script(f"localStorage.setItem('site_theme','{mode}');")
        for path in PATHS:
            before = len(errors)
            page.goto(BASE + path, wait_until="domcontentloaded")
            page.wait_for_function("document.querySelector('#root')?.childElementCount > 0")
            page.wait_for_timeout(300)
            page.wait_for_function("mode => document.documentElement.dataset.theme === mode", arg=mode)
            state = page.evaluate("""() => ({mode:document.documentElement.dataset.theme,
                scheme:getComputedStyle(document.documentElement).colorScheme,
                saved:localStorage.getItem('site_theme'),
                body:getComputedStyle(document.body).backgroundColor})""")
            assert state["scheme"] == mode, (path, state)
            assert state["saved"] == mode, (path, state)
            assert len(errors) == before, (path, errors[before:])
            if path == "/map":
                page.locator(".kospi-map-tile").first.wait_for(timeout=30000)
                tile_colors[mode] = page.locator(".kospi-map-tile").first.evaluate("el => getComputedStyle(el).backgroundColor")
                state["tile"] = tile_colors[mode]
                page.screenshot(path=str(OUT / f"map-{mode}.png"))
            if path == "/realestate-map":
                page.screenshot(path=str(OUT / f"realestate-{mode}.png"))
            report["pages"].append({"path": path, **state})
            print(json.dumps({"path": path, "mode": mode}), flush=True)
    assert tile_colors["dark"] != tile_colors["light"], tile_colors

    for path in ["/sp500-map", "/nasdaq100-map", "/stock/AAPL", "/stocks?market=sp500", "/etf?region=US", "/global"]:
        page.goto(BASE + path, wait_until="domcontentloaded")
        front = page.locator(".d2-mast-nav a").filter(has_text="1면").first
        front.wait_for()
        assert front.get_attribute("href") == "/desk", path
        front.click()
        page.wait_for_url(BASE + "/desk")
        page.locator("#d2-front").wait_for()
        assert not page.locator(".d2-world").count(), path
        assert page.locator('.d2-mast-nav a[href="/global"]').count() == 1
        report["navigation"].append({"from": path, "front": "/desk"})

    other = context.new_page()
    other.goto(BASE + "/global", wait_until="domcontentloaded")
    other.locator(".d2-mast").wait_for()
    page.locator(".d2-mast-edition").click()
    other.wait_for_function("document.documentElement.dataset.theme === 'dark'")
    page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
    # A reload should use what the user selected, not the test's bootstrap seed.
    context.clear_cookies()
    persisted = context.storage_state()
    reload_context = browser.new_context(storage_state=persisted, viewport={"width": 390, "height": 844})
    reload_context.route("**/*", route)
    mobile = reload_context.new_page()
    mobile.goto(BASE + "/sp500-map", wait_until="domcontentloaded")
    mobile.locator(".d2-mast").wait_for()
    mobile.wait_for_function("document.documentElement.dataset.theme === 'dark'")
    mobile.locator(".d2-mast-theme").click()
    mobile.wait_for_function("document.documentElement.dataset.theme === 'light'")
    mobile.reload(wait_until="domcontentloaded")
    mobile.locator(".d2-mast").wait_for()
    mobile.wait_for_function("document.documentElement.dataset.theme === 'light'")
    assert mobile.locator('.d2-mast-nav a').filter(has_text="1면").first.get_attribute("href") == "/desk"
    mobile.screenshot(path=str(OUT / "mobile-light.png"))
    report.update(cross_tab=True, reload=True, mobile=True, errors=errors)
    browser.close()

(OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"result": "passed", "pages": len(report["pages"]), "navigation": len(report["navigation"]),
                  "cross_tab": True, "reload": True, "mobile": True}), flush=True)
