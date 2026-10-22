"""Headless regression tests against Vite, with synthetic feeds and no database.

Start Vite, then run python scripts/test-scroll-navigation.py [base-url].
"""
import json
import sys
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5193"
results = []

def check(name, condition, detail=None):
    assert condition, f"{name}: {detail}"
    results.append({"test": name, "passed": True, "detail": detail})
    print("PASS " + name, flush=True)

def mock(route):
    url = urlparse(route.request.url)
    if not url.path.startswith('/api/'):
        route.continue_()
        return
    if url.path == "/api/market/stock-list":
        q = parse_qs(url.query)
        page = int(q.get("page", [1])[0])
        market = q.get("market", ["kospi"])[0]
        rows = [{"rank": (page-1)*50+i+1, "code": f"{i+1:06d}", "name": f"Fixture {i+1}", "name_ko": None, "sector": "TEST", "close": 1000, "change": 1, "change_pct": 0.1, "marcap": 1000000} for i in range(50)]
        route.fulfill(json={"market": market, "label": "Fixture", "currency": "KRW", "sector": q.get("sector", ["ALL"])[0], "query": "", "sort": "default", "sectors": [], "page": page, "page_size": 50, "total": 150, "total_pages": 3, "generated_at": "2026-10-23", "items": rows})
    else:
        route.fulfill(status=503, json={"detail": "Synthetic test: backend disabled"})

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width in (1280, 390):
        context = browser.new_context(viewport={"width": width, "height": 800}, reduced_motion="reduce")
        context.route("**/api/**", mock)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE + "/tests/scroll-navigation.html")
        page.wait_for_selector("#target")

        def nav(url):
            page.evaluate("url => window.scrollQA.navigate(url)", url)
        def y(): return page.evaluate("scrollY")
        def top(selector): return page.locator(selector).first.evaluate("el => el.getBoundingClientRect().top")

        page.evaluate("scrollTo(0, 1900)")
        nav("/slow")
        page.wait_for_selector("#target")
        page.wait_for_timeout(100)
        check(f"{width}: lazy route starts at top after content commits", y() == 0, y())
        page.evaluate("scrollTo(0, 1450)")
        nav("/desk")
        page.wait_for_timeout(100)
        check(f"{width}: fresh desk never inherits outgoing scroll", y() == 0, y())
        page.evaluate("scrollTo(0, 1700)")
        nav("/other")
        page.wait_for_timeout(80)
        nav("/desk")
        page.wait_for_timeout(80)
        check(f"{width}: menu revisit ignores saved desk position", y() == 0, y())
        page.go_back()
        page.wait_for_timeout(80)
        page.go_back()
        page.wait_for_timeout(100)
        check(f"{width}: back restores correct history entry", abs(y()-1700) < 3, y())
        page.go_forward()
        page.wait_for_timeout(80)
        check(f"{width}: forward restores its own entry", y() == 0, y())

        nav("/desk#target")
        page.wait_for_timeout(100)
        check(f"{width}: hash honors measured fixed header", abs(top("#target")-108) < 3, top("#target"))
        page.mouse.wheel(0, 300)
        page.wait_for_timeout(100)
        manual = y()
        page.evaluate("document.querySelector('#intro').style.height='1100px'")
        page.wait_for_timeout(120)
        check(f"{width}: wheel cancels restoration during layout updates", y() >= manual-2, [manual, y()])
        nav("/desk")
        page.wait_for_timeout(80)
        page.evaluate("scrollTo(0, 2000); window.scrollQA.jumpTo('target')")
        check(f"{width}: section jump clears header", abs(top("#target")-108) < 3, top("#target"))

        # replaceState view parameters belong to the same history entry.
        page.evaluate("history.replaceState(history.state, '', '/desk?view=table'); scrollTo(0, 1250)")
        nav("/other")
        page.wait_for_timeout(80)
        page.go_back()
        page.wait_for_timeout(120)
        check(f"{width}: replaced view URL restores by history entry", abs(y()-1250) < 3, y())

        nav("/reader-news")
        page.wait_for_selector(".rd-list button")
        pager = page.locator(".rd-pager button").last
        pager.click()
        page.wait_for_timeout(80)
        check(f"{width}: news pagination lands at new list start", abs(top(".rd")-108) < 3, top(".rd"))
        page.locator(".rd-list button").last.click()
        page.wait_for_selector(".rd-article")
        check(f"{width}: article opens at start", abs(top(".rd")-108) < 3, top(".rd"))
        page.locator(".rd-steps button").last.click()
        page.wait_for_timeout(100)
        check(f"{width}: next article leaves footer and shows start", abs(top(".rd")-108) < 3, top(".rd"))
        page.locator(".rd-back").click()
        page.wait_for_timeout(80)
        check(f"{width}: back to news list stays at list start", abs(top(".rd")-108) < 3, top(".rd"))

        nav("/reader-talk")
        page.wait_for_selector(".rd-list button")
        page.locator(".rd-pager button").last.click()
        page.wait_for_timeout(350)
        check(f"{width}: async discussion page starts below header", abs(top(".rd")-108) < 3, top(".rd"))
        page.locator(".rd-list button").last.click()
        page.wait_for_selector(".rd-article")
        check(f"{width}: discussion post opens at start", abs(top(".rd")-108) < 3, top(".rd"))

        nav("/map")
        page.wait_for_timeout(100)
        check(f"{width}: map entry aligns actual map area below header", abs(top('[data-scroll-start="map"]')-108) < 3, top('[data-scroll-start="map"]'))
        page.mouse.wheel(0, 250)
        page.wait_for_timeout(100)
        before = y()
        page.evaluate("document.querySelector('[data-scroll-start]').append(document.createElement('span'))")
        page.wait_for_timeout(100)
        check(f"{width}: map updates respect reader scroll", abs(y()-before) < 3, [before,y()])

        nav("/stocks")
        page.wait_for_selector(".st-table tbody tr[data-code]")
        page.get_by_role("button", name="다음 페이지", exact=True).click()
        page.wait_for_timeout(250)
        table_top = top("#st-table")
        check(f"{width}: stock pagination reveals table instead of footer", -2 <= table_top <= 300, table_top)
        check(f"{width}: stock table inner position resets", page.locator("#st-table").evaluate("el => el.scrollTop") == 0)
        check(f"{width}: no uncaught frontend errors", not errors, errors)
        context.close()
    browser.close()
print(json.dumps({"passed": len(results), "results": results}, indent=2))
