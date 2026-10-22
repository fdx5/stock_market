"""Local quote-board checks. GET-only public data plus browser-memory model fixtures."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5194'
out=Path('qa')
out.mkdir(exist_ok=True)
results=[]

with sync_playwright() as p:
    browser=p.chromium.launch(args=['--mute-audio'])
    for width,height,dpr in [(1440,1000,1),(1280,900,1),(390,844,2)]:
        context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=dpr)
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base,wait_until='domcontentloaded')
        page.locator('.sc-stock').first.wait_for(timeout=60000)
        page.wait_for_timeout(800)
        if width==1440:
            model=page.evaluate('''async()=>{
              const {marketScanner}=await import('/src/neo/marketScannerModel.ts');
              const a={code:'A',name:'A',sector:'ONE',marcap:100,close:10,change_pct:2,turnover:10};
              const b={...a,code:'B',sector:'TWO',marcap:10,change_pct:-1,turnover:100};
              const c={...a,code:'C',marcap:5,change_pct:0,turnover:0,volume:0};
              const input=[a,b,c,a],cap=marketScanner(input,'cap');
              const checks=[cap.stocks.length===3,cap.up===1,cap.down===1,cap.unknown===1,marketScanner(input,'activity').stocks[0].code==='B',marketScanner(input,'return').stocks[2].code==='C',marketScanner(input,'cap','TWO').stocks.length===1,marketScanner([],'cap').stocks.length===0];
              if(checks.some(x=>!x))throw Error(JSON.stringify(checks));return checks.length;
            }''')
            results.append({'modelChecks':model})
        default_count=page.locator('.sc-stock').count()
        scanner_height=page.locator('.sc-scanner').evaluate('e=>e.getBoundingClientRect().height')
        assert scanner_height<550,(width,scanner_height)
        if width>=1280:assert default_count>=36
        assert page.locator('.mt-terrain,.mt-sparks,.ms-energy,.ms-spark').count()==0
        assert page.locator('.sc-stock-name').count()==default_count
        # Every card has equal reading area, including the two largest stocks.
        sizes=page.locator('.sc-stock').evaluate_all('els=>els.map(e=>({w:e.clientWidth,h:e.clientHeight}))')
        assert max(s['w'] for s in sizes)-min(s['w'] for s in sizes)<=1
        assert max(s['h'] for s in sizes)-min(s['h'] for s in sizes)<=1
        page.screenshot(path=str(out/f'market-scanner-{width}.png'))
        if page.locator('.sc-expand').count():
            page.locator('.sc-expand').click()
            assert page.locator('.sc-stock').count()>=default_count
            full_count=page.locator('.sc-stock').count()
            page.locator('.sc-expand').click()
            assert page.locator('.sc-stock').count()==default_count
            assert page.locator('.sc-expand').evaluate('e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}'), 'collapse keeps the quote board in view'
        else:full_count=default_count
        assert full_count>2
        page.locator('.sc-controls div[role=group] button').nth(1).click()
        page.wait_for_timeout(500)
        assert page.locator('.sc-controls div[role=group] button').nth(1).get_attribute('aria-pressed')=='true'
        page.locator('.sc-stock').nth(2).click()
        selected=page.locator('.sc-stock').nth(2).get_attribute('data-code')
        assert page.locator(f'.sc-stock[data-code="{selected}"]').get_attribute('aria-pressed')=='true'
        assert page.locator('.sc-selected>div:first-child>strong').inner_text()==page.locator(f'.sc-stock[data-code="{selected}"] .sc-stock-name').inner_text()
        sector=page.locator('.sc-sector-filter option').nth(1).get_attribute('value')
        page.locator('.sc-sector-filter select').select_option(sector)
        assert page.locator('.sc-stock').count()>0
        page.locator('.sc-sector-filter select').select_option('')
        page.locator('.sc-markets button').nth(2).click()
        page.wait_for_timeout(500)
        assert page.locator('.sc-scanner').get_attribute('data-market')=='nasdaq100'
        assert page.locator('.sc-stock').count()>0
        page.locator('.sc-markets button').first.click()
        page.locator('.sc-controls div[role=group] button').first.click()
        # Continuous rendering is confined to the user's original shell pulse.
        frames=page.evaluate('''()=>new Promise(resolve=>{const a=[];let last=0;const start=performance.now();function f(t){if(last)a.push({t,dt:t-last});last=t;if(t-start<3500)requestAnimationFrame(f);else{const s=a.map(x=>x.dt).sort((a,b)=>a-b),seconds=[1,2].map(i=>a.filter(x=>x.t>=start+i*1000&&x.t<start+(i+1)*1000).length);resolve({fps:1000/(a.reduce((s,x)=>s+x.dt,0)/a.length),minOneSecond:Math.min(...seconds),p95:s[Math.floor(s.length*.95)],p99:s[Math.floor(s.length*.99)],max:s.at(-1)})}}requestAnimationFrame(f)})''')
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        page.locator('.ng-mini-map-card').first.scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        maps=page.locator('.ng-mini-map-card').evaluate_all('els=>els.map(e=>{const r=e.getBoundingClientRect(),s=e.querySelector(".ng-mini-map-stage").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,mapHeight:s.height}})')
        assert len(maps)==3
        for i,m in enumerate(maps):
            assert m['mapHeight']>=(640 if width<600 else 380)
            if i:assert m['y']>=maps[i-1]['y']+maps[i-1]['h']
        assert not errors,errors
        page.emulate_media(reduced_motion='reduce')
        page.locator('.sc-controls div[role=group] button').nth(1).click()
        assert page.locator('.sc-stock').count()>0
        page.wait_for_function('document.querySelector(".sc-grid").getAnimations({subtree:true}).filter(a=>a.playState==="running").length===0')
        results.append({'width':width,'height':height,'dpr':dpr,'scannerHeight':scanner_height,'defaultStocks':default_count,'expandedStocks':full_count,'frames':frames,'maps':maps,'errors':errors})
        print(json.dumps(results[-1]),flush=True)
        context.close()
    browser.close()
(out/'market-scanner-qa.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
