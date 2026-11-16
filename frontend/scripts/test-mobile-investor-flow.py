"""Touch portrait/landscape checks with complete large amounts; no DB or backend."""
import json
import os
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL = os.environ.get('MOBILE_FLOW_URL','http://127.0.0.1:5188')
OUT = Path(__file__).resolve().parents[2] / 'tmp' / 'mobile-flow-review'
OUT.mkdir(parents=True,exist_ok=True)

def fixture(route):
    url=urlparse(route.request.url)
    if url.netloc!=urlparse(URL).netloc: route.abort();return
    if not url.path.startswith('/api/'): route.continue_();return
    now=datetime.now(timezone.utc)
    data={'items':[],'points':[],'count':0,'total':0,'snapshot':'test'}
    if url.path=='/api/investor/indices':
        data={}
        day=now.astimezone(timezone(timedelta(hours=9))).strftime('%Y%m%d')
        for market,amounts in [('kospi',[1234567,-9987654,7654321]),('kosdaq',[-2345678,8765432,-3456789])]:
            data[market]={'symbol':market.upper(),'name':market,'close':5000,'change':-25,'change_pct':-2.5,'market_status':'OPEN','updated_at':now.isoformat()}
            data[market+'_investor']=dict(zip(['individual_amount','foreign_amount','institution_amount'],amounts),business_date=day,fetched_at=time.time())
    elif url.path in ('/api/market/map','/api/market/kosdaq-map','/api/market/nasdaq100-map'):
        data={'items':[{'code':'005930','name':'삼성전자','sector':'반도체','close':72000,'change_pct':-1.2,'marcap':4e14}], 'generated_at':now.isoformat()}
    elif url.path=='/api/geo/country':data={'country':'KR'}
    route.fulfill(content_type='application/json',body=json.dumps(data,ensure_ascii=False))

SIZES=[(320,740),(740,320),(360,800),(800,360),(390,844),(844,390),(430,932),(932,430),(768,1024),(1024,768)]

def geometry(page):
    return page.locator('.pif-panel').evaluate('''panel=>{
      const box=panel.getBoundingClientRect(),bad=[];
      for(const el of panel.querySelectorAll('.pif-content,.pif-rows,.pif-row,.pif-row-label,.pif-amount,.pif-places')){
        const r=el.getBoundingClientRect();
        if(el.scrollWidth>el.clientWidth+1||r.left<box.left-1||r.right>box.right+1)bad.push({class:el.className,width:r.width,scroll:el.scrollWidth,left:r.left,right:r.right,panel:[box.left,box.right]});
      }
      const amounts=[...panel.querySelectorAll('.pif-amount')].map(el=>{
        const label=el.getAttribute('aria-label'),count=el.querySelectorAll('.pif-digit').length;
        const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        if(!hit||!panel.contains(hit))bad.push({coveredAmount:label,hit:hit?.className,rect:[r.left,r.top,r.right,r.bottom]});
        return {label,count,expected:(label.match(/[0-9]/g)||[]).length};
      });
      for(const digit of panel.querySelectorAll('.pif-digit')){
        const style=getComputedStyle(digit),reel=digit.firstElementChild;
        const current=reel.style.transform.includes('-50%')?reel.lastElementChild:reel.firstElementChild;
        const a=digit.getBoundingClientRect(),b=current.getBoundingClientRect();
        if(b.top<a.top-.5||b.bottom>a.bottom+.5)bad.push({verticalGlyph:[a.top,a.bottom,b.top,b.bottom]});
        if(a.height<parseFloat(style.fontSize)*1.4)bad.push({shortDigit:a.height,font:style.fontSize});
      }
      return {bad,amounts,height:box.height,width:box.width};
    }''')

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
    context.route('**/*',fixture)
    context.add_init_script("localStorage.setItem('site_lang','ko');localStorage.setItem('kospimap_home_market','kospi');")
    context.add_init_script("const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:original.call(this,kind,...args)};")
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    results=[]
    for path in ['/','/pulse-board']:
        page.goto(URL+path)
        page.wait_for_selector('.pif-panel[data-mode=flowing]',timeout=60000)
        samples=[]
        for _ in range(6):
            samples.append(page.locator('.pif-amount').first.get_attribute('aria-label'));page.wait_for_timeout(140)
        assert len(set(samples))>=5
        for market in ['kospi','kosdaq']:
            if path=='/':
                page.get_by_role('group',name='시장 선택',exact=True).get_by_role('button',name=re.compile('^'+market.upper())).click()
            else:page.get_by_role('tab',name=re.compile('^'+market.upper())).click()
            page.wait_for_selector('.pif-panel[data-mode=flowing]')
            page.locator('.pif-controls button').click()
            page.wait_for_selector('.pif-panel[data-mode=paused]')
            for width,height in SIZES:
                page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(800)
                page.locator('.pif-panel').evaluate("el=>el.scrollIntoView({block:'center',behavior:'instant'})")
                report=geometry(page)
                assert not report['bad'],(path,market,width,height,report)
                assert len(report['amounts'])==3 and all(x['count']==x['expected'] for x in report['amounts']),report
                assert page.locator('.pif-row').evaluate_all('els=>els.every(el=>{let r=el.getBoundingClientRect(),p=el.closest(".pif-panel").getBoundingClientRect();return r.left>=p.left&&r.right<=p.right})')
                results.append({'path':path,'market':market,'viewport':[width,height],'panel':[report['width'],report['height']]})
                if market=='kospi' and width in (320,844):
                    page.locator('.pif-panel').screenshot(path=str(OUT/f'{"home" if path=="/" else "board"}-{width}x{height}.png'))
            # Also check the fallback font's complete glyph cells on a small phone.
            page.set_viewport_size({'width':320,'height':740})
            page.evaluate("document.documentElement.style.setProperty('--f-num','Arial, sans-serif')")
            page.locator('.pif-panel').evaluate("el=>el.scrollIntoView({block:'center',behavior:'instant'})")
            page.wait_for_timeout(300);assert not geometry(page)['bad']
            page.evaluate("document.documentElement.style.removeProperty('--f-num')")
            page.locator('.pif-controls button').click()
        print(f'PASS {path}: both markets, ten touch orientations, full amounts and glyph height',flush=True)
    assert not errors,errors
    (OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    browser.close()
    print('PASS 40 portrait/landscape cases at DPR 2 with no horizontal scrolling',flush=True)
