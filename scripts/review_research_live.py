"""Visual local review using real public data, isolated from application DB startup."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tmp" / "local-discovery-preview" / "live-screens"
OUT.mkdir(parents=True, exist_ok=True)
PAGES = ["/markets", "/market-inside", "/stock-context", "/etf-overlap", "/event-collision", "/yield-curve-lab", "/crypto-liquidity", "/fundamental-gap", "/stock/005930", "/etf", "/news", "/global"]
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width":1560,"height":1000},reduced_motion="reduce")
    errors=[]; failed=[]; results=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.on("response",lambda r:failed.append({"url":r.url,"status":r.status}) if '/api/' in r.url and r.status >=400 else None)
    for path in PAGES:
        page.goto("http://127.0.0.1:5184"+path,wait_until="domcontentloaded")
        page.locator("main").first.wait_for(timeout=20000)
        page.wait_for_timeout(1800 if path!='/markets' else 4000)
        # Deferred charts start only when visible, as they do while a reader scrolls.
        for chart in page.locator(".market-chart").all():
            if chart.is_visible():
                chart.scroll_into_view_if_needed();page.wait_for_timeout(600)
        page.evaluate("scrollTo(0,0)");page.wait_for_timeout(250)
        shot=OUT/(path.strip('/').replace('/','-')+'-live.png')
        page.screenshot(path=str(shot),full_page=True)
        results.append({"path":path,"heading":page.locator("h1").first.inner_text() if page.locator('h1').count() else None,"source_panels":page.locator('.rs-source').all_text_contents(),"overflow":page.evaluate('document.documentElement.scrollWidth>innerWidth')})
        print(path,'reviewed',flush=True)
    (OUT/'result.json').write_text(json.dumps({"pages":results,"javascript_errors":errors,"failed_api":failed,"data":"real public APIs; no mock routes"},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({"reviewed":len(results),"javascript_errors":errors,"failed_api":failed},ensure_ascii=False))
    browser.close()
