"""Geometry and touch checks for the built app; API requests use empty fixtures."""
import argparse
import json
import pathlib
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5201")
parser.add_argument("--output", required=True)
args = parser.parse_args()
folder = pathlib.Path(args.output)
folder.mkdir(parents=True, exist_ok=True)
host = urlsplit(args.base_url).hostname
results = []

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
    for width, lang, tone, path in ((320, "en", "dark", "/map"), (390, "ko", "dark", "/map"),
                                   (430, "en", "light", "/global"), (767, "ko", "light", "/sp500-map")):
        page = browser.new_page(viewport={"width": width, "height": 844})
        page.add_init_script(f"localStorage.setItem('site_lang','{lang}');localStorage.setItem('kospimap_tone','{tone}');")
        def route(request):
            url = urlsplit(request.request.url)
            if url.hostname != host:
                request.abort()
            elif url.path.startswith("/api/"):
                request.fulfill(status=503, json={})
            else:
                request.continue_()
        page.route("**/*", route)
        page.goto(args.base_url + path + "?bg=nanotube", wait_until="domcontentloaded")
        header = page.locator(".ng-header")
        header.wait_for(timeout=20000)
        geometry = header.evaluate("""e=>{
          const rect=s=>e.querySelector(s).getBoundingClientRect().toJSON();
          return {header:e.getBoundingClientRect().toJSON(), menu:rect('.ng-phone-menu-toggle'),
            logo:rect('.ng-brand'), search:rect('.ng-search-trigger'), tools:rect('.ng-header-tools'),
            clocks:rect('.ng-header-clocks'), times:[...e.querySelectorAll('.ng-header-clock')].map(n=>n.getBoundingClientRect().toJSON()),
            clockFits:[...e.querySelectorAll('.ng-header-clock')].every(n=>n.scrollWidth<=n.clientWidth+1),
            rail:document.querySelector('.ng-top-rail').getBoundingClientRect().toJSON(), rows:getComputedStyle(e).gridTemplateRows};
        }""")
        bounds = geometry["header"]
        assert bounds["height"] == 90 and len(geometry["rows"].split()) == 2, geometry
        for key in ("menu", "logo", "search", "tools", "clocks"):
            child = geometry[key]
            assert child["top"] >= bounds["top"] and child["bottom"] <= bounds["bottom"], (key, geometry)
        assert geometry["menu"]["width"] >= 44 and geometry["menu"]["height"] >= 44
        assert geometry["menu"]["y"] == geometry["clocks"]["y"], geometry
        assert geometry["menu"]["right"] <= geometry["clocks"]["left"], geometry
        assert geometry["times"][0]["right"] <= geometry["times"][1]["left"] and geometry["clockFits"], geometry
        assert geometry["rail"]["top"] >= bounds["bottom"] - 1, geometry
        page.screenshot(path=str(folder / f"header-{width}-{lang}-{tone}.png"), clip={"x": 0, "y": 0, "width": width, "height": 210})
        page.locator(".ng-phone-menu-toggle").click()
        page.locator("#neo-navigation-menu").wait_for()
        page.keyboard.press("Escape")
        assert not page.locator("#neo-navigation-menu").count()
        page.set_viewport_size({"width": width, "height": 620})
        assert page.locator(".ng-brand").bounding_box()["y"] >= 0
        result = {"width": width, "lang": lang, "tone": tone, "path": path, "layout": geometry}
        results.append(result)
        print(json.dumps({"width": width, "path": path, "two_rows": True, "header_height": bounds["height"], "controls_inside": True}), flush=True)
        page.close()
    browser.close()
(folder / "layout.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
