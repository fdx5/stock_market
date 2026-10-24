"""Admin research analytics + visitor telemetry with all endpoints mocked."""
import json
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];BASE='http://127.0.0.1:5184';OUT=ROOT/'tmp/research-admin-qa';OUT.mkdir(parents=True,exist_ok=True)
fixture={'__file__':str(Path(__file__).with_name('test-all-research-services.py'))}
exec(Path(__file__).with_name('test-all-research-services.py').read_text(encoding='utf-8').split('with sync_playwright() as pw:')[0],fixture)
services=fixture['SERVICES']
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--mute-audio']);ctx=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    # This enables client telemetry only inside this fully mocked test context.
    ctx.add_init_script("Object.defineProperty(Navigator.prototype,'webdriver',{get:()=>false}); localStorage.setItem('admin_session',JSON.stringify({token:'synthetic-local-test',expires_at:4102444800}));")
    events=[];queries=[];errors=[]
    def route(r):
        if not r.request.url.startswith(BASE):r.abort();return
        u=urlsplit(r.request.url)
        if not u.path.startswith('/api/'):r.continue_();return
        if u.path=='/api/activity/event':events.append(r.request.post_data_json);r.fulfill(content_type='application/json',body='{"ok":true}');return
        if u.path=='/api/search':data=[{'code':'005930','name':'삼성전자','market':'KOSPI','asset_type':'STOCK'}]
        elif u.path=='/api/admin/research/stats':
            q=parse_qs(u.query);queries.append(q);selected=q.get('path',[''])[0]
            pages=[{'path':s['path'],'name':s['name'],'views':3,'sessions':2,'actions':4} for s in services if not selected or s['path']==selected]
            data={'days':int(q.get('days',['7'])[0]),'path':selected,'pages':pages,'actions':[{'path':pages[0]['path'],'action':'symbol_select','count':4,'sessions':2}],'trend':[{'day':'2026-10-25','views':3,'actions':4}],'recent':[{'at':'2026-10-25T00:00:00Z','path':pages[0]['path'],'action':'symbol_select','code':'005930','name':'삼성전자'}]}
        elif u.path.startswith('/api/admin/'):
            r.fulfill(status=503,content_type='application/json',body='{"detail":"Unrelated admin source is offline in isolated QA"}');return
        else:data=fixture['payload'](r.request.url)
        r.fulfill(content_type='application/json',body=json.dumps(data,ensure_ascii=False))
    ctx.route('**/*',route);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE+'/stock-context');picker=page.locator('.rs-context [role=combobox]');picker.fill('삼성');page.locator('[role=option]').click()
    page.get_by_role('button',name='종목 적용',exact=True).click();page.wait_for_timeout(250)
    assert any(e.get('label')=='내 종목의 체감선' for e in events if e['type']=='page_view')
    assert any(e.get('object_key')=='research:symbol_select' and e.get('stock_code')=='005930' for e in events)
    assert any(e.get('object_key')=='research:symbol_apply' for e in events)
    assert not any(e.get('label')=='기타' for e in events)
    page.goto(BASE+'/bond-tradeoffs');page.get_by_label('A 가격',exact=True).fill('9876543.21');page.get_by_label('A 쿠폰(연 %)',exact=True).click();page.wait_for_timeout(250)
    assert '9876543.21' not in json.dumps(events,ensure_ascii=False)
    assert any(e.get('object_key')=='research:assumption_change' for e in events)
    page.goto(BASE+'/decision-brief');page.get_by_label('아직 확인할 질문',exact=True).fill('PRIVATE_MEMO_987654');page.locator('h1').click()
    assert 'PRIVATE_MEMO_987654' not in json.dumps(events,ensure_ascii=False)
    before=len(events);page.goto(BASE+'/admin/dashboard#traffic')
    panel=page.locator('.ars-panel');expect(panel).to_be_visible(timeout=20000)
    expect(panel.locator('.ars-table').first.locator('tbody tr')).to_have_count(36)
    panel.locator('.ars-controls select').nth(1).select_option('/stock-context')
    expect(panel.locator('.ars-table').first.locator('tbody tr')).to_have_count(1)
    panel.locator('.ars-controls select').first.select_option('30')
    expect(panel.locator('.ars-note').first).to_contain_text('30일')
    panel.locator('summary').click();expect(panel.locator('.ars-recent')).to_contain_text('삼성전자')
    assert len(events)==before
    panel.scroll_into_view_if_needed();page.screenshot(path=str(OUT/'admin-research-desktop.png'),full_page=False)
    page.set_viewport_size({'width':390,'height':844});assert page.locator('.ars-panel').evaluate('el=>el.getBoundingClientRect().right<=innerWidth+1')
    assert not errors,errors
    (OUT/'result.json').write_text(json.dumps({'telemetry_events':len(events),'queries':queries,'errors':errors,'data':'synthetic; no existing DB or production analytics calls'},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':True,'telemetry_events':len(events),'admin_queries':len(queries)}))
    browser.close()
