"""Browser regression against a built frontend; every API is an in-memory fixture."""
import asyncio
import json
import sys
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright


async def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5196"
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--mute-audio"])
        for width in (1280, 390):
            for path, endpoint, is_us in (
                ("/map", "map", False), ("/kosdaq-map", "kosdaq-map", False),
                ("/sp500-map", "sp500-map", True), ("/nasdaq100-map", "nasdaq100-map", True),
            ):
                context = await browser.new_context(viewport={"width": width, "height": 850}, reduced_motion="reduce")
                replies = []
                code = "AAPL" if is_us else "005380"

                async def mock(route):
                    url = urlparse(route.request.url)
                    if url.path == f"/api/market/{endpoint}":
                        limit = int(parse_qs(url.query).get("limit", [500])[0])
                        stale_full = not is_us and limit > 50
                        if stale_full:
                            await asyncio.sleep(0.5)  # Old full reply arrives after fresh partials.
                        items = [{"code": code, "name": "Fixture", "sector": "Technology", "marcap": 100,
                                  "close": 287500, "change": 10000, "change_pct": 2.88 if stale_full else 3.60,
                                  "quote_time": 100 if stale_full else 200, "session": "post" if is_us else "regular"}]
                        if stale_full:
                            items.append({**items[0], "code": "005930", "name": "Tail", "marcap": 10, "change_pct": 1})
                        replies.append(limit)
                        return await route.fulfill(json={"items": items, "count": len(items), "session": "post" if is_us else None,
                                                         "generated_at": "2026-11-04T20:00:00+09:00"})
                    if url.path == "/api/geo/country":
                        return await route.fulfill(json={"country": "KR"})
                    return await route.fulfill(status=503, json={"detail": "fixture backend disabled"})

                await context.route("**/api/**", mock)
                page = await context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                await page.goto(base + path, wait_until="domcontentloaded")
                tile = page.locator(f'.kospi-map-tile[aria-label*="{code}"]')
                await tile.wait_for()
                await page.wait_for_timeout(900)
                assert "+3.60%" in await tile.inner_text(), (path, await tile.inner_text())
                if not is_us:
                    assert any(n > 50 for n in replies), replies
                    assert await page.locator('.kospi-map-tile[aria-label*="005930"]').count() == 1
                assert not errors, errors
                print(json.dumps({"path": path, "width": width, "display": await tile.inner_text(), "requests": replies}), flush=True)
                await context.close()
        await browser.close()


asyncio.run(main())
