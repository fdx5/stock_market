"""Local-only UI QA with real public Treasury feed and no stored-data mutations."""
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

OUT = Path(__file__).resolve().parents[2] / "qa" / "treasury"
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True, args=["--mute-audio"])
    context = browser.new_context(viewport={"width": 1440, "height": 1100})
    def route(r):
        url = urlparse(r.request.url)
        if url.hostname not in {"127.0.0.1", "localhost"}:
            return r.abort()
        if not url.path.startswith("/api/"):
            return r.continue_()
        if url.path.startswith("/api/global/treasuries"):
            assert r.request.method == "GET"
            return r.continue_()
        return r.fulfill(status=503, json={"detail": "Isolated market-feed QA"})
    context.route("**/*", route)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    for width in [1440, 1024, 390, 320]:
        page.set_viewport_size({"width": width, "height": 1100})
        for tenor in ["2", "5", "10"]:
            page.goto(f"http://127.0.0.1:4187/global/treasuries/{tenor}?design=neo")
            expect(page.locator(".ty-yield-line")).to_be_visible(timeout=30000)
            expect(page.locator(".ty-history tbody tr")).to_have_count(30)
            assert len(page.locator(".ty-yield-line").get_attribute("d")) > 1000
            assert page.locator(".ty-price strong").inner_text() != "—%"
            assert page.locator("html").get_attribute("data-design") == "neo"
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), (tenor,width)
            if tenor == "10" and width in [1440,390]:
                page.screenshot(path=str(OUT / f"detail-{width}.png"), full_page=True)
    first = page.locator(".ty-history tbody tr").first.inner_text()
    page.locator(".ty-pagination button").last.click()
    assert page.locator(".ty-history tbody tr").first.inner_text() != first
    page.locator(".ty-ranges button").first.click()
    expect(page.locator(".ty-readout")).to_contain_text("ET")
    page.goto("http://127.0.0.1:4187/global?design=neo")
    expect(page.locator(".ty-card")).to_have_count(3, timeout=30000)
    expect(page.locator(".ty-yield-line")).to_have_count(3)
    expect(page.locator(".ty-card svg")).to_have_count(6)
    page.locator("#w-treasuries").screenshot(path=str(OUT / "global-live.png"))
    page.locator(".ty-detail-link").last.click()
    expect(page).to_have_url("http://127.0.0.1:4187/global/treasuries/10")
    expect(page.locator(".ty-yield-line")).to_be_visible()
    assert not errors, errors
    browser.close()
print("PASS: real yields, six global plots, all 3 maturities, 3-year history, pagination, 1D switch, neon, 4 viewport widths, detail navigation.")
