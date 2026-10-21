"""Natural frame glow, absence of travelling strokes, and icon containment."""
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
    page.goto(base+'/');glow=page.locator('.ng-top-rail>.ng-frame-layer .ng-frame-glow');glow.wait_for(state='attached')
    current=page.locator('.ng-header-current');assert current.count()==1
    assert page.locator('.ng-header>.ng-frame-layer').count()==0
    beam=current.locator('i')
    beam.evaluate('e=>{const a=e.getAnimations()[0];a.pause();a.currentTime=1600}')
    first=beam.bounding_box()['x']
    beam.evaluate('e=>e.getAnimations()[0].currentTime=4000')
    assert beam.bounding_box()['x']>first+300
    glow.evaluate('e=>{const animation=e.getAnimations().find(a=>a.animationName==="ng-frame-breathe");animation.pause();animation.currentTime=0}')
    assert float(glow.evaluate('e=>getComputedStyle(e).opacity'))==0
    glow.evaluate('e=>{const animation=e.getAnimations().find(a=>a.animationName==="ng-frame-breathe");animation.currentTime=6000}')
    assert float(glow.evaluate('e=>getComputedStyle(e).opacity'))>.95
    assert float(glow.evaluate('e=>getComputedStyle(e).strokeWidth').replace('px',''))==1
    assert page.locator('.ng-atlas-heading>.ng-frame-layer path').evaluate('e=>{const d=e.getAttribute("d");return (d.match(/M/g)||[]).length===1&&!d.includes("V")}')
    assert glow.evaluate('e=>getComputedStyle(e).strokeDasharray')=='none'
    assert page.locator('.ng-frame-head,.ng-frame-core,.ng-frame-nearline,.ng-frame-color').count()==0
    assert glow.evaluate('e=>e.getBBox().width')>1000
    assert page.locator('.ng-asset-belt>div').last.evaluate('e=>getComputedStyle(e).display')=='grid'
    page.get_by_role('button',name='Display settings',exact=True).click();toggle=page.get_by_role('button',name='Frame glow',exact=False);toggle.click()
    page.wait_for_function("document.querySelectorAll('.ng-frame-layer').length===0")
    assert not current.is_visible()
    toggle.click();page.wait_for_function("document.querySelectorAll('.ng-frame-layer').length>0");page.keyboard.press('Escape')
    for path in ('/desk','/global','/etf','/stock/005930'):
      page.goto(base+path);page.locator('.ng-header').wait_for();page.wait_for_timeout(250)
      for width in (390,1440):
        page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(500)
        for icon in page.locator('.d2-cmd-find-glyph svg:visible').all():
          assert icon.evaluate('e=>{const i=e.getBoundingClientRect(),b=e.closest("button").getBoundingClientRect();return i.left>=b.left&&i.right<=b.right&&i.top>=b.top&&i.bottom<=b.bottom}')
        size=page.evaluate('({width:window.innerWidth,scroll:document.documentElement.scrollWidth})');assert size['scroll']<=size['width'],{'engine':engine,'path':path,**size}
    page.emulate_media(reduced_motion='reduce');page.wait_for_function("document.querySelectorAll('.ng-frame-layer').length===0")
    assert not current.is_visible()
    assert not errors,errors
    print(json.dumps({'engine':engine,'natural_glow':True,'no_travelling_strokes':True,'toggle':True,'asset_layout':True,'finder_containment':True,'route_lifecycle':True,'reduced_motion':True,'errors':errors}))
    c.close();b.close()
