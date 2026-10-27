"""Five-second refresh and both cell effects, using browser-only API fixtures."""
import json
import sys
import time
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5196"
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--mute-audio"])
    for width, height, dpr in [(1440, 1000, 1), (390, 844, 2)]:
        changed_count = 10
        requests = {key: [] for key in ["map", "kosdaq-map", "nasdaq100-map"]}
        context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=dpr)

        def mock(route):
            parsed = urlparse(route.request.url)
            if not parsed.path.startswith("/api/"):
                return route.continue_()
            key = parsed.path.rsplit("/", 1)[-1]
            if key not in requests:
                return route.fulfill(status=503, json={"detail": "browser fixture"})
            assert parse_qs(parsed.query)["fresh"] == ["true"]
            requests[key].append(time.monotonic())
            revision = min(len(requests[key]) - 1, 1)
            items = [{"code": f"{i:06}", "name": f"Fixture {i}", "sector": "Test", "marcap": 1e12-i*1e9,
                      "close": 100+i+(revision if i <= changed_count else 0), "change_pct": i/10,
                      "volume": 1000, "turnover": 1e8} for i in range(1, 61)]
            return route.fulfill(json={"generated_at": f"2026-10-28T08:00:{len(requests[key]):02}Z", "items": items})

        context.route("**/api/**", mock)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base, wait_until="domcontentloaded")
        try:
            page.locator(".sc-stock").first.wait_for(timeout=10000)
        except Exception:
            print(json.dumps({"errors": errors, "requests": requests, "body": page.locator(".sc-scanner").inner_text()}), flush=True)
            raise
        page.locator(".sc-grid").scroll_into_view_if_needed()
        changed_count = min(10, page.locator(".sc-stock").count() - 2)
        animations = """() => document.querySelector('.sc-grid').getAnimations({subtree:true})
          .filter(a=>a.playState==='running').map(a=>({id:a.id,code:a.effect.target.dataset.code,delay:a.effect.getTiming().delay}))"""
        assert not [a for a in page.evaluate(animations) if a["id"] in ("scanner-change-flash", "scanner-refresh-glow")]
        # The second response changes ten cells, more than the former random cap.
        page.wait_for_function("""count => document.querySelector('.sc-grid').getAnimations({subtree:true})
          .filter(a=>a.id==='scanner-change-flash'&&a.playState==='running').length===count""", arg=changed_count, timeout=14000)
        active = page.evaluate(animations)
        changed = [a for a in active if a["id"] == "scanner-change-flash"]
        random = [a for a in active if a["id"] == "scanner-refresh-glow"]
        assert {a["code"] for a in changed} == {f"{i:06}" for i in range(1, changed_count+1)}
        assert all(a["delay"] == 0 for a in changed)
        assert random and not ({a["code"] for a in random} & {a["code"] for a in changed})
        # Unchanged responses retain the independent random heartbeat.
        page.wait_for_timeout(2200)
        page.wait_for_function("""() => document.querySelector('.sc-grid').getAnimations({subtree:true})
          .some(a=>a.id==='scanner-refresh-glow'&&a.playState==='running')""", timeout=8000)
        assert not [a for a in page.evaluate(animations) if a["id"] == "scanner-change-flash"]
        for stamps in requests.values():
            assert len(stamps) >= 3
            assert 4.3 <= stamps[2]-stamps[1] <= 5.7, stamps
        page.emulate_media(reduced_motion="reduce")
        page.wait_for_function("""() => !document.querySelector('.sc-grid').getAnimations({subtree:true})
          .some(a=>['scanner-change-flash','scanner-refresh-glow'].includes(a.id)&&a.playState==='running')""")
        assert not errors, errors
        print(json.dumps({"width": width, "dpr": dpr, "changed": len(changed), "random": len(random),
                          "intervalSeconds": round(requests["map"][2]-requests["map"][1], 3), "errors": errors}), flush=True)
        context.close()
    browser.close()
