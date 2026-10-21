"""Keyboard, responsive, and reduced-motion contracts using public-shaped in-memory fixtures."""
import datetime as dt
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
fixture_file = Path(__file__).with_name('test-overview-motion.py')
fixtures = {'__file__':str(fixture_file)}
exec(fixture_file.read_text(encoding='utf-8').split('\nreport = {',1)[0],fixtures)
base = os.environ.get('OVERVIEW_TEST_URL','http://127.0.0.1:5191')
fixtures['BASE'] = base
out = root/'qa'/('main-ux-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S%f'))
out.mkdir(parents=True)
report = {'checks':[],'errors':[]}
with sync_playwright() as p:
    for engine in ('chrome','webkit'):
        browser = p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']) if engine=='chrome' else p.webkit.launch(headless=True)
        cases=[(320,'us','light','ko'),(390,'kr','light','ko'),(390,'us','dark','ko'),(768,'kr','dark','ko'),(1440,'us','dark','ko'),(1440,'kr','light','ko'),(390,'kr','light','en'),(390,'us','dark','en')]
        for width,market,theme,lang in cases:
            context=browser.new_context(viewport={'width':width,'height':960},device_scale_factor=1)
            context.route('**/*',fixtures['serve'])
            page=context.new_page()
            page.on('pageerror',lambda e:report['errors'].append(str(e)))
            page.goto(base+f'/tests/fixtures/overview-motion.html?market={market}&theme={theme}&lang={lang}')
            page.locator('.ed-rolling-number[data-value="$95,000.25"]').wait_for()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(engine,width,'horizontal overflow')
            cards=page.locator('.ed-overview-quote')
            for card in cards.all():
                assert card.evaluate('el=>el.scrollWidth<=el.clientWidth+1'),(engine,width,'quote overflow')
            for field in page.locator('.ed-overview-context>div').all():
                assert field.evaluate('el=>el.scrollWidth<=el.clientWidth+1'),(engine,width,lang,'context overflow')
            assert page.locator('.ed-market-switch a[aria-current=page]').get_attribute('href') == ('/desk' if market=='kr' else '/global')
            if width<=700:
                toggle=page.locator('.ed-distribution-toggle')
                assert toggle.get_attribute('aria-expanded')=='false'
                assert not page.locator('.ed-distribution').is_visible()
                toggle.click()
                assert toggle.get_attribute('aria-expanded')=='true'
            bars=page.locator('.ed-distribution>button')
            assert bars.count()==7
            bars.nth(5).focus();page.keyboard.press('Enter')
            assert bars.nth(5).get_attribute('aria-pressed')=='true'
            assert page.locator('.ed-distribution-detail a').count()==3
            assert page.locator('.ed-distribution-detail a').first.get_attribute('href')=='/stock/3'
            page.get_by_role('button',name='Close selected range' if lang=='en' else '구간 종목 닫기').click()
            assert page.locator('.ed-distribution-detail').count()==0
            assert bars.nth(5).evaluate('el=>el===document.activeElement')
            bars.nth(6).click()
            assert page.locator('.ed-distribution-detail').inner_text().find('No stocks in this range.' if lang=='en' else '이 구간에 해당하는 종목이 없습니다.')>=0
            page.get_by_role('button',name='Close selected range' if lang=='en' else '구간 종목 닫기').click()
            page.emulate_media(reduced_motion='reduce')
            page.wait_for_function("document.querySelector('.ed-market-overview').dataset.motion==='off'")
            assert page.locator('.ed-reel-strip.is-rolling').count()==0
            page.locator('.ed-market-overview').screenshot(path=str(out/f'{engine}-{width}-{market}-{theme}-{lang}.png'))
            report['checks'].append({'engine':engine,'width':width,'market':market,'theme':theme,'lang':lang,'keyboard':True,'overflow':False,'reduced_motion':True})
            print(json.dumps(report['checks'][-1]),flush=True)
            context.close()
        browser.close()
assert not report['errors'],report['errors']
with (out/'result.json').open('x',encoding='utf-8') as handle:json.dump(report,handle,ensure_ascii=False,indent=2)
print(str(out),flush=True)
