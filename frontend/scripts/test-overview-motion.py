"""Chrome checks against new in-memory fixtures; no backend or stored data access."""
import json
import os
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = os.environ.get("OVERVIEW_TEST_URL", "http://127.0.0.1:5191")
OUT = Path(__file__).resolve().parents[2] / "qa" / "overview-motion"
OUT.mkdir(parents=True, exist_ok=True)
counts = Counter()
fixture = {"bitcoin_price": 95000.25}
symbols = ["^GSPC", "^NDX", "KRW=X", "CL=F", "GC=F", "SI=F", "BTC-USD", "XRP-USD"]
prices = [6123.45, 21456.78, 1375.4, 75.12, 2700.5, 32.4, 95000.25, 2.1234]
quotes = [{"symbol": symbol, "label": symbol, "price": price, "change_pct": 1.25,
           "quote_time": 1792540800, "points": [price * (1 + (i % 7 - 3) * .002) for i in range(60)]}
          for symbol, price in zip(symbols, prices)]


def serve(route):
    url = urlparse(route.request.url)
    if not url.path.startswith("/api/"):
        return route.continue_() if route.request.url.startswith(BASE) else route.abort()
    assert route.request.method == "GET"
    counts[url.path] += 1
    if url.path == "/api/market/ticker":
        return route.fulfill(json={"items": [{**quote, "price": fixture["bitcoin_price"]} if quote["symbol"] == "BTC-USD" else quote for quote in quotes]})
    if url.path == "/api/investor/indices":
        return route.fulfill(json={"kospi": {"close": 2745.67, "change_pct": 1.23}, "kosdaq": {"close": 812.34, "change_pct": -.56},
                                   "kospi_investor": {"foreign_amount": 1234, "institution_amount": -567, "individual_amount": -667}})
    if url.path.endswith("/history"):
        return route.fulfill(json={"points": [{"close": 2700 + i + (i % 7) * 6} for i in range(65)]})
    return route.fulfill(status=503, json={"detail": "No fixture for this feed"})


