"""Refresh-light QA with API fixtures held only in browser memory. No DB access."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5194'
results=[]
PULSES='''() => document.querySelector('.sc-grid').getAnimations({subtree:true}).filter(a=>a.id==='scanner-refresh-glow'&&a.playState==='running').map(a=>({code:a.effect.target.dataset.code,delay:a.effect.getTiming().delay,duration:a.effect.getTiming().duration}))'''
FRAMES='''()=>new Promise(resolve=>{let a=[],last=0;const start=performance.now();function f(t){if(last)a.push({t,dt:t-last});last=t;if(t-start<3000)requestAnimationFrame(f);else{const s=a.map(x=>x.dt).sort((a,b)=>a-b),seconds=[0,1,2].map(i=>a.filter(x=>x.t>=start+i*1000&&x.t<start+(i+1)*1000).length);resolve({fps:1000/(a.reduce((sum,x)=>sum+x.dt,0)/a.length),minOneSecond:Math.min(...seconds),p95:s[Math.floor(s.length*.95)],p99:s[Math.floor(s.length*.99)],max:s.at(-1)})}}requestAnimationFrame(f)})'''

with sync_playwright() as p:
    browser=p.chromium.launch(args=['--mute-audio'])
    for width,height,dpr in [(1440,1000,1),(390,844,2)]:
        revision={'value':0}
        def mock(route):
            path=urlparse(route.request.url).path
            if not path.startswith('/api/'):
                return route.continue_()
            if path in ['/api/market/map','/api/market/kosdaq-map','/api/market/nasdaq100-map','/api/market/sp500-map']:
                r=revision['value']
                items=[{'code':f'{i:06}','name':f'Fixture {i}','sector':f'Sector {i%5}','marcap':1e12-i*1e9,'close':100+i+r,'change':1,'change_pct':(i%7)-3+r*.01,'volume':1000,'turnover':1e8+i*1e6,'quote_time':'2026-10-23T08:00:00Z'} for i in range(1,61)]
                return route.fulfill(json={'generated_at':f'2026-10-23T08:00:{r:02}Z','count':60,'items':items})
            return route.fulfill(status=503,json={'detail':'Read-only visual fixture'})
        context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=dpr)
        context.route('**/api/**',mock)
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base,wait_until='domcontentloaded')
        page.locator('.sc-stock').first.wait_for()
        page.locator('.sc-grid').scroll_into_view_if_needed()
        page.wait_for_timeout(1200)
        initial_height=page.locator('.sc-scanner').evaluate('e=>e.getBoundingClientRect().height')
        assert not page.evaluate(PULSES),'initial data uses one sheet, not a random refresh'
        revision['value']=1
        page.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
        page.wait_for_function(PULSES.replace('() =>','() => (')+'.length > 0)',timeout=15000)
        first=page.evaluate(PULSES)
        assert 1<=len(first)<=6
        assert len({x['delay'] for x in first})==len(first)
        assert len({x['duration'] for x in first})==len(first)
        frames=page.evaluate(FRAMES)
        assert frames['fps']>=50 and frames['minOneSecond']>=50,frames
        assert page.locator('.sc-scanner').evaluate('e=>e.getBoundingClientRect().height')==initial_height
        assert page.locator('.mt-sparks,.ms-energy,.ms-spark').count()==0
        assert not page.evaluate(PULSES),'refresh light must finish'
        # A normal re-sort is not a market refresh.
        page.locator('.sc-controls div[role=group] button').nth(1).click()
        page.wait_for_timeout(450)
        assert not page.evaluate(PULSES)
        # A successful refresh of unchanged quotes still gets a quiet heartbeat.
        page.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
        page.wait_for_function(PULSES.replace('() =>','() => (')+'.length > 0)',timeout=15000)
        second=page.evaluate(PULSES)
        if width==1440:assert {x['code'] for x in first}!={x['code'] for x in second}
        page.emulate_media(reduced_motion='reduce')
        page.wait_for_function('document.querySelector(".sc-grid").getAnimations({subtree:true}).filter(a=>a.playState==="running").length===0')
        assert not page.evaluate(PULSES)
        revision['value']=3
        page.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
        page.wait_for_function('document.querySelector(".sc-heading p span").textContent.includes("KST")')
        page.wait_for_timeout(4500)
        assert not page.evaluate(PULSES)
        assert not errors,errors
        result={'width':width,'dpr':dpr,'heightUnchanged':initial_height,'firstPulse':first,'secondPulse':second,'refreshFrames':frames,'errors':errors}
        results.append(result);print(json.dumps(result),flush=True)
        context.close()
    browser.close()
Path('qa/scanner-refresh-fx-qa.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
