"""Frame beam lifecycle, reduced motion and search-icon containment."""
import json, os
from playwright.sync_api import sync_playwright
from urllib.parse import urlsplit
base=os.getenv('NEO_TEST_URL','http://127.0.0.1:5521')
with sync_playwright() as p:
  for engine in ('chrome','webkit'):
    b=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']) if engine=='chrome' else p.webkit.launch(headless=True)
    c=b.new_context(viewport={'width':1440,'height':1000});c.add_init_script("localStorage.setItem('site_lang','en')")
    c.route('**/*',lambda r:r.fulfill(status=503,json={}) if urlsplit(r.request.url).path.startswith('/api/') else r.continue_())
    page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/');beam=page.locator('.ng-header>.ng-frame-layer .ng-frame-color');beam.wait_for()
    page.wait_for_timeout(200);a=beam.evaluate('e=>getComputedStyle(e).strokeDashoffset');page.wait_for_timeout(400);assert a!=beam.evaluate('e=>getComputedStyle(e).strokeDashoffset')
    assert beam.evaluate('e=>e.getBBox().width')>1000
    assert page.locator('.ng-asset-belt>div').last.evaluate('e=>getComputedStyle(e).display')=='grid'
    page.get_by_role('button',name='Display settings',exact=True).click();toggle=page.get_by_role('button',name='Frame beams',exact=False);toggle.click()
    page.wait_for_function("document.querySelectorAll('.ng-frame-layer').length===0")
    toggle.click();page.wait_for_function("document.querySelectorAll('.ng-frame-layer').length>0");page.keyboard.press('Escape')
    for path in ('/desk','/global','/etf','/stock/005930'):
      page.goto(base+path);page.locator('.ng-header').wait_for();page.wait_for_timeout(250)
      for width in (390,1440):
        page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(500)
        for icon in page.locator('.d2-cmd-find-glyph svg:visible').all():
          assert icon.evaluate('e=>{const i=e.getBoundingClientRect(),b=e.closest("button").getBoundingClientRect();return i.left>=b.left&&i.right<=b.right&&i.top>=b.top&&i.bottom<=b.bottom}')
        size=page.evaluate('({width:window.innerWidth,scroll:document.documentElement.scrollWidth})');assert size['scroll']<=size['width'],{'engine':engine,'path':path,**size}
    page.emulate_media(reduced_motion='reduce');page.wait_for_function("document.querySelectorAll('.ng-frame-layer').length===0")
    assert not errors,errors
    print(json.dumps({'engine':engine,'moving_beam':True,'toggle':True,'asset_layout':True,'finder_containment':True,'route_lifecycle':True,'reduced_motion':True,'errors':errors}))
    c.close();b.close()
