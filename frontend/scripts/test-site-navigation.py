"""Read-only browser verification of the masthead's responsive disclosure menu.

Run against the isolated editorial preview; never starts the application/DB/jobs.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = os.environ.get("NAV_TEST_URL", "http://127.0.0.1:5199")
assert urlparse(BASE).hostname in ("localhost", "127.0.0.1"), "Use a local read-only preview"
OUT = Path(__file__).resolve().parents[2] / "tmp" / "site-navigation"
OUT.mkdir(parents=True, exist_ok=True)
CORE = ["/desk", "/global", "/map", "/kosdaq-map", "/sp500-map", "/nasdaq100-map"]
MORE = ["/market-bubbles", "/kospi-orbit", "/fight", "/global-top100", "https://voltaris-nyyo.onrender.com/"]
report = {"layouts": [], "interactions": [], "errors": []}

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True, args=["--mute-audio"])
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.add_init_script("localStorage.setItem('site_lang','ko'); localStorage.setItem('site_theme','dark');")
    context.route("**/api/**", lambda route: route.continue_() if route.request.method == "GET" else route.fulfill(status=200, json={"preview": True}))
    page = context.new_page()
    page.on("pageerror", lambda error: report["errors"].append(str(error)))
    for path in ("/desk", "/global"):
        page.goto(BASE + path, wait_until="domcontentloaded")
        page.locator(".d2-site-nav-primary").wait_for()
        page.evaluate("() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 6000))])")
        for lang in ("ko", "en"):
            page.locator(".d2-mast-lang button").filter(has_text="EN" if lang == "en" else "한").click()
            for width in (1440, 1280, 1024, 768, 760, 540, 390, 360, 320):
                page.set_viewport_size({"width": width, "height": 1000})
                # The app intentionally settles viewport/layout changes before
                # resizing its charts and page container.
                page.wait_for_timeout(600)
                state = page.locator(".d2-site-nav-row").evaluate("""row => {
                    const list = row.querySelector('ul'), button = row.querySelector('button');
                    const links = [...list.querySelectorAll('a')];
                    return {width:innerWidth, row:row.getBoundingClientRect().toJSON(),
                      client:list.clientWidth, scroll:list.scrollWidth,
                      links:links.map(a=>({href:a.getAttribute('href'),text:a.textContent,rect:a.getBoundingClientRect().toJSON()})),
                      button:button.getBoundingClientRect().toJSON()};
                }""")
                hrefs = [link["href"] for link in state["links"]]
                assert all(href in hrefs for href in CORE), (path, lang, width, "missing core", state)
                assert not any(href in hrefs for href in MORE), (path, lang, width, "more-only in primary")
                assert state["scroll"] <= state["client"] + 1, (path, lang, width, "horizontal overflow", state)
                assert max(link["rect"]["top"] for link in state["links"]) - min(link["rect"]["top"] for link in state["links"]) < 1, state
                assert state["links"][-1]["rect"]["right"] <= state["button"]["left"] + 1, state
                assert state["button"]["right"] <= width + 1 and state["row"]["left"] >= -1, state
                report["layouts"].append({"path": path, "lang": lang, "width": width, "visible": len(hrefs)})
        # Verify the panel at both sizes, in both colour themes.
        page.locator(".d2-mast-lang button").filter(has_text="한").click()
        for width in (1440, 390):
            page.set_viewport_size({"width": width, "height": 1000})
            page.locator(".d2-site-nav").evaluate("nav => nav.scrollIntoView({block:'start'})")
            for theme in ("dark", "light"):
                if page.locator("html").get_attribute("data-theme") != theme:
                    page.locator(".d2-mast-theme, .d2-mast-edition").click()
                button = page.locator(".d2-site-nav-more")
                button.click()
                panel = page.locator(".d2-site-nav-panel")
                panel.wait_for()
                hrefs = panel.locator("a").evaluate_all("links => links.map(a=>a.getAttribute('href'))")
                assert len(hrefs) == len(set(hrefs)) == 23, hrefs
                assert all(href in hrefs for href in CORE + MORE)
                assert panel.evaluate("el => el.scrollWidth <= el.clientWidth + 1"), (width, "panel overflow")
                assert panel.bounding_box()["x"] >= 0
                assert panel.bounding_box()["x"] + panel.bounding_box()["width"] <= width + 1
                page.screenshot(path=str(OUT / f"{path.strip('/')}-{width}-{theme}.png"))
                page.keyboard.press("Escape")
                assert panel.count() == 0
                assert button.evaluate("el => document.activeElement === el")
                report["interactions"].append({"path": path, "width": width, "theme": theme, "all_links": 23, "escape_focus": True})
        button.focus()
        page.keyboard.press("ArrowDown")
        page.wait_for_function("document.activeElement?.matches('.d2-site-nav-panel a')")
        page.keyboard.press("Escape")
        button.click()
        page.locator(".d2-mast-name").click()
        assert page.locator(".d2-site-nav-panel").count() == 0
        button.click()
        destination = "/global" if path == "/desk" else "/desk"
        page.locator(f'.d2-site-nav-panel a[href="{destination}"]').click()
        page.wait_for_url(BASE + destination)
        assert page.locator(".d2-site-nav-panel").count() == 0
        assert page.locator(f'.d2-site-nav-primary a[href="{destination}"]').get_attribute("aria-current") == "page"
    assert not report["errors"], report["errors"]
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"result": "passed", "layouts": len(report["layouts"]), "panel_checks": len(report["interactions"]), "errors": report["errors"]}))
    browser.close()
