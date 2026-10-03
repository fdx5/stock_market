import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
(root/'tmp').mkdir(exist_ok=True)
entry=root/'frontend/src/__chart_review.tsx'
html=root/'frontend/__chart_review.html'
entry.write_text('''import React,{useMemo,useRef,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';import {LanguageProvider} from './i18n/LanguageContext';
import {FinancialChart,FinancialHandle} from './charts/FinancialChart';import Indicators,{IndicatorPanelHandle} from './charts/IndicatorCharts';
import MarketChart from './charts/MarketChart';import {syncTimeScales} from './chartSync';
import './styles.css';import './desk2/desk2.css';import './desk2/pages.css';
function Review(){
 const points=useMemo(()=>Array.from({length:250},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:100+i/2,close:102+i/2+Math.sin(i/5)*6,high:110+i/2,low:90+i/2,volume:1000+i*25,sma5:102+i/2,sma20:100+i/2,sma60:98+i/2,sma120:96+i/2,bb_upper:110+i/2,bb_lower:90+i/2,rsi14:50+Math.sin(i/10)*20,macd:Math.sin(i/10),macd_signal:Math.sin(i/10)*.7,macd_hist:Math.sin(i/10)*.3})),[]);
 const price=useRef<FinancialHandle>(null);const sub=useRef<IndicatorPanelHandle>(null);
 const [show,setShow]=useState(true);
 useEffect(()=>syncTimeScales([price.current!.getChart(),...sub.current!.getCharts()]),[]);
 return <div className="d2" style={{padding:20,maxWidth:1100,margin:'auto'}}>
 <FinancialChart points={points as any} ref={price}/><Indicators ref={sub} points={points as any} latest={points[points.length-1] as any} defaultExpanded/>
 <button id="mount-toggle" onClick={()=>setShow(v=>!v)}>toggle</button>
 <div style={{height:1200}}/><div id="deferred">{show&&<MarketChart height={160} label="Deferred line" series={[{name:'line',values:[1,3,2,5,4],fill:true}]}/>}</div>
 </div>;
}createRoot(document.getElementById('root')!).render(<LanguageProvider><Review/></LanguageProvider>);
''',encoding='utf-8')
html.write_text('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/src/__chart_review.tsx"></script></body></html>',encoding='utf-8')
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='msedge',headless=True)
  page=browser.new_page(viewport={'width':1280,'height':900})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://localhost:5173/__chart_review.html')
  page.locator('.market-financial .market-chart[data-chart-painted=true]').first.wait_for(timeout=60000)
  assert not page.locator('#deferred .market-chart').get_attribute('data-chart-ready')
  initial_frame=page.locator('.market-financial .market-chart').first.screenshot()
  page.wait_for_timeout(1800)
  assert initial_frame != page.locator('.market-financial .market-chart').first.screenshot(), 'Drawing animation did not advance'
  inspect='''async () => {const m=await import('/src/charts/engine.ts');return [...document.querySelectorAll('.market-financial .market-chart')].map(el=>{const c=m.getInstanceByDom(el);return c?c.getOption():null;});}'''
  opts=page.evaluate(inspect)
  assert opts[0]['series'][0]['data'][0]==[100,102,90,110]
  assert opts[0]['dataZoom'][0]['startValue']>0, 'Initial six-month window must be applied'
  page.locator('.market-financial').first.get_by_role('button',name='1M',exact=True).click()
  page.locator('.market-financial').nth(1).scroll_into_view_if_needed();page.wait_for_timeout(700)
  opts=page.evaluate(inspect)
  assert all(o['dataZoom'][0]['startValue']==opts[0]['dataZoom'][0]['startValue'] for o in opts),[o['dataZoom'] for o in opts]
  page.locator('.market-financial').first.get_by_role('button',name='Bollinger',exact=True).click()
  assert len(page.evaluate(inspect)[0]['series'])==7
  plot=page.locator('.market-financial .market-chart').first
  plot.scroll_into_view_if_needed();box=plot.bounding_box()
  page.mouse.move(box['x']+box['width']*.55,box['y']+70);page.wait_for_timeout(200)
  assert page.locator('.market-chart-reading').first.locator('time').count()==1
  assert page.locator('.market-chart-reading').first.locator('time').inner_text()!='2025-09-07'
  # A regular wheel gesture remains a page scroll, while Ctrl-wheel zooms.
  before=page.evaluate('scrollY');page.mouse.wheel(0,220);page.wait_for_timeout(200)
  assert page.evaluate('scrollY')>before
  page.locator('#deferred').scroll_into_view_if_needed()
  page.locator('#deferred .market-chart[data-chart-painted=true]').wait_for()
  page.wait_for_timeout(1200)
  page.screenshot(path=str(root/'tmp/chart-deferred.png'))
  page.locator('#mount-toggle').click();assert not page.locator('#deferred canvas').count()
  page.locator('#mount-toggle').click();page.locator('#deferred').scroll_into_view_if_needed()
  page.locator('#deferred .market-chart[data-chart-ready=true]').wait_for()
  page.emulate_media(reduced_motion='reduce');page.wait_for_timeout(300)
  assert page.locator('#deferred .market-chart').get_attribute('data-chart-motion')=='reduced'
  page.emulate_media(reduced_motion='no-preference')
  for width in [1280,390]:
   page.set_viewport_size({'width':width,'height':900});page.evaluate('scrollTo(0,0)');page.wait_for_timeout(700)
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.screenshot(path=str(root/f'tmp/financial-chart-{width}.png'))
  assert not errors,errors
  browser.close()
 print('Candle order, MA/Bollinger toggles, date-based chart sync, lazy viewport drawing, disposal/remount, reduced motion, desktop/mobile passed')
finally:
 entry.unlink(missing_ok=True);html.unlink(missing_ok=True)
