"""Muted Chrome warp: delayed/read-only map configuration, retry and cancellation."""
import asyncio,json,sys,time
from pathlib import Path
from urllib.parse import urlencode,urlsplit
import requests
from playwright.async_api import async_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1]
label,base=sys.argv[1:3]
out=root/'tmp/drone-warp'/label;out.mkdir(parents=True,exist_ok=True)
session=requests.Session();session.trust_env=False

async def run():
    errors=[];checks=[];mode={'value':'normal'}
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
        page=await browser.new_page(viewport={'width':1440,'height':1000})
        await page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});navigator.sendBeacon=()=>false")
        async def api(route):
            u=urlsplit(route.request.url)
            if route.request.method in ('GET','HEAD'):
                if u.path=='/api/realestate/buildings' and mode['value']=='fail':
                    await route.fulfill(json={'found':False,'buildings':[]});return
                if u.path=='/api/realestate/buildings' and mode['value']=='slow':
                    mode['value']='normal';await asyncio.sleep(8)
                r=await asyncio.to_thread(session.get,'http://127.0.0.1:8003'+u.path+('?' +u.query if u.query else ''),timeout=20)
                await route.fulfill(status=r.status_code,body=r.content,content_type='application/json')
            elif u.path=='/api/realestate/nearby':await route.fulfill(json={'items':[]})
            else:await route.abort()
        await page.route('**/api/**',api)
        page.on('pageerror',lambda e:errors.append(str(e)[:300]))
        try:
            q=urlencode({'complex':'26350:우동:1407:해운대두산위브더제니스','hour':12,'fps':1,'dronedebug':1})
            await page.goto(base+'/drone-explore?'+q,wait_until='domcontentloaded')
            await page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
            search=page.get_by_role('combobox',name='드론뷰 장소 및 주소 검색')
            go=page.get_by_role('button',name='이동',exact=True)
            warp=page.get_by_role('dialog',name='드론뷰 워프 이동')
            async def select(query):
                await search.fill(query);await search.click()
                await page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=60000)
                await page.get_by_role('option').first.click()
            await select('망미초등학교');mode['value']='slow'
            started=time.monotonic();await go.click()
            await warp.wait_for(state='visible',timeout=3000)
            await page.wait_for_timeout(2700)
            await page.screenshot(path=str(out/'warp-desktop.png'))
            visual=await page.locator('.drone-warp-stars').evaluate('(e)=>({canvas:[e.width,e.height],motion:e.dataset.motion,drawMaxMs:e.dataset.drawMaxMs,draws:e.dataset.draws,pixelRatio:e.dataset.pixelRatio})')
            assert visual['canvas'][0]>=1440 and visual['canvas'][1]>=1000 and visual['motion']=='animated',visual
            checks.append({'case':'cinematic star tunnel','visual':visual})
            await page.wait_for_timeout(2800)
            assert await warp.get_attribute('data-phase')=='arriving'
            assert '준비하고' in await warp.inner_text(),'Unready destination was revealed after five seconds'
            await page.wait_for_function("!document.querySelector('.drone-warp')",timeout=120000)
            checks.append({'case':'delayed destination','seconds':time.monotonic()-started,'heldUntilActualFrame':True})
            # Each of the existing bounded data attempts gets a safe public-config
            # failure. The native dialog must offer retry, not a blank scene.
            mode['value']='fail';await go.click()
            await page.wait_for_function("document.querySelector('.drone-warp')?.textContent.includes('다시 시도')",timeout=15000)
            await page.screenshot(path=str(out/'warp-retry.png'))
            mode['value']='normal';await warp.get_by_role('button',name='다시 시도',exact=True).click()
            await page.wait_for_function("!document.querySelector('.drone-warp')",timeout=120000)
            checks.append({'case':'failed destination','retryRestoredActualScene':True})
            before=page.url;await select('수영구');await go.click()
            await page.wait_for_timeout(400);await page.keyboard.press('Escape')
            await page.wait_for_function("!document.querySelector('.drone-warp')",timeout=5000)
            assert page.url==before,'Escape closed the explorer instead of cancelling travel'
            await page.wait_for_function("window.__drone && !window.__drone.ended && window.__holoNative?.shown && document.querySelector('.re-drone-autopilot')",timeout=90000)
            checks.append({'case':'Escape cancellation','returnedToPreviousLocation':True})
            for size,reduced in [({'width':390,'height':844},True),({'width':844,'height':390},False)]:
                await page.set_viewport_size(size)
                await page.emulate_media(reduced_motion='reduce' if reduced else 'no-preference')
                await go.click();await page.wait_for_timeout(800)
                assert await warp.is_visible()
                cancel=page.get_by_role('button',name='이동 취소',exact=True)
                b=await cancel.bounding_box()
                assert b and b['x']>=0 and b['y']>=0 and b['x']+b['width']<=size['width']+1 and b['y']+b['height']<=size['height']+1,b
                if reduced:
                    assert await page.locator('.drone-warp-nebula').first.evaluate('(e)=>getComputedStyle(e).animationName')=='none'
                    assert await page.locator('.drone-warp-stars').get_attribute('data-motion')=='reduced'
                await page.screenshot(path=str(out/f"warp-{size['width']}.png"))
                await page.wait_for_function("!document.querySelector('.drone-warp')",timeout=120000)
                checks.append({'case':'mobile','size':size,'reducedMotion':reduced,'controlsVisible':True})
            report={'checks':checks,'errors':errors,'muted':True,'chrome':browser.version}
            (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
            print(json.dumps(report,ensure_ascii=False),flush=True)
            assert not errors
        except Exception:
            await page.screenshot(path=str(out/'failure.png'))
            (out/'partial-report.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf8')
            raise
        finally:await browser.close()
asyncio.run(run())
