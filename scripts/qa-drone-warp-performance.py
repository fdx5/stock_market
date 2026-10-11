"""Actual warp over automatic flight, muted Chrome and public read-only API.

Hold the UI readiness callback in the independent test page so the live renderer
can warm and run a six-second flight beneath the real transition component.
Restore that callback to verify arrival and owned GPU resource release.
"""
import json,sys
from pathlib import Path
from urllib.parse import urlencode,urlsplit
import requests
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1];label,base=sys.argv[1:3]
out=root/'tmp/drone-warp'/label;out.mkdir(parents=True,exist_ok=True)
session=requests.Session();session.trust_env=False;errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});navigator.sendBeacon=()=>false")
        page.on('pageerror',lambda e:errors.append(str(e)[:300]))
        def api(route):
            u=urlsplit(route.request.url)
            if route.request.method in ('GET','HEAD'):
                r=session.get('http://127.0.0.1:8003'+u.path+('?' +u.query if u.query else ''),timeout=20)
                route.fulfill(status=r.status_code,body=r.content,content_type='application/json')
            elif u.path=='/api/realestate/nearby':route.fulfill(json={'items':[]})
            else:route.abort()
        page.route('**/api/**',api)
        q=urlencode({'complex':'26350:우동:1407:해운대두산위브더제니스','hour':12,'fps':1,'dronedebug':1})
        page.goto(base+'/drone-explore?'+q,wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
        page.get_by_role('combobox',name='드론뷰 장소 및 주소 검색').fill('마린시티2로 33')
        page.locator('.re-drone-place-search').get_by_role('option').first.click(timeout=30000)
        page.evaluate('window.__qaOldStage=window.__holoStageAny.current')
        page.locator('.re-drone-place-go').click()
        page.wait_for_function('window.__holoStageAny?.current && window.__holoStageAny.current!==window.__qaOldStage',timeout=10000)
        page.evaluate("()=>{const s=window.__holoStageAny.current;Object.defineProperty(s,'exploreReady',{configurable:true,get:()=>undefined,set:f=>window.__qaReady=f});}")
        page.wait_for_function("window.__drone && !window.__drone.ended && window.__holoNative?.shown && document.querySelector('.re-holo-stage')?.dataset.trafficArmedAt",timeout=90000)
        page.wait_for_timeout(3000)
        assert page.locator('.drone-warp-tunnel').is_visible()
        page.evaluate("()=>{const f=window.__drone.flight;f.setAutoAltitude(175);f.setAutoSpeed(73);f.setAutopilot(true);}")
        page.wait_for_timeout(2000)
        perf=page.evaluate('''async()=>{
          const n=window.__holoNative,start=performance.now(),f=window.__drone.flight;
          let last=start,win=start,frame=n.frameNo,first=frame;
          const times=[],windows=[],ratios=new Set(),from=f.pos.clone();
          await new Promise(resolve=>{const tick=t=>{times.push(t-last);last=t;ratios.add(document.querySelector('.re-holo-stage').dataset.pixelRatio);if(t-win>=1000){windows.push((n.frameNo-frame)*1000/(t-win));frame=n.frameNo;win=t;}if(t-start>=6000)resolve();else requestAnimationFrame(tick)};requestAnimationFrame(tick)});
          times.sort((a,b)=>a-b);const q=p=>times[Math.min(times.length-1,Math.floor(times.length*p))],el=document.querySelector('.drone-warp-tunnel');
          window.__qaWarpCanvas=el;window.__qaWarpGL=el.getContext('webgl');
          return{renderedFrames:n.frameNo-first,minOneSecondFps:Math.min(...windows),windows,p95Ms:q(.95),p99Ms:q(.99),maxMs:times.at(-1),canvas:[n.canvas.width,n.canvas.height],pixelRatios:[...ratios],quality:n.quality.name,tunnel:{canvas:[el.width,el.height],...el.dataset},movedMetres:from.distanceTo(f.pos)};
        }''')
        assert perf['movedMetres']>10 and perf['canvas']==[2520,1750],perf
        page.evaluate("()=>{window.__drone.flight.setAutopilot(false);Object.defineProperty(window.__holoStageAny.current,'exploreReady',{configurable:true,writable:true,value:window.__qaReady});}")
        page.wait_for_function("!document.querySelector('.drone-warp')",timeout=10000)
        page.wait_for_function('window.__qaWarpGL.isContextLost()',timeout=5000)
        release=page.evaluate('({detached:!document.contains(window.__qaWarpCanvas),buffer:[window.__qaWarpCanvas.width,window.__qaWarpCanvas.height],contextLost:window.__qaWarpGL.isContextLost()})')
        assert release=={'detached':True,'buffer':[0,0],'contextLost':True},release
        report={'performance':perf,'release':release,'errors':errors,'chrome':browser.version,'muted':True}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(report,ensure_ascii=False),flush=True);assert not errors
    except Exception:
        page.screenshot(path=str(out/'failure.png'));raise
    finally:browser.close()
