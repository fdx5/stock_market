"""Muted Chrome real VWorld autocomplete and coordinate travel, no application DB."""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit, parse_qs
import time
import requests
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1]
label,base=sys.argv[1:3]
out=root/'tmp/drone-place-search'/label
out.mkdir(parents=True,exist_ok=True)
session=requests.Session();session.trust_env=False
errors=[]; results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});navigator.sendBeacon=()=>false")
    def api(route):
        u=urlsplit(route.request.url)
        if route.request.method in ('GET','HEAD'):
            r=session.get('http://127.0.0.1:8003'+u.path+('?' + u.query if u.query else ''),timeout=20)
            route.fulfill(status=r.status_code,body=r.content,content_type='application/json')
        elif u.path=='/api/realestate/nearby':route.fulfill(json={'items':[]})
        else:route.abort()
    page.route('**/api/**',api)
    page.on('pageerror',lambda e:errors.append(str(e)[:300]))
    try:
        q=urlencode({'complex':'26350:우동:1407:해운대두산위브더제니스','hour':12,'fps':1,'dronedebug':1})
        page.goto(base+'/drone-explore?'+q,wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
        search=page.get_by_role('combobox',name='드론뷰 장소 및 주소 검색')
        go=page.get_by_role('button',name='이동',exact=True)
        assert go.is_disabled()
        cdp=page.context.new_cdp_session(page)
        for query in ['강남데시앙','한성기린','수영구','망미초등학교','마린시티2로 33','부산광역시 수영구 망미동 209-4']:
            search.fill(query)
            if query=='강남데시앙':
                search.fill('');search.focus()
                cdp.send('Input.imeSetComposition',{'text':query,'selectionStart':len(query),'selectionEnd':len(query)})
            page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=60000)
            entries=page.get_by_role('option')
            assert entries.count()>0,query+': no autocomplete result'
            texts=entries.all_text_contents()
            if query=='강남데시앙':
                assert '데시앙' in texts[0] and '동 ' in texts[0],texts
                # Commit after observing results; no Space was used to search.
                cdp.send('Input.insertText',{'text':query})
            results.append({'query':query,'count':len(texts),'items':texts})
            assert go.is_disabled(),'Typing navigated without selecting'
            page.screenshot(path=str(out/f'search-{len(results)}.png'))
            before=page.url
            entries.first.click()
            assert page.url==before,'Selecting navigated before pressing 이동'
            assert go.is_enabled()
        # Keyboard completion, Escape closes only the search, typing does not fly.
        search.fill('망미초등학교')
        page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=60000)
        search.press('ArrowDown');search.press('Enter')
        assert go.is_enabled()
        search.fill('한성기린');search.press('Escape')
        assert not page.locator('.re-drone-place-popup').count()
        assert '/drone-explore' in page.url and page.evaluate('!!window.__drone')
        assert not page.evaluate('window.__drone.flight.keys.size')
        # Controlled public-provider responses cover IME, late JSONP cancellation,
        # partial errors, retries, empty responses and the six-second deadline.
        fixture_calls=[]
        def fixture(route):
            params=parse_qs(urlsplit(route.request.url).query)
            query=params['query'][0];kind=params['type'][0];cb=params['callback'][0]
            fixture_calls.append((query,kind))
            item={'id':query,'title':query+'학교','address':{'road':'부산광역시 수영구 망미동'},'point':{'x':'129.104','y':'35.174'}}
            body={'response':{'status':'OK','result':{'items':[item]}}} if kind=='PLACE' else {'response':{'status':'NOT_FOUND'}}
            if query=='부분검증' and kind=='ADDRESS':body={'response':{'status':'ERROR'}}
            code=cb+'('+json.dumps(body,ensure_ascii=False)+');'
            if query=='느린검증':code='setTimeout(()=>{'+code+'},1800);'
            if query=='기한검증' and kind=='PLACE':code='/* deliberately unanswered independent QA request */'
            route.fulfill(body=code,content_type='application/javascript')
        pattern='**/req/search?**'
        page.route(pattern,fixture)
        search.dispatch_event('compositionstart');search.fill('조합검ㅈ');page.wait_for_timeout(550)
        assert not fixture_calls,'Korean composition sent an unfinished query'
        search.fill('조합검증');page.wait_for_timeout(550)
        page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=10000)
        assert page.get_by_role('option').count()==1 and fixture_calls
        search.dispatch_event('compositionend')
        search.fill('부분검증')
        page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=10000)
        assert page.get_by_role('option').count()==1
        assert '일부 검색 응답' in page.locator('.re-drone-place-popup').inner_text()
        count=len(fixture_calls);page.get_by_role('button',name='다시 검색',exact=True).click()
        page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=10000)
        assert len(fixture_calls)>count
        search.fill('느린검증');page.wait_for_timeout(550)
        assert len([x for x in fixture_calls if x[0]=='느린검증'])==2,'Search exceeded its two-request concurrency limit'
        search.fill('새검증')
        page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=10000)
        page.wait_for_timeout(1900)
        assert '새검증학교' in page.get_by_role('option').all_text_contents()[0]
        assert '느린검증' not in page.locator('.re-drone-place-popup').inner_text()
        start=time.monotonic();search.fill('기한검증')
        page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=12000)
        deadline=time.monotonic()-start
        assert 5.5<deadline<12 and page.get_by_role('button',name='다시 검색',exact=True).is_visible()
        assert page.evaluate("[...document.scripts].filter(s=>s.src.includes('/req/search?')).length")==0,'Completed/aborted JSONP scripts leaked'
        page.unroute(pattern,fixture)
        # Real school, district and parcel destinations all rebuild at their
        # provider point. Revisit and history also release the previous session.
        warps=[]
        def travel(query=None,history=None):
            if query:
                search.fill(query);search.click()
                page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=60000)
                page.get_by_role('option').first.click()
            page.evaluate('window.__qaOldDrone=window.__drone;window.__qaOldCanvas=window.__holoNative.canvas')
            started=time.monotonic()
            if history:page.evaluate('history.'+history+'()')
            else:
                go.click()
                page.get_by_role('dialog',name='드론뷰 워프 이동').wait_for(state='visible',timeout=3000)
                page.wait_for_timeout(800)
                page.screenshot(path=str(out/f'warp-{len(warps)+1}.png'))
            page.wait_for_function("window.__drone !== window.__qaOldDrone && window.__holoNative?.shown && document.querySelector('.re-drone-autopilot')",timeout=120000)
            background_ready=time.monotonic()-started
            if not history:
                page.wait_for_function("!document.querySelector('.drone-warp')",timeout=125000)
                duration=time.monotonic()-started
                assert duration>=4.8,'Warp vanished before its five-second animation'
                warps.append({'seconds':duration,'backgroundSceneReadySeconds':background_ready,'revealedReadyScene':True})
            point=page.evaluate('''()=>{const q=new URLSearchParams(location.search),d=window.__drone;return{target:{lat:+q.get('lat'),lon:+q.get('lon')},origin:d.p.data.center,where:d.where(),title:d.p.data.name,canvasReplaced:window.__holoNative.canvas!==window.__qaOldCanvas,oldCanvasDetached:!document.contains(window.__qaOldCanvas),oldSessionEnded:window.__qaOldDrone.ended};}''')
            for key in ['lat','lon']:
                assert abs(point['origin'][key]-point['target'][key])<1e-6,point
                assert abs(point['where'][key]-point['target'][key])<1e-6,point
            assert point['canvasReplaced'] and point['oldCanvasDetached'] and point['oldSessionEnded'],point
            return point
        destinations=[travel(query) for query in ['망미초등학교','수영구','부산광역시 수영구 망미동 209-4']]
        point=destinations[-1]
        destinations.append(travel()) # Same destination still reloads on 이동.
        destinations.append(travel(history='back'));destinations.append(travel(history='forward'))
        page.screenshot(path=str(out/'mangmi-destination.png'))
        layouts=[]
        for size in [{'width':390,'height':844},{'width':844,'height':390}]:
            page.set_viewport_size(size);page.wait_for_timeout(500)
            search.fill('망미초등학교')
            search.click()
            page.wait_for_function("!document.querySelector('.re-drone-place-popup')?.textContent.includes('검색 중…')",timeout=60000)
            for control in [search,go,page.locator('.re-drone-place-popup')]:
                b=control.bounding_box()
                assert b and b['x']>=0 and b['y']>=0 and b['x']+b['width']<=size['width']+1 and b['y']+b['height']<=size['height']+1,b
            page.screenshot(path=str(out/f"search-{size['width']}.png"))
            layouts.append(size);search.press('Escape')
        report={'searches':results,'destinations':destinations,'warps':warps,'providerFailureChecks':{'composition':True,'partialRetry':True,'lateCancellation':True,'deadlineSeconds':deadline,'remainingScripts':0},'layouts':layouts,'errors':errors,'muted':True,'chrome':browser.version}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(report,ensure_ascii=False),flush=True)
        assert not errors
    except Exception:
        page.screenshot(path=str(out/'failure.png'))
        (out/'partial-report.json').write_text(json.dumps({'searches':results,'errors':errors},ensure_ascii=False,indent=2),encoding='utf8')
        raise
    finally:browser.close()
