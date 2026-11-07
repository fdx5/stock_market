"""Offline browser QA. All API requests use synthetic responses; no database access."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
import json
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:5196"
OUT = Path(__file__).resolve().parents[2] / "tmp/community-pulse-qa"
OUT.mkdir(parents=True, exist_ok=True)
boards = ["kr", "global", "property"]
titles = {
    "kr": "반도체 수급에 쏠린 시선, 오늘 국내 증시에서 주목할 변화",
    "global": "미국 기술주와 국채금리, 글로벌 투자자들이 나눈 이야기",
    "property": "서울 아파트 거래와 전세 흐름, 우리 동네의 새로운 소식",
}
def posts(board):
    return [{"id": f"{board}-{i}", "title": f"{i+1:02d} · {titles[board]}", "source": "공개 커뮤니티", "url": f"https://example.com/{board}/{i}", "published_at": f"2026-11-07T03:{59-i:02d}:00Z"} for i in range(12)]

def route(request, broken=None):
    url = urlparse(request.request.url)
    if url.path.startswith("/api/"):
        if url.path.startswith("/api/community/"):
            board = url.path.split("/")[-1]
            if board == broken: return request.fulfill(status=503, json={})
            return request.fulfill(json={"items": posts(board), "recent_hour_count": 12, "refreshing": False})
        if url.path in ["/api/market/map", "/api/market/kosdaq-map", "/api/market/nasdaq100-map"]:
            change = -1 if "kosdaq" in url.path else 1 if "nasdaq" in url.path else 0
            return request.fulfill(json={"items": [{"code": str(i), "name": f"Stock {i}", "marcap": 100, "close": 100, "change_pct": change, "quote_time": 1794010000} for i in range(60)], "generated_at": "2026-11-07T03:00:00Z"})
        return request.fulfill(status=503, json={})
    if url.hostname not in {"localhost", "127.0.0.1", "kospimap.com"}: return request.abort()
    return request.continue_()

def context(browser, lang="ko", reduced="no-preference", broken=None):
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion=reduced)
    ctx.add_init_script(f"localStorage.setItem('site_lang','{lang}')")
    ctx.route("**/*", lambda r: route(r, broken))
    return ctx

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
    ctx = context(browser)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    instant = datetime(2026, 11, 7, 4, tzinfo=timezone.utc)
    page.clock.install(time=instant)
    page.clock.pause_at(instant + timedelta(seconds=1))
    page.goto(BASE + "/tests/fixtures/community-pulse.html", wait_until="domcontentloaded")
    expect(page.locator(".ng-headline-story")).to_have_count(3)
    expect(page.locator('.ng-headline-freshness').first).to_have_text('최근 1시간 12건')
    expect(page.locator(".ng-headlines")).to_have_attribute("data-running", "true")
    expect(page.locator(".ng-fg-score").first).to_contain_text("50")
    counters = page.locator(".ng-headline-count b")
    for n in range(11):
        assert counters.all_text_contents() == [f"{n%10+1:02d}"] * 3
        for board in boards:
            link = page.locator(f'[data-board="{board}"] .ng-headline-story')
            assert link.get_attribute("href") == f"/community/{board}?post_id={board}-{n%10}"
        page.clock.run_for(1500)
    # The transition starts below and moves upwards, rather than swapping text.
    page.clock.run_for(160)
    page.evaluate("""document.getAnimations().forEach(a => {
      if (['ng-headline-rise','ng-headline-lift'].includes(a.animationName)) { a.pause(); a.currentTime = 160; }
    })""")
    incoming_y = page.locator(".is-incoming").first.evaluate("el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42")
    outgoing_y = page.locator(".is-outgoing").first.evaluate("el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42")
    assert incoming_y > 0 and outgoing_y < 0, (incoming_y, outgoing_y)
    page.locator("main.ng-atlas").screenshot(path=str(OUT / "transition-160ms.png"))
    # Reading or focusing a headline freezes both title and destination.
    story = page.locator(".ng-headline-story").first
    story.hover()
    expect(page.locator(".ng-headlines")).to_have_attribute("data-running", "false")
    current = story.get_attribute("href")
    page.clock.run_for(3000)
    assert story.get_attribute("href") == current
    ctx.route("https://example.com/**", lambda r: r.fulfill(content_type="text/html", body="<title>Original post</title>"))
    story.click()
    assert len(ctx.pages) == 1
    assert urlparse(page.url).path == '/community/kr'
    page.evaluate('history.back()')
    page.wait_for_url('**/tests/fixtures/community-pulse.html')
    page.mouse.move(0, 0)
    story.focus()
    page.clock.run_for(3000)
    assert story.get_attribute("href") == current
    page.evaluate("document.activeElement.blur()")
    pause = page.locator(".ng-headlines-controls button").first
    pause.click()
    page.mouse.move(0, 0); page.evaluate("document.activeElement.blur()")
    page.clock.run_for(2000)
    assert story.get_attribute("href") == current
    page.locator(".ng-headlines-controls button").last.click()
    assert story.get_attribute("href") != current
    # Pause keeps screenshots stable while checking every responsive breakpoint.
    metrics = {}
    for width in [1440, 1024, 850, 768, 599, 390, 320]:
        page.set_viewport_size({"width": width, "height": 1000})
        page.clock.run_for(600)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), width
        assert page.locator(".ng-headline-story").count() == 3
        metrics[str(width)] = {"headlines": page.locator(".ng-headlines").bounding_box()["height"], "sentiment": page.locator(".ng-fear-greed").bounding_box()["height"]}
        if width in [1440, 390, 320]: page.locator("main.ng-atlas").screenshot(path=str(OUT / f"compact-{width}.png"), animations="disabled")
    assert not errors, errors
    retained = page.locator('[data-board="global"] .ng-headline-story').get_attribute("href")
    ctx.route("**/api/community/global?**", lambda r: r.fulfill(status=503, json={}))
    page.clock.run_for(61_000)
    expect(page.locator('[data-board="global"] .ng-headline-delayed')).to_be_visible()
    assert page.locator('[data-board="global"] .ng-headline-story').get_attribute("href") == retained
    print("PASS: 10-post wraparound, 1.5-second cadence, internal URLs, hover/focus pause, manual advance, 7 viewports", flush=True)
    ctx.close()

    ctx = context(browser, reduced="reduce")
    page = ctx.new_page(); page.goto(BASE + "/tests/fixtures/community-pulse.html", wait_until="domcontentloaded")
    expect(page.locator(".ng-headline-story")).to_have_count(3)
    expect(page.locator(".ng-headlines-controls button").first).to_have_attribute("aria-pressed", "true")
    assert page.locator(".ng-headlines").get_attribute("data-running") == "false"
    ctx.close()
    ctx = context(browser, lang="en", broken="global")
    page = ctx.new_page(); page.goto(BASE + "/tests/fixtures/community-pulse.html", wait_until="domcontentloaded")
    expect(page.locator(".ng-headline-story")).to_have_count(2)
    expect(page.locator('[data-board="global"] .ng-headline-empty')).to_contain_text("unavailable")
    for width in [1440, 390, 320]:
        page.set_viewport_size({"width": width, "height": 1000})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), ("en", width)
    ctx.close()
    print("PASS: reduced-motion default and independent board failure", flush=True)
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    browser.close()
print(OUT)
