"""Record the actual cinematic transition; muted, public read-only snapshot API."""
import asyncio,json,sys,time
from pathlib import Path
from urllib.parse import urlencode,urlsplit
import requests
from playwright.async_api import async_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1];label,base=sys.argv[1:3]
out=root/'tmp/drone-warp'/label;out.mkdir(parents=True,exist_ok=True)
session=requests.Session();session.trust_env=False
async def run():
    errors=[];slow={'value':False}
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
        context=await browser.new_context(viewport={'width':1440,'height':1000},record_video_dir=str(out/'video'),record_video_size={'width':1440,'height':1000})
        began=time.monotonic();page=await context.new_page();video=page.video
        await page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});navigator.sendBeacon=()=>false")
        page.on('pageerror',lambda e:errors.append(str(e)[:300]))
        async def api(route):
            u=urlsplit(route.request.url)
            if route.request.method in ('GET','HEAD'):
                if u.path=='/api/realestate/buildings' and slow['value']:
                    slow['value']=False;await asyncio.sleep(4)
                r=await asyncio.to_thread(session.get,'http://127.0.0.1:8003'+u.path+('?' +u.query if u.query else ''),timeout=20)
                await route.fulfill(status=r.status_code,body=r.content,content_type='application/json')
            elif u.path=='/api/realestate/nearby':await route.fulfill(json={'items':[]})
            else:await route.abort()
        await page.route('**/api/**',api)
        try:
            q=urlencode({'complex':'26350:우동:1407:해운대두산위브더제니스','hour':12,'fps':1,'dronedebug':1})
            await page.goto(base+'/drone-explore?'+q,wait_until='domcontentloaded')
            await page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
            await page.get_by_role('combobox',name='드론뷰 장소 및 주소 검색').fill('망미초등학교')
            options=page.locator('.re-drone-place-search').get_by_role('option')
            await options.first.click(timeout=30000)
            slow['value']=True;start=time.monotonic()-began
            await page.locator('.re-drone-place-go').click()
            warp=page.get_by_role('dialog',name='드론뷰 워프 이동');await warp.wait_for(state='visible')
            await page.wait_for_timeout(450);await page.screenshot(path=str(out/'charging.png'))
            await page.wait_for_timeout(750);await page.screenshot(path=str(out/'ignition.png'))
            await page.wait_for_timeout(1400);await page.screenshot(path=str(out/'warp.png'))
            visual=await page.locator('.drone-warp-stars').evaluate('(e)=>({canvas:[e.width,e.height],...e.dataset})')
            assert visual['canvas']==[1440,1000],visual
            tunnel=await page.locator('.drone-warp-tunnel').evaluate('(e)=>({canvas:[e.width,e.height],...e.dataset})')
            assert tunnel['renderer']=='webgl' and tunnel['canvas']==[1440,1000],tunnel
            await page.wait_for_function("document.querySelector('.drone-warp.is-revealing')",timeout=120000)
            assert await page.evaluate('window.__holoNative.shown && window.__holoNative.frameNo>0')
            await page.wait_for_timeout(90);await page.screenshot(path=str(out/'arrival-flash.png'))
            await warp.wait_for(state='detached');await page.screenshot(path=str(out/'arrival.png'))
            report={'clipStartSeconds':start,'warpSeconds':time.monotonic()-began-start,'visual':visual,'tunnel':tunnel,'actualFrameBeforeReveal':True,'errors':errors,'muted':True,'chrome':browser.version}
            await context.close();report['video']=await video.path()
            (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
            print(json.dumps(report,ensure_ascii=False),flush=True);assert not errors
        finally:await browser.close()
asyncio.run(run())