report = {"checks": [], "frames": [], "errors": []}
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
    for width, market, theme in [(1440, "kr", "light"), (1440, "us", "dark"), (390, "kr", "light"), (390, "us", "dark")]:
        fixture["bitcoin_price"] = 95000.25
        context = browser.new_context(viewport={"width": width, "height": 960}, device_scale_factor=1)
        context.route("**/*", serve)
        page = context.new_page()
        page.on("pageerror", lambda error: report["errors"].append(str(error)))
        page.clock.install()
        page.goto(f"{BASE}/tests/fixtures/overview-motion.html?market={market}&theme={theme}")
        page.locator(".ed-market-overview[data-motion=on]").wait_for()
        page.locator('.ed-rolling-number[data-value="$95,000.25"]').wait_for()
        page.wait_for_function("document.querySelectorAll('.ed-overview-trace').length === 7")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, market, "overflow")
        values = page.locator(".ed-rolling-number").evaluate_all("els => els.map(el => el.dataset.value)")
        paths = page.locator(".ed-overview-trace").evaluate_all("els => els.map(el => el.getAttribute('d'))")
        links = page.locator(".ed-overview-quote")
        links.first.focus()
        page.clock.fast_forward(5000)
        assert page.locator(".ed-market-overview").get_attribute("data-motion-cycle") == "1"
        assert page.locator(".ed-reel-strip.is-rolling").count() == 0
        assert links.first.evaluate("el => el === document.activeElement")
        assert page.locator(".ed-rolling-number").evaluate_all("els => els.map(el => el.dataset.value)") == values
        assert page.locator(".ed-overview-trace").evaluate_all("els => els.map(el => el.getAttribute('d'))") == paths
        # The graph beat and an unchanged quote response cannot restart any reel.
        page.clock.fast_forward(5000)
        assert page.locator(".ed-reel-strip.is-rolling").count() == 0
        fixture["bitcoin_price"] = 95001.75
        page.clock.fast_forward(5000)
        changed = page.locator('.ed-rolling-number[data-value="$95,001.75"]')
        changed.wait_for()
        assert changed.locator(".ed-reel-strip.is-rolling").count() > 0
        assert page.locator(".ed-rolling-number").filter(has=page.locator(".ed-reel-strip.is-rolling")).count() == 1
        assert links.first.evaluate("el => el === document.activeElement")
        page.clock.fast_forward(1500)
        page.wait_for_timeout(1400)
        assert page.locator(".ed-reel-strip.is-rolling").count() == 0
        assert page.locator(".ed-reel-strip.is-rolling").evaluate_all("els => els.every(el => el.getAnimations().every(a => a.playState === 'finished'))")
        page.screenshot(path=str(OUT / f"{market}-{width}-{theme}.png"), full_page=False)
        # Offscreen summaries stop the visual timer without remounting links/data.
        page.evaluate("scrollTo(0, 1400)")
        page.locator(".ed-market-overview[data-motion=off]").wait_for()
        before = page.locator(".ed-market-overview").get_attribute("data-motion-cycle")
        page.clock.fast_forward(10000)
        assert page.locator(".ed-market-overview").get_attribute("data-motion-cycle") == before
        page.evaluate("scrollTo(0, 0)")
        page.locator(".ed-market-overview[data-motion=on]").wait_for()
        assert page.locator(".ed-reel-strip.is-rolling").count() == 0
        page.emulate_media(reduced_motion="reduce")
        page.locator(".ed-market-overview[data-motion=off]").wait_for()
        page.clock.fast_forward(10000)
        fixture["bitcoin_price"] = 95002.25
        page.clock.fast_forward(5000)
        page.locator('.ed-rolling-number[data-value="$95,002.25"]').wait_for()
        assert page.locator(".ed-market-overview").get_attribute("data-motion-cycle") == before
        assert page.locator(".ed-reel-strip.is-rolling").count() == 0
        assert page.locator(".ed-overview-trace").evaluate_all("els=>els.every(el=>getComputedStyle(el).animationName==='none')")
        page.emulate_media(reduced_motion="no-preference")
        page.locator(".ed-market-overview[data-motion=on]").wait_for()
        assert page.locator(".ed-reel-strip.is-rolling").count() == 0
        page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))")
        page.locator(".ed-market-overview[data-motion=off]").wait_for()
        page.clock.fast_forward(10000)
        assert page.locator(".ed-market-overview").get_attribute("data-motion-cycle") == before
        report["checks"].append({"width": width, "market": market, "theme": theme, "values": len(values), "graphs": 7,
                                 "graph_replay": True, "unchanged_values_stationary": True, "changed_value_only_rolls": True, "offscreen_paused": True,
                                 "background_paused": True, "reduced_motion": True})
        print(json.dumps(report["checks"][-1]), flush=True)
        context.close()
    # Measure the actual visible animation at the original device scale.
    for width in [1440, 390]:
        context = browser.new_context(viewport={"width": width, "height": 960}, device_scale_factor=1)
        context.route("**/*", serve)
        page = context.new_page()
        page.goto(BASE + "/tests/fixtures/overview-motion.html?market=us")
        page.locator(".ed-market-overview[data-motion=on]").wait_for()
        metrics = page.evaluate("""async () => {
          const deltas=[], bins=new Map(); let previous, start;
          await new Promise(resolve => {
            const frame=now=>{
              if(start===undefined) start=now;
              if(previous!==undefined) deltas.push(now-previous);
              previous=now; const bin=Math.floor((now-start)/1000);
              bins.set(bin,(bins.get(bin)||0)+1);
              if(now-start<7000) requestAnimationFrame(frame); else resolve();
            }; requestAnimationFrame(frame);
          });
          deltas.sort((a,b)=>a-b);
          const fullBins=[...bins.entries()].filter(([bin])=>bin<7).map(([,count])=>count);
          return {p95_ms:deltas[Math.floor(deltas.length*.95)],p99_ms:deltas[Math.floor(deltas.length*.99)],
                  max_ms:deltas.at(-1),minimum_one_second_fps:Math.min(...fullBins),
                  cycles:Number(document.querySelector('.ed-market-overview').dataset.motionCycle)};
        }""")
        report["frames"].append({"width": width, "height": 960, "device_scale_factor": 1, "browser": "Chrome", **metrics})
        print(json.dumps(report["frames"][-1]), flush=True)
        context.close()
    browser.close()
assert not report["errors"], report["errors"]
report["fixture_requests"] = dict(counts)
(OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
