"""Exercise the real four map routes with synthetic data and no backend writes."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5199"
screenshots = Path(sys.argv[2]) if len(sys.argv) > 2 else None
if screenshots:
    screenshots.mkdir(parents=True, exist_ok=True)


def mock(route):
    path = urlparse(route.request.url).path
    if path in ["/api/market/map", "/api/market/kosdaq-map", "/api/market/sp500-map", "/api/market/nasdaq100-map"]:
        items = [{"code": str(i + 1).zfill(6), "name": f"Company {i + 1}",
                  "sector": ["Information Technology", "Financials", "Industrials"][i % 3],
                  "marcap": (30 - i) * 100000000, "close": 1000 + i,
                  "change": i - 10, "change_pct": (i - 10) / 3} for i in range(24)]
        return route.fulfill(json={"generated_at": "2026-11-09T10:00:00", "count": len(items), "items": items})
    if path == "/api/geo/country":
        return route.fulfill(json={"country": "KR"})
    if path == "/api/market/returns":
        return route.fulfill(json={"items": []})
    return route.fulfill(status=503, json={"detail": "Synthetic test: backend disabled"})


geometry_js = """() => {
  const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
  const canvas = document.querySelector('.kospi-map-canvas');
  return {page:box('.kospi-map-page'),canvas:box('.kospi-map-canvas'),
    close:box('.ng-map-expand-button'),filter:box('.kospi-map-sector-filter'),
    controls:[...document.querySelectorAll('.kospi-map-period-options label')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}),
    tiles:canvas.querySelectorAll('.kospi-map-tile').length,
    hit:canvas.contains(document.elementFromPoint(innerWidth / 2, innerHeight - 24)),
    activeInside:document.querySelector('.kospi-map-workspace').contains(document.activeElement)};
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", args=["--mute-audio"])
    for width, height in [(1440, 900), (390, 844), (844, 390), (320, 568)]:
        for path in ["/map", "/kosdaq-map", "/sp500-map", "/nasdaq100-map"]:
            context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
            context.route("**/api/**", mock)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + path, wait_until="domcontentloaded")
            page.wait_for_selector('.kospi-map-tile')
            page.wait_for_timeout(1000)
            # Entry stays in the page layout; only the Expand button opens the window-filling view.
            assert page.locator('[role="dialog"]').count() == 0 and page.locator('[inert]').count() == 0, (path, width)
            assert page.evaluate("document.body.style.overflow") != 'hidden'
            page.locator('.kospi-map-sector-filter select').select_option("Financials")
            page.locator('.ng-map-expand-button').scroll_into_view_if_needed()
            before_y = page.evaluate("scrollY")
            page.locator('.ng-map-expand-button').click()
            page.wait_for_selector('[role="dialog"][aria-modal="true"]')
            page.wait_for_timeout(250)
            g = page.evaluate(geometry_js)
            assert g['page'] == {"x": 0, "y": 0, "w": width, "h": height}, (path, width, g)
            assert g['tiles'] == 8 and g['hit'] and g['activeInside'], (path, width, g)
            assert g['canvas']['h'] > height * .55, (path, width, g)
            assert g['close']['x'] < g['filter']['x'], (path, width, g)
            for box in [g['canvas'], g['close'], g['filter'], *g['controls']]:
                assert box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['w'] <= width + 1 and box['y'] + box['h'] <= height + 1, (path, width, box, g)
            assert page.locator('.app-header-trailing').is_hidden()
            assert page.locator('.recent-dock').is_hidden()
            assert page.locator('.kospi-map-sector-filter select').input_value() == "Financials"
            page.locator('input[name="map-period"][value="w1"]').check()
            assert page.locator('input[value="w1"]').is_checked()
            # Resize while expanded: the map should fill the new available space.
            page.set_viewport_size({"width": width + 80, "height": height + 60})
            page.wait_for_timeout(200)
            resized = page.evaluate(geometry_js)
            assert resized['page']['w'] == width + 80 and resized['page']['h'] == height + 60
            page.set_viewport_size({"width": width, "height": height})
            # Keyboard focus stays in the workspace.
            page.locator('.kospi-map-sector-filter select').focus()
            page.keyboard.press('Tab')
            assert page.locator('.kospi-map-workspace').evaluate('(el)=>el.contains(document.activeElement)')
            if screenshots and path == '/map':
                page.screenshot(path=str(screenshots / f"expanded-{width}x{height}.png"))
            page.locator('.ng-map-expand-button').click()
            page.wait_for_timeout(250)
            assert page.locator('[role="dialog"]').count() == 0
            assert page.locator('.app-header-trailing').is_visible()
            assert page.locator('.kospi-map-sector-filter select').input_value() == "Financials"
            assert page.locator('input[value="w1"]').is_checked()
            assert abs(page.evaluate('scrollY') - before_y) < 3
            assert page.evaluate("document.body.style.overflow") != 'hidden'
            assert page.locator('[inert]').count() == 0
            # Expanding from the table temporarily shows the map and restores the table.
            page.get_by_role('button', name='표로 보기', exact=True).click()
            page.locator('.ng-map-expand-button').click()
            page.wait_for_selector('.kospi-map-canvas')
            page.keyboard.press('Escape')
            page.wait_for_selector('.kospi-map-table')
            assert page.locator('.kospi-map-canvas').count() == 0
            assert page.locator('[inert]').count() == 0
            assert not errors, (path, width, errors)
            print('PASS', path, width, height, json.dumps(g), flush=True)
            context.close()
    browser.close()
