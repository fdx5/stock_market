"""Fresh browser profiles: English, modal keyboard traps, print and unavailable feeds."""
import datetime as dt, json, os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
base=os.environ.get('NEO_TEST_URL','http://127.0.0.1:5521')
out=Path(__file__).resolve().parents[2]/'qa'/('neo-accessibility-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
out.mkdir(parents=True)
report=[]
with sync_playwright() as p:
  for engine in ('chrome','webkit'):
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']) if engine=='chrome' else p.webkit.launch(headless=True)
    for width in (390,1440):
      context=browser.new_context(viewport={'width':width,'height':1000})
      context.add_init_script("localStorage.setItem('site_lang','en')")
      def network(route):
        path=urlsplit(route.request.url).path
        if path.startswith('/api/') and (route.request.method!='GET' or any(x in path for x in ('/activity','/tracking','/visitors/'))):return route.fulfill(json={})
        route.continue_()
      context.route('**/*',network)
      page=context.new_page()
      page.goto(base+'/desk',wait_until='domcontentloaded');page.locator('.ng-header').wait_for()
      trigger=page.locator('.ng-header-tools button[aria-label="Display settings"]')
      trigger.click();dialog=page.locator('.ng-dialog-settings');dialog.wait_for()
      first=dialog.locator('button').first;last=dialog.locator('button').last
      first.focus();page.keyboard.press('Shift+Tab');assert last.evaluate('e=>e===document.activeElement')
      page.keyboard.press('Tab');assert first.evaluate('e=>e===document.activeElement')
      page.keyboard.press('Escape');assert trigger.evaluate('e=>e===document.activeElement')
      page.keyboard.press('/');dialog=page.locator('.d2-find');dialog.wait_for()
      first=dialog.locator('input').first;last=dialog.locator('button').last
      first.focus();page.keyboard.press('Shift+Tab');assert last.evaluate('e=>e===document.activeElement')
      page.keyboard.press('Tab');assert first.evaluate('e=>e===document.activeElement');page.keyboard.press('Escape')
      assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
      page.screenshot(path=str(out/f'{engine}-{width}-english.png'))
      page.emulate_media(reduced_motion='reduce')
      assert page.locator('.ed-overview-trace').first.evaluate('e=>parseFloat(getComputedStyle(e).animationDuration)<=0.01')
      page.goto(base+'/market-brief',wait_until='domcontentloaded');page.wait_for_timeout(1600)
      page.emulate_media(media='print');assert not page.locator('.ng-header').is_visible();assert not page.locator('.ng-mobile-nav').is_visible()
      page.screenshot(path=str(out/f'{engine}-{width}-print.png'))
      report.append({'engine':engine,'width':width,'english':True,'focus_traps':True,'print_shell':True,'reduced_motion':True})
      context.close()
    context=browser.new_context(viewport={'width':390,'height':1000})
    context.add_init_script("localStorage.setItem('site_lang','ko')")
    context.route('**/*',lambda route:route.fulfill(status=503,json={'detail':'Independent unavailable-feed fixture'}) if urlsplit(route.request.url).path.startswith('/api/') else route.continue_())
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/desk',wait_until='domcontentloaded')
    page.wait_for_function("document.querySelector('.ng-index-chart .ng-empty') && document.querySelector('.ed-overview-quote strong .ed-rolling-number')?.dataset.value==='—'")
    assert not errors,errors
    page.screenshot(path=str(out/f'{engine}-unavailable.png'))
    report.append({'engine':engine,'unavailable':'dash and empty chart','page_errors':errors})
    context.close();browser.close()
with (out/'result.json').open('x',encoding='utf-8') as handle:json.dump(report,handle,ensure_ascii=False,indent=2)
print(json.dumps({'checks':report,'output':str(out)},ensure_ascii=False),flush=True)
