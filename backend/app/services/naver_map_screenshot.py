"""Screenshots the live KOSPI MAP page for the promo block every Naver blog post ends
with (see naver_document_model.build_body_components / naver_publisher.run).

A treemap is not worth reimplementing in PIL the way naver_brief_charts draws its bar
charts — the live page already renders it, so Playwright captures exactly what a reader
clicking the accompanying link would land on. One capture is taken per publish run and
reused across every market in that run (see naver_publisher.run): the map does not move
meaningfully inside the run's ~10-20 minute window, and launching a browser seven times
just to re-screenshot the same page would be pure waste.

Best-effort, like every other chart in this feature: a capture failure costs the post its
map image, never its publication (naver_document_model still always emits the link text).
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

from app.site import PRIMARY_SITE_URL

SITE_URL = PRIMARY_SITE_URL
MAP_URL = f"{SITE_URL}/map"

# The treemap grid itself (frontend/src/components/MarketMapPage.tsx), not the page
# around it — cropping to this element skips the nav rail, legend controls and any
# popovers so the image is just the map.
MAP_SELECTOR = ".kospi-map-canvas"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


def capture(url: str = MAP_URL, selector: str = MAP_SELECTOR) -> bytes | None:
    """Returns a PNG of the live treemap, or None on any failure."""
    from playwright.sync_api import sync_playwright

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                context = browser.new_context(
                    viewport={"width": 1280, "height": 900},
                    user_agent=USER_AGENT,
                    locale="ko-KR",
                    timezone_id="Asia/Seoul",
                )
                page = context.new_page()
                page.goto(url, wait_until="networkidle", timeout=30000)
                page.wait_for_selector(selector, timeout=15000)
                # Tiles animate in on load; a fixed settle beats guessing which
                # network response corresponds to "done rendering".
                page.wait_for_timeout(1200)
                return page.locator(selector).first.screenshot(type="png")
            finally:
                browser.close()
    except Exception:
        log.exception("kospi map screenshot failed")
        return None
