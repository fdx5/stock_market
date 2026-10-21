"""Public UI regression checks; telemetry blocked, no login and no direct database use."""
import datetime as dt
import atexit, json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

base=os.environ.get('NEO_TEST_URL','http://127.0.0.1:5521')
root=Path(__file__).resolve().parents[2]
out=root/'qa'/('neo-contracts-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
out.mkdir(parents=True)
report={'responsive':[],'interactions':[],'routes':[],'errors':[],'navigation_cancellations':[]}
core=['/','/desk','/global','/map','/stock/005930','/etf','/news','/market-brief','/stocks','/realestate-map']
other=['/kosdaq-map','/sp500-map','/nasdaq100-map','/stock/AAPL','/stock/005930/report','/kospi-100','/kosdaq-100','/nasdaq-100','/global-top100','/market-brief/latest/kospi','/ai-prediction','/ai-prediction/grading','/fight','/battle','/dram-price','/investors','/investors/buffett','/investment-videos','/support','/support-success','/index/kospi','/index/kosdaq','/investor/005930','/stock/005930/news','/stock/005930/outlook','/ranking/trading-value','/sector/semiconductor','/ranking/us-etf','/etf/compare/069500/229200','/desk2','/market-bubbles','/market-bubbles2','/kospi-orbit','/kosdaq-orbit','/nasdaq100-orbit','/sp500-orbit','/discussion-explorer?code=005930&market=KR&asset=STOCK','/hub','/type2','/drone-explore','/drive','/admin','/admin/dashboard','/admin/system-atlas','/admin/monitor','/admin/db','/admin/growth','/admin/support-log','/admin/live']
def save_partial():
  if not (out/'result.json').exists():
    with (out/'result.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
atexit.register(save_partial)

def navigate(page, url, state):
  state.update(phase='navigation', previous_url=page.url)
  try:page.goto(url,wait_until='domcontentloaded')
  finally:state['phase']='steady'

def record_error(error, page, engine, state):
  row={'engine':engine,'url':page.url,'message':str(error),'stack':error.stack,'phase':state['phase']}
  # Windows WebKit reports cancelled resources from the outgoing document as
  # pageerror during hard navigation. Retain these separately; active-document
  # errors (including access-control errors) still fail the test.
  outgoing=state['phase']=='closing' or (state['phase']=='navigation' and page.url==state.get('previous_url'))
  cancelled=engine=='webkit' and outgoing and ('due to access control checks' in str(error) or 'Context is stopped' in str(error))
  report['navigation_cancellations' if cancelled else 'errors'].append(row)

with sync_playwright() as p:
  for engine in os.environ.get('NEO_ENGINES','chrome,webkit').split(','):
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']) if engine=='chrome' else p.webkit.launch(headless=True)
    widths=(360,390,430,768,1024,1440,1920) if engine=='chrome' else (390,768,1440)
    if os.environ.get('NEO_WIDTHS'):widths=tuple(map(int,os.environ['NEO_WIDTHS'].split(',')))
    for width in widths:
      context=browser.new_context(viewport={'width':width,'height':1000},device_scale_factor=1)
      context.add_init_script("localStorage.setItem('site_lang','ko');localStorage.setItem('site_theme','light')")
      def network(route):
        if route.request.method!='GET' or any(x in route.request.url for x in ('/activity','/tracking','/visitors/')):return route.fulfill(json={})
        route.continue_()
      context.route('**/api/**',network)
      page=context.new_page()
      state={'phase':'steady'}
      page.on('pageerror',lambda e,page=page,engine=engine,state=state:record_error(e,page,engine,state))
      for path in core:
        navigate(page,base+path,state)
        page.locator('.ng-header').wait_for()
        page.wait_for_timeout(1400)
        state=page.evaluate("""()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,design:document.documentElement.dataset.design,theme:document.documentElement.dataset.theme,headers:document.querySelectorAll('.ng-header').length,headingFonts:[...document.querySelectorAll('.ng-content h1,.ng-content h2')].slice(0,15).map(e=>getComputedStyle(e).fontFamily)})""")
        record={'engine':engine,'width':width,'path':path,**state}
        if state['scroll']>width+1:record['failure']='page overflow'
        if state['theme']!='dark' or state['design']!='neo' or state['headers']!=1:record['failure']='theme or shell'
        if any(any(font in family for font in ('Hahmlet','Georgia','Unifraktur','Noto Serif','Times New Roman')) for family in state['headingFonts']):record['failure']='legacy heading font'
        if page.locator('.d2-mast-edition:visible,.d2-mast-theme:visible,.theme-toggle-btn:visible').count():record['failure']='day/night switch still visible'
        slug=path.strip('/').replace('/','-') or 'home'
        page.screenshot(path=str(out/f'{engine}-{width}-{slug}.png'))
        report['responsive'].append(record)
        if 'failure' in record: print(json.dumps(record,ensure_ascii=False),flush=True)
      # Global controls are checked on a real desk at two input widths.
      if width in (390,1440):
        navigate(page,base+'/desk',state)
        trigger=page.locator('.ng-header-tools button[aria-label="화면 설정"]')
        trigger.click();dialog=page.locator('.ng-dialog-settings');dialog.wait_for()
        assert page.locator('body').evaluate("e=>getComputedStyle(e).overflow==='hidden'")
        dialog.get_by_role('button',name='Minimal FX',exact=False).click()
        assert page.locator('html').get_attribute('data-fx')=='minimal'
        dialog.get_by_role('button',name='Balanced',exact=False).click()
        page.keyboard.press('Escape');assert not dialog.count()
        assert trigger.evaluate('e=>e===document.activeElement')
        menu=page.locator('.ng-header .ng-menu-trigger') if width>=900 else page.locator('.ng-mobile-nav>button')
        menu.click();page.locator('.ng-dialog-menu').wait_for()
        page.locator('.ng-directory-search input').fill('코스피')
        assert page.locator('.ng-directory-grid a:visible').count()>=3
        page.keyboard.press('Escape');assert menu.evaluate('e=>e===document.activeElement')
        page.keyboard.press('Control+k');search=page.locator('.ng-finder-host .d2-find input');search.wait_for()
        assert search.evaluate('e=>e===document.activeElement')
        search.fill('005930');page.wait_for_timeout(600)
        page.keyboard.press('Escape');assert not page.locator('.ng-finder-host').count()
        page.keyboard.press('/');search.wait_for();search.fill('코스피 지도');page.wait_for_timeout(400)
        assert page.locator('.d2-find-row--page').count()>0
        page.keyboard.press('Enter');page.wait_for_url('**/map')
        assert page.locator('.ng-header').count()==1
        navigate(page,base+'/?design=classic',state)
        assert page.locator('html').get_attribute('data-design')=='classic'
        page.locator('.ng-preview-switch').click();page.locator('.ng-header').wait_for()
        assert page.locator('html').get_attribute('data-theme')=='dark'
        page.emulate_media(reduced_motion='reduce')
        assert page.locator('html').get_attribute('data-design')=='neo'
        report['interactions'].append({'engine':engine,'width':width,'fx':True,'focus_return':True,'directory':True,'search_keyboard_navigation':True,'classic_escape':True,'reduced_motion':True})
      print(f'{engine} {width}px: responsive routes checked',flush=True)
      state['phase']='closing';context.close()
    # Remaining route families, including unauthenticated admin boundaries.
    if engine=='chrome' and os.environ.get('NEO_SKIP_LONGTAIL')!='1':
      context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
      context.add_init_script("localStorage.setItem('site_lang','ko')")
      context.route('**/api/**',network)
      page=context.new_page();state={'phase':'steady'}
      page.on('pageerror',lambda e,page=page,engine=engine,state=state:record_error(e,page,engine,state))
      for path in other:
        navigate(page,base+path,state);page.locator('.ng-header').wait_for();page.wait_for_timeout(1100)
        state=page.evaluate("""()=>({shell:document.querySelectorAll('.ng-header').length,overflow:document.documentElement.scrollWidth>innerWidth+1,content:document.querySelector('.ng-content')?.innerText.trim().length,headerReachable:document.elementFromPoint(25,25)?.closest('.ng-header')!==null,canonical:document.querySelector('link[rel=canonical]')?.href})""")
        if path=='/drone-explore':state['fullscreen_close']=page.locator('.drone-explore-close').count()==1
        report['routes'].append({'path':path,**state})
        page.screenshot(path=str(out/('route-'+path.split('?')[0].strip('/').replace('/','-')+'.png')))
        print(json.dumps(report['routes'][-1],ensure_ascii=False),flush=True)
      state['phase']='closing';context.close()
    browser.close()
with (out/'result.json').open('x',encoding='utf-8') as handle:json.dump(report,handle,ensure_ascii=False,indent=2)
failures=[row for row in report['responsive'] if 'failure' in row]
print(json.dumps({'responsive':len(report['responsive']),'route_checks':len(report['routes']),'failures':len(failures),'page_errors':len(report['errors']),'outgoing_document_cancellations':len(report['navigation_cancellations']),'output':str(out)},ensure_ascii=False),flush=True)
assert not failures,failures
assert not report['errors'],report['errors']
