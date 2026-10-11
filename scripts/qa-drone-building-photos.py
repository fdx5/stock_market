"""Actual widget interactions with isolated fixture API/images; no persisted data."""
import json
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
port=int(sys.argv[1]);label=sys.argv[2]
out=root/'tmp/coast-review-20261010'/label;out.mkdir(parents=True,exist_ok=True)
origin=f'http://127.0.0.1:{port}'
mode='wiki';errors=[];checked=[]
svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700"><rect width="400" height="700" fill="#52677b"/><rect x="80" y="40" width="240" height="630" fill="#c6ced5"/></svg>'
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})")
        page.on('pageerror',lambda e:errors.append(str(e)[:500]))
        def route(r):
            url=r.request.url
            if url.startswith('https://fixture.invalid/'):
                if 'bad-full' in url or ('/broken-wiki/' in url and url.rsplit('/',1)[-1].startswith('wiki-')):return r.fulfill(status=404,body='not found')
                return r.fulfill(status=200,content_type='image/svg+xml',body=svg)
            if '/api/realestate/building-info' in url:
                wiki=None if mode=='no-wiki' else {'thumb':'https://fixture.invalid/wiki-thumb','image':'https://fixture.invalid/bad-full' if mode=='thumb-fallback' else 'https://fixture.invalid/wiki-full','url':'https://ko.wikipedia.org/wiki/Fixture','extract':'Isolated building history fixture'}
                card={'name':'Fixture','register':None,'wiki':wiki,'photos':[
                    {'thumb':'https://fixture.invalid/search-thumb','image':'https://fixture.invalid/search-full','site':'건물 안내','link':'https://official.example/building'},
                    {'thumb':'https://fixture.invalid/blog-thumb','site':'네이버 블로그','link':'https://blog.naver.com/unrelated'}]}
                card=json.loads(json.dumps(card).replace('https://fixture.invalid/','https://fixture.invalid/'+mode+'/'))
                return r.fulfill(status=200,content_type='application/json',body=json.dumps(card))
            if '/api/' in url and not url.startswith((origin+'/', 'http://127.0.0.1:8003/')):return r.abort()
            r.continue_()
        page.route('**/*',route)
        page.goto(origin+'/drone-review/haeundae',wait_until='domcontentloaded')
        page.wait_for_function('window.__drone?.signs?.boxes?.some(b=>b.s.kind!=="station"&&b.s.name.length>=2)',timeout=90000)
        for mode,expected in [('wiki','wiki-full'),('thumb-fallback','wiki-thumb'),('broken-wiki','search-full'),('no-wiki','search-full')]:
            point=page.evaluate('''()=>{const d=window.__drone,r=d.signs.canvas.getBoundingClientRect(),b=d.signs.boxes.find(b=>b.s.kind!=='station'&&b.s.name.length>=2&&b.y>100&&b.x>220&&b.x<900);if(!b)throw Error('No clickable sign');return{x:r.left+b.x+b.w/2,y:r.top+b.y+b.h/2};}''')
            page.mouse.click(point['x'],point['y'])
            page.wait_for_selector('.re-drone-card',timeout=10000)
            page.wait_for_function('suffix=>{const i=document.querySelector(".re-drone-card-hero img");return i?.src.endsWith(suffix)&&i.complete&&i.naturalWidth>0;}',arg=expected,timeout=60000)
            result=page.evaluate('''()=>{const i=document.querySelector('.re-drone-card-hero img');return {src:i.src,fit:getComputedStyle(i).objectFit,photos:document.querySelectorAll('.re-drone-card-strip img').length,blog:!!document.querySelector('.re-drone-card-strip img[src*="blog"]')};}''')
            assert result['fit']=='contain' and not result['blog'],result
            checked.append({'mode':mode,**result})
            page.screenshot(path=str(out/(mode+'.png')))
            page.locator('.re-drone-card-x').click()
            page.wait_for_selector('.re-drone-card',state='detached')
        assert not errors,errors
        (out/'report.json').write_text(json.dumps({'checks':checked,'errors':errors,'fixtureSources':True},indent=2),encoding='utf8')
        print(json.dumps({'passed':len(checked),'errors':errors}),flush=True)
    except Exception:
        page.screenshot(path=str(out/'failed.png'))
        print(json.dumps({'mode':mode,'widget':page.evaluate("document.querySelector('.re-drone-card')?.innerText??null"),'hero':page.evaluate("document.querySelector('.re-drone-card-hero img')?.src??null"),'errors':errors},ensure_ascii=True),flush=True)
        raise
    finally:
        browser.close()
