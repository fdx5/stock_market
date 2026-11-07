"""Headless UI test with synthetic API replies only; no app backend or DB."""
import json
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright,expect

BASE='http://127.0.0.1:5196'
OUT=Path(__file__).resolve().parents[2]/'tmp/community-links-qa';OUT.mkdir(parents=True,exist_ok=True)
def post(n):
    return {'id':f'pp-stock-{n}','title':f'미국 주식 투자와 나스닥 분석 {n}','url':f'https://www.ppomppu.co.kr/zboard/view.php?id=stock&no={n}','published_at':'2026-11-07T10:00:00+00:00','source_id':'pp-stock','source':'뽐뿌 · 증권포럼','language':'ko','topic':'시황','comments':None,'excerpt':'','excerpt_kind':'공개 원문 확인'}
def handler(route):
    u=urlsplit(route.request.url);q=parse_qs(u.query)
    if '/api/community/' in u.path:
        if u.path.endswith('/entry'):
            n=int(q['post_id'][0].rsplit('-',1)[1]);return route.fulfill(json={'post':post(n),'snapshot':'a'*32})
        if u.path.endswith('/post'):return route.fulfill(json={'status':'ok','blocks':[{'type':'paragraph','text':'공개 본문을 사이트 안에서 읽고 있습니다.'}]})
        if u.path.endswith('/comments'):return route.fulfill(json={'status':'unsupported'})
        if q.get('snapshot')==['f'*32]:return route.fulfill(status=409,json={})
        return route.fulfill(json={'snapshot':'a'*32,'items':[post(42),post(43)],'total':2,'page':1,'pages':1,'collected_at':'2026-11-07T10:00:00Z','checked_at':'2026-11-07T10:00:00Z','refreshing':False,'sources':[{'id':'pp-stock','name':'뽐뿌 · 증권포럼','status':'ok','count':2}]})
    if u.path.startswith('/api/'):return route.fulfill(status=503,json={})
    if u.hostname!='127.0.0.1':return route.abort()
    return route.continue_()

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    for width in [1440,390]:
        ctx=browser.new_context(viewport={'width':width,'height':1000 if width==1440 else 844},reduced_motion='reduce')
        ctx.route('**/*',handler)
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE+'/community/global?post_id=pp-stock-42&snapshot='+'f'*32,wait_until='domcontentloaded')
        expect(page.locator('.cf-reader h2')).to_have_text(post(42)['title'],timeout=30000)
        expect(page.locator('.cf-body-paragraph')).to_have_text('공개 본문을 사이트 안에서 읽고 있습니다.')
        expect(page.locator('.cf-error')).to_have_count(0)
        assert len(ctx.pages)==1
        if width==1440:
            page.locator('.cf-post').filter(has_text=post(43)['title']).click()
            expect(page.locator('.cf-reader h2')).to_have_text(post(43)['title'])
            assert 'post_id=pp-stock-43' in page.url
            page.go_back()
            expect(page.locator('.cf-reader h2')).to_have_text(post(42)['title'])
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('.cf-reader h2')).to_have_text(post(42)['title'],timeout=30000)
        expect(page.locator('.cf-body-paragraph')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not errors,errors
        page.screenshot(path=str(OUT/f'internal-reader-{width}.png'))
        page.get_by_role('button',name='읽기 닫고 목록으로 돌아가기').click()
        assert 'post_id=' not in page.url
        print(json.dumps({'width':width,'internal_reading':True,'expired_snapshot_recovered':True,'reload_same_post':True,'errors':errors}),flush=True)
        ctx.close()
    browser.close()
