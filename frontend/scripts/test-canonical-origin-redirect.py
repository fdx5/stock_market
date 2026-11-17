"""Browser navigation checks without app startup, API traffic, or stored data."""
import argparse
import json
import pathlib
import re
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--html", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / "index.html")
parser.add_argument("--live", action="store_true")
args = parser.parse_args()
if args.live:
    with urlopen("https://kospi-predictor.onrender.com/", timeout=30) as response:
        html = response.read().decode("utf-8")
else:
    html = args.html.read_text(encoding="utf-8")
guard = re.search(r'<script id="canonical-origin-redirect">([\s\S]*?)</script>', html)
assert guard, "Canonical navigation guard missing from HTML"
assert html.index(guard.group(0)) < html.index('pagead2.googlesyndication.com')
fixture = '<!doctype html><html><head>' + guard.group(0) + '</head><body>Ready</body></html>'

cases = [
    ("https://kospi-predictor.onrender.com/", "https://kospimap.com/"),
    ("https://kospi-predictor.onrender.com/map?bg=silk&symbol=A%26B#section", "https://kospimap.com/map?bg=silk&symbol=A%26B#section"),
    ("https://kospi-predictor.onrender.com/nasdaq100-map?lang=en", "https://kospimap.com/nasdaq100-map?lang=en"),
    ("http://kospi-predictor.onrender.com:8000/global", "https://kospimap.com/global"),
    ("https://kospimap.com/map?bg=silk#section", "https://kospimap.com/map?bg=silk#section"),
    ("http://localhost:5201/map", "http://localhost:5201/map"),
    ("https://kospi-predictor.onrender.com.example.org/", "https://kospi-predictor.onrender.com.example.org/"),
]
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
    for start, expected in cases:
        page = browser.new_page()
        navigations = []
        # Serve identical origin HTML at both hosts to simulate the public proxy.
        def serve(route):
            if route.request.is_navigation_request():
                navigations.append(route.request.url)
                assert len(navigations) <= 2, navigations
                route.fulfill(content_type="text/html", body=fixture)
            else:
                route.abort()
        page.route("**/*", serve)
        page.goto(start, wait_until="commit")
        page.wait_for_url(expected)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(150)
        assert page.url == expected, (page.url, expected)
        assert len(navigations) == (2 if start != expected else 1), navigations
        assert page.evaluate("history.length") == 2, "Redirect must replace the legacy history entry"
        print(json.dumps({"start": start, "destination": page.url, "navigations": len(navigations)}), flush=True)
        page.close()
    if args.live:
        for path in ("/", "/map?bg=silk#clock"):
            page = browser.new_page()
            documents = []
            def live_route(route):
                if route.request.is_navigation_request():
                    documents.append(route.request.url)
                    assert len(documents) <= 2, documents
                    route.continue_()
                else:
                    route.abort()
            page.route("**/*", live_route)
            page.goto("https://kospi-predictor.onrender.com" + path, wait_until="commit")
            page.wait_for_url("https://kospimap.com" + path, timeout=30000)
            page.wait_for_load_state("domcontentloaded")
            assert len(documents) == 2, documents
            print(json.dumps({"live_destination": page.url, "navigations": len(documents)}), flush=True)
            page.close()
    browser.close()
