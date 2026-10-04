import asyncio, json, time, re
from pathlib import Path
from urllib.parse import urlsplit, urlencode, parse_qs
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:5178'
HOME = '41150:\ud638\uc6d0\ub3d9:401-1:\uc2e0\ub3c46'
async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu','--remote-debugging-port=9227'])
        page = await browser.new_page(viewport={'width':1440,'height':900})
        errors, samples, logs = [], [], []
        game_phase = False
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: logs.append(m.text) if '[drive]' in m.text or 'Model build failed' in m.text else None)
        async def api(route):
            u = urlsplit(route.request.url)
            if game_phase and u.path in ['/api/realestate/water','/api/realestate/crossings']:
                await route.fulfill(json={'rings':[], 'crossings':[], 'points':[], 'signals':[], 'source':None}); return
            if game_phase and u.path == '/api/realestate/nearby':
                await route.fulfill(json={'id':route.request.post_data_json['id'],'items':[]}); return
            if route.request.method == 'POST' and u.path == '/api/realestate/nearby':
                body = route.request.post_data_json
                if body['id'].startswith('pt:'): body['id'] = HOME
                response = await route.fetch(url='https://kospimap.com'+u.path, post_data=json.dumps(body), timeout=90000)
                await route.fulfill(response=response)
            elif route.request.method == 'GET':
                try:
                    response = await route.fetch(url='https://kospimap.com'+u.path+('?' +u.query if u.query else ''), timeout=15000)
                    await route.fulfill(response=response)
                except:
                    try: await route.abort()
                    except: pass
            else: await route.fulfill(status=204)
        await page.route(BASE+'/api/**', api)
        query = urlencode({'sido':'41','period':'3m','sgg':'41150','dong':'\ud638\uc6d0\ub3d9','complex':HOME,'area':'60','3d':'1','devgame':'1'})
        await page.goto(BASE+'/realestate-map?'+query, wait_until='domcontentloaded')
        print('opened',flush=True)
        await page.wait_for_function('!!window.__holoStage?.traffic && !window.__holoStage.unshown', timeout=120000)
        print('scene ready',flush=True)
        game_phase = True
        async def regional_fixture(route):
            q=parse_qs(urlsplit(route.request.url).query);callback=q.get('callback',[''])[0]
            if not callback: await route.continue_(); return
            coords=[float(v) for v in re.findall(r'-?\d+(?:\.\d+)?',q.get('geomFilter',[''])[0])]
            lon,lat=((coords[0]+coords[2])/2,(coords[1]+coords[3])/2) if len(coords)==4 else (127.04,37.73)
            features=[]
            layer=q.get('data',[''])[0]
            if layer=='LT_C_BLDGINFO' and '02000' not in q.get('attrFilter',[''])[0]:
                ring=[[lon+.001,lat+.0005],[lon+.0014,lat+.0005],[lon+.0014,lat+.0008],[lon+.001,lat+.0008],[lon+.001,lat+.0005]]
                features=[{'type':'Feature','properties':{'height':15,'grnd_flr':5,'bld_nm':'Fixture building','usability':'01000'},'geometry':{'type':'Polygon','coordinates':[ring]}}]
            elif layer=='LT_L_N3A0020000':
                features=[{'type':'Feature','properties':{'rvwd':14,'rdln':4},'geometry':{'type':'LineString','coordinates':[[lon-.008,lat],[lon+.008,lat]]}}]
            result=[{'structure':{'level2':'Fixture region'}}] if 'address' in route.request.url else {'featureCollection':{'features':features}}
            await route.fulfill(content_type='application/javascript',body=callback+'('+json.dumps({'response':{'status':'OK','result':result}})+');')
        await page.route('https://api.vworld.kr/req/**', regional_fixture)
        before = await page.evaluate('({...document.querySelector(".re-holo-stage").dataset})')
        await page.locator('button[title^="\ud14c\uc2ac\ub77c \uc0ac\uc774\ubc84\ud2b8\ub7ed"]').click()
        print('game clicked',flush=True)
        await page.wait_for_function('!!window.__holoStage?.drive', timeout=15000)
        await page.wait_for_timeout(2500)
        await page.evaluate('''window.__gameFrames=[];window.__gameRun=true;let prev=performance.now();function track(t){if(!window.__gameRun)return;window.__gameFrames.push(t-prev);prev=t;requestAnimationFrame(track)}requestAnimationFrame(track);''')
        for _ in range(10):
            await page.wait_for_timeout(1000)
            samples.append(await page.evaluate('''()=>{let s=window.__holoStage,d=s?.drive,c=s?.traffic?.hero(d?.name);return{data:{...document.querySelector('.re-holo-stage').dataset},fuel:d?.fuel,hp:d?.hp,x:c?.x,y:c?.y,carry:!!s?.carry}}'''))
        assert samples[-1]['fuel'] > 0
        print('steady frames collected',flush=True)
        assert float(samples[-1]['data']['pixelRatio']) <= 1.35
        # Force the state reported in the bug, then use the real repair button.
        await page.evaluate("let d=window.__holoStage.drive;d.fuel=0;d.blowUp('fuel')")
        repair = page.locator('.re-drive-done.is-wreck button')
        await repair.wait_for(timeout=15000)
        await repair.click()
        print('repaired',flush=True)
        await page.wait_for_timeout(500)
        assert await page.evaluate('window.__holoStage.drive.fuel > 0 && !window.__holoStage.drive.dead')
        await page.keyboard.down('ArrowUp')
        await page.evaluate('''()=>{let s=window.__holoStage,d=s.drive,c=s.traffic.hero(d.name);d.hurt=()=>{};d.fuel=d.fuelCap=10000;d.sim.step=()=>{};s.wetAt=null;c.x=280;c.y=0;c.hx=1;c.hy=0;c.speed=0;window.__priorDrive=d;window.__priorModel=s.model;}''')
        transitions=[]
        for _ in range(35):
            await page.wait_for_timeout(1000)
            state=await page.evaluate('''()=>{const s=window.__holoStage,d=s.drive,c=s.traffic?.hero(d?.name);return{drive:!!d,changed:d!==window.__priorDrive,modelChanged:s.model!==window.__priorModel,carry:!!s.carry,keys:d?.keys,fuel:d?.fuel,hp:d?.hp,x:c?.x,y:c?.y,scene:{...document.querySelector('.re-holo-stage').dataset}}}''')
            transitions.append(state)
            print('transition', {k:state.get(k) for k in ['drive','changed','carry','x','y']},flush=True)
            if state['changed'] and not state['carry']: break
        await page.keyboard.up('ArrowUp')
        await page.screenshot(path='tmp/drive-game-review.png')
        result = {'before':before,'samples':samples,'transitions':transitions,'frames':await page.evaluate('window.__gameFrames'),'errors':errors,'logs':logs}
        Path('tmp/drive-game-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        assert not errors, errors
        assert any(s['changed'] and s['drive'] and s['keys']['up'] for s in transitions), 'handover did not preserve throttle key'
        await page.evaluate("localStorage.setItem('kospimap.devgame','1'); let u=new URL(location.href);u.searchParams.delete('devgame');history.pushState({},'',u);dispatchEvent(new PopStateEvent('popstate'))")
        await page.wait_for_timeout(300)
        assert await page.locator('button[title^="\ud14c\uc2ac\ub77c \uc0ac\uc774\ubc84\ud2b8\ub7ed"]').count() == 0
        assert await page.evaluate('window.__holoStage.drive===null')
        print('PASS: real scene, game quality, four-direction preparation, explode/repair; report saved',flush=True)
        await page.unroute_all(behavior='ignoreErrors')
        await browser.close()
asyncio.run(main())
