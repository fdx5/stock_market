"""Production JS/CSS, public local snapshot API; no saved browser data or app writes."""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode,urlsplit
import requests
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1]
label=sys.argv[1]
base=sys.argv[2] if len(sys.argv)>2 else 'https://kospimap.com'
out=root/'tmp/settings-hotfix'/label
out.mkdir(parents=True,exist_ok=True)
session=requests.Session();session.trust_env=False
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});navigator.sendBeacon=()=>false")
        def api(route):
            u=urlsplit(route.request.url)
            if route.request.method in ('GET','HEAD'):
                r=session.get('http://127.0.0.1:8003'+u.path+('?' +u.query if u.query else ''),timeout=20)
                route.fulfill(status=r.status_code,body=r.content,content_type='application/json')
            elif u.path=='/api/realestate/nearby':route.fulfill(json={'items':[]})
            else:route.abort()
        page.route('**/api/**',api)
        page.on('pageerror',lambda e:errors.append(str(e)[:300]))
        q=urlencode({'complex':'26350:우동:1407:해운대두산위브더제니스','hour':12,'dronedebug':1})
        page.goto(base+'/drone-explore?'+q,wait_until='domcontentloaded')
        page.locator('.re-drone-auto-settings-toggle').click(timeout=90000)
        result=page.locator('.re-drone-auto-settings').evaluate('''e=>{const css=x=>{const s=getComputedStyle(x),b=x.getBoundingClientRect();return{text:x.textContent,value:x.value,display:s.display,visibility:s.visibility,color:s.color,opacity:s.opacity,width:b.width,height:b.height,x:b.x,y:b.y};};return{panel:css(e),children:[...e.children].map(css),styleSheets:[...document.styleSheets].map(s=>s.href)};}''')
        if label!='production-before':
            assert page.locator('.re-drone-auto-settings').evaluate("e=>e.matches(':modal')"), 'Settings must use the native top layer'
        page.screenshot(path=str(out/'settings.png'))
        layouts=[]
        for width,height in [(1440,1000),(390,844),(844,390)]:
            page.set_viewport_size({'width':width,'height':height})
            speed=page.get_by_label('오토파일럿 속도',exact=True);alt=page.get_by_label('오토파일럿 목표 고도',exact=True)
            speed.fill('200');speed.press('Enter');alt.fill('1000');alt.press('Enter')
            for item in [speed,alt,page.locator('.re-drone-auto-settings > button')]:
                assert item.is_visible()
                assert item.evaluate('e=>{const b=e.getBoundingClientRect();return b.width>30&&b.height>15&&b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight&&e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))}'),item.bounding_box()
            layouts.append({'viewport':[width,height],'speed':speed.input_value(),'altitude':alt.input_value()})
            if label!='production-before':
                assert page.evaluate('Math.round(window.__drone.flight.autoCruiseSpeed*3.6)')==200
                assert page.evaluate('window.__drone.flight.autoCruiseAgl')==1000
            page.screenshot(path=str(out/f'settings-{width}.png'))
        if label!='production-before':
            speed.fill('73');speed.press('Enter');alt.fill('10');alt.press('Enter')
            assert page.evaluate('Math.round(window.__drone.flight.autoCruiseSpeed*3.6)')==73
            assert page.evaluate('window.__drone.flight.autoCruiseAgl')==10
            page.locator('.re-drone-auto-settings > button').click()
            assert page.locator('.re-drone-auto-settings').count()==0
            page.locator('.re-drone-auto-settings-toggle').click();page.keyboard.press('Escape')
            page.locator('.re-drone-auto-settings').wait_for(state='detached',timeout=3000)
            assert page.evaluate('!!window.__drone'), 'Closing settings must not land the drone'
        result.update(layouts=layouts,errors=errors,chrome=browser.version,muted=True,base=base)
        (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(result,ensure_ascii=False),flush=True)
        assert not errors
    except Exception:
        page.screenshot(path=str(out/'failed.png'))
        raise
    finally:browser.close()
