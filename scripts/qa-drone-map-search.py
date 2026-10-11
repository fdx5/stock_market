"""Actual map -> building view -> flight -> search, muted and read-only API."""
import json,sys
from pathlib import Path
from urllib.parse import urlencode,urlsplit
import requests
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1]
label,base=sys.argv[1:3]
out=root/'tmp/drone-map-search'/label;out.mkdir(parents=True,exist_ok=True)
snapshot=json.loads(Path('I:/ai_root/stock_market/tmp/central-xi-explore.json').read_text(encoding='utf8'))
item=snapshot['items'][0]
session=requests.Session();session.trust_env=False
errors=[];results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        sizes=[(390,844,True)] if '--mobile-only' in sys.argv else [(1440,1000,False),(390,844,True)]
        for width,height,touch in sizes:
            context=browser.new_context(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch)
            page=context.new_page()
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
            q=urlencode({'sido':'41','sgg':'41150','complex':item['id'],'period':'1y','fps':1,'dronedebug':1})
            page.goto(base+'/realestate-map?'+q,wait_until='domcontentloaded')
            page.get_by_role('button',name='3D 건물뷰',exact=True).click(timeout=90000)
            page.wait_for_function('window.__holoNative?.shown && window.__holoStageAny?.current?.model && document.querySelector(".re-holo-stage")?.dataset.shownAt',timeout=90000)
            page.locator('.re-holo-drone-btn').click(timeout=90000)
            page.wait_for_function('!!window.__drone',timeout=30000)
            search=page.get_by_role('combobox',name='드론뷰 장소 및 주소 검색')
            search.wait_for(state='visible',timeout=5000)
            assert not search.is_disabled()
            for control in [search,page.locator('.re-drone-place-go')]:
                assert control.evaluate('(e)=>{const b=e.getBoundingClientRect();return b.width>30&&b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight&&e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}'),control.bounding_box()
            page.locator('.re-drone-auto-settings-toggle').click()
            speed=page.get_by_label('오토파일럿 속도',exact=True);alt=page.get_by_label('오토파일럿 목표 고도',exact=True)
            speed.fill('200');speed.press('Enter');alt.fill('1000');alt.press('Enter')
            assert page.evaluate('Math.round(window.__drone.flight.autoCruiseSpeed*3.6)')==200
            assert page.evaluate('window.__drone.flight.autoCruiseAgl')==1000
            page.keyboard.press('Escape')
            page.locator('.re-drone-auto-settings').wait_for(state='detached',timeout=3000)
            assert page.locator('.re-drone-auto-settings-toggle').is_visible(), 'Settings Escape closed the flight/layer'
            search.click()
            cdp=context.new_cdp_session(page)
            cdp.send('Input.imeSetComposition',{'text':'강남데시앙','selectionStart':5,'selectionEnd':5})
            options=page.locator('.re-drone-place-search').get_by_role('option')
            options.first.wait_for(state='visible',timeout=30000)
            first=options.first
            assert '세곡동 강남데시앙파크' in first.inner_text(),first.inner_text()
            page.screenshot(path=str(out/f'map-search-{width}.png'))
            first.click()
            page.evaluate('window.__qaOldDrone=window.__drone;window.__qaOldCanvas=window.__holoNative.canvas')
            previous=page.url
            page.locator('.re-drone-place-go').click()
            warp=page.get_by_role('dialog',name='드론뷰 워프 이동')
            warp.wait_for(state='visible',timeout=5000)
            started=page.evaluate('performance.now()')
            page.screenshot(path=str(out/f'map-warp-{width}.png'))
            warp.wait_for(state='detached',timeout=120000)
            elapsed=(page.evaluate('performance.now()')-started)/1000
            assert elapsed>=4.8,elapsed
            point=page.evaluate('''()=>{const q=new URLSearchParams(location.search),d=window.__drone;return{target:{lat:+q.get('lat'),lon:+q.get('lon')},origin:d.p.data.center,where:d.where(),oldSessionEnded:window.__qaOldDrone.ended,oldCanvasDetached:!document.contains(window.__qaOldCanvas),name:d.p.data.name};}''')
            assert page.url.split('/drone-explore?')[0]==base
            assert point['oldSessionEnded'] and point['oldCanvasDetached'],point
            for axis in ['lat','lon']:
                assert abs(point['target'][axis]-point['origin'][axis])<1e-6,point
                assert abs(point['target'][axis]-point['where'][axis])<1e-6,point
            page.screenshot(path=str(out/f'map-arrival-{width}.png'))
            results.append({'viewport':[width,height],'touch':touch,'from':previous.split('?')[0],'settings':[200,1000],'query':'강남데시앙 (IME, no Space)','warpSeconds':elapsed,'arrival':point})
            context.close()
        report={'entries':results,'errors':errors,'chrome':browser.version,'muted':True}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(report,ensure_ascii=False),flush=True)
        assert not errors
    except Exception:
        page.screenshot(path=str(out/'failed.png'));raise
    finally:browser.close()
