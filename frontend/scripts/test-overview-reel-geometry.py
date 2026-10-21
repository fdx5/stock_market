"""Check complete glyphs throughout roulette frames, with independent API fixtures."""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "qa/overview-reel-fix"
OUT.mkdir(parents=True, exist_ok=True)
fixture_file = Path(__file__).with_name("test-overview-motion.py")
fixtures = {"__file__": str(fixture_file)}
exec(fixture_file.read_text(encoding="utf-8").split("\nreport = {", 1)[0], fixtures)
BASE = os.environ.get("OVERVIEW_TEST_URL", "http://127.0.0.1:5191")
fixtures["BASE"] = BASE
report = {"checks": [], "errors": []}

with sync_playwright() as p:
    for engine in ("webkit", "chrome"):
        browser = p.webkit.launch(headless=True) if engine == "webkit" else p.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
        for width, height, scale, market, zoom in [
            (768, 1024, 2, "kr", 1), (1024, 1366, 2, "us", 1),
            (1366, 1024, 2, "kr", 1), (1024, 1366, 2, "kr", 1.25),
            (390, 844, 3, "us", 1), (1440, 960, 1, "kr", 1),
        ]:
            context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=scale,
                                          is_mobile=width != 1440, has_touch=width != 1440)
            context.route("**/*", fixtures["serve"])
            page = context.new_page()
            page.on("pageerror", lambda error: report["errors"].append(str(error)))
            page.goto(BASE + f"/tests/fixtures/overview-motion.html?market={market}")
            page.locator('.ed-rolling-number[data-value="$95,000.25"]').wait_for()
            page.evaluate("document.fonts.ready")
            page.evaluate("zoom => document.body.style.zoom = zoom", zoom)
            geometry = page.evaluate("""async () => {
                const strips = [...document.querySelectorAll('.ed-reel-strip')];
                strips.forEach(el => el.classList.add('is-rolling'));
                const animations = strips.map(el => el.getAnimations()[0]);
                animations.forEach(animation => animation.pause());
                const failures = [];
                const samples = [0, 37, 143, 287, 430, 681, 959, 1105, 1200];
                for (const time of samples) {
                    animations.forEach(animation => { animation.currentTime = time; });
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    strips.forEach((strip, index) => {
                        const viewport = strip.parentElement.getBoundingClientRect();
                        const cells = [...strip.querySelectorAll('.ed-reel-cell')];
                        const whole = cells.filter(cell => {
                            const rect = cell.getBoundingClientRect();
                            return Math.abs(rect.top - viewport.top) < .5 && Math.abs(rect.bottom - viewport.bottom) < .5;
                        });
                        if (cells.length !== 11 || whole.length !== 1) {
                            failures.push({time, index, issue:'partial digit', whole:whole.length});
                            return;
                        }
                        const range = document.createRange();
                        range.selectNodeContents(whole[0]);
                        const glyph = range.getBoundingClientRect();
                        if (glyph.top < viewport.top - .5 || glyph.bottom > viewport.bottom + .5 ||
                            glyph.left < viewport.left - .5 || glyph.right > viewport.right + .5)
                            failures.push({time, index, issue:'clipped glyph'});
                        if (getComputedStyle(whole[0]).fontSize !== getComputedStyle(strip.parentElement).fontSize)
                            failures.push({time, index, issue:'font size mismatch'});
                    });
                }
                // Capture an intermediate frame; every digit must still be whole.
                animations.forEach(animation => { animation.currentTime = 430; });
                return {digits:strips.length, frames:samples.length, failures};
            }""")
            assert not geometry["failures"], (engine, width, zoom, geometry["failures"][:10])
            page.locator(".ed-market-overview").screenshot(path=str(OUT / f"{engine}-{width}-{market}-{zoom}.png"))
            report["checks"].append({"engine": engine, "width": width, "height": height, "device_scale_factor": scale,
                                     "market": market, "zoom": zoom, **geometry})
            print(json.dumps(report["checks"][-1]), flush=True)
            context.close()
        browser.close()
assert not report["errors"], report["errors"]
(OUT / "geometry-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
