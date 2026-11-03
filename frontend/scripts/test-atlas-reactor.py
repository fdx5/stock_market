"""Isolated browser fixtures: all API traffic intercepted; no database access."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT=Path(__file__).resolve().parents[2]/'tmp'/'atlas-reactor-qa'
OUT.mkdir(parents=True,exist_ok=True)
definitions=[('client','사용자 경험','client'),('graphics','그래픽 엔진','client'),('gateway','API 게이트웨이','gateway'),('market','시장 데이터','service'),('community','커뮤니티','service'),('realestate','부동산','service'),('prediction','AI 예측','service'),('operations','운영','service'),('support','지원','service'),('cache','캐시','storage'),('database','데이터베이스','storage'),('estate-db','부동산 DB','storage'),('ext-market','시장 공급자','external'),('ext-content','콘텐츠 공급자','external'),('ext-spatial','공간 정보','external'),('ext-ai','AI 제공자','external'),('ext-delivery','알림 전송','external'),('ext-pay','결제','external')]
nodes=[dict(id=id,label=label,kind=kind,subtitle=label,color=['#bf85ff','#5be3dc','#ff9dcf'][i%3],description=label+' 서비스의 선언된 연결과 실제 요청 상태를 확인합니다.',modules=['app.services.'+id],endpoint_count=24+i*5,hosts=[],tables=[]) for i,(id,label,kind) in enumerate(definitions)]
edges=[dict(id='edge-'+n['id'],source='gateway',target=n['id'],protocol='HTTP / JSON',kind='api',evidence='fixture') for n in nodes if n['id']!='gateway']
edges += [dict(id='extra-'+str(i),source=a,target=b,protocol='HTTPS',kind='external',evidence='fixture') for i,(a,b) in enumerate([('market','ext-market'),('realestate','ext-spatial'),('prediction','ext-ai'),('community','database'),('market','cache'),('operations','ext-delivery'),('realestate','estate-db')])]
graph=dict(nodes=nodes,edges=edges,modules=[],endpoints=[],backend_dependencies={},frontend={},coverage=dict(architecture='fixture',traffic='fixture',limitations=[]))
stats=dict(count=1234,errors=2,client_errors=0,avg_ms=46,last_at=time.time())
live=dict(at=time.time(),active_sessions=12,observed_edges={e['id']:10 for e in edges},api=dict(**stats,window_s=60,window_truncated=False,groups={n['id']:stats for n in nodes},endpoints=[],recent=[dict(id=i,ts=time.time()-i,route='/api/market/summary',method='GET',status=200 if i%4 else 503,ms=34+i) for i in range(12)],breakdown=dict(timeline=[dict(**{**stats,'count':(i*17)%49},at=time.time()-60+i) for i in range(60)],latency=[],status={})),external=dict(**stats,started_at=time.time(),window_s=60,window_truncated=False,groups={},hosts=[],recent=[]),cache=dict(entries=153,fresh=150,stale=3,refreshing=0,capacity=200),database=dict(mode='sqlite',separate_realestate=False,realestate_mode='sqlite'))
health=dict(memory_mb=482,commit='fixture',uptime_s=12345,db=dict(ok=True,ms=1),gates=[],threads=[],logs=[],admin_cache=[],realestate={},errors_last_hour=0,warnings_last_hour=0)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    context=browser.new_context(viewport=dict(width=1720,height=1200),device_scale_factor=1)
    context.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'fixture-only',expires_at:Date.now()/1000+3600}));")
    state={'offline':False}
    def api(route):
        url=route.request.url
        if '/atlas/snapshot' in url:
            if state['offline']:return route.fulfill(status=503,json={'detail':'fixture offline'})
            return route.fulfill(json={**live,'at':time.time()})
        if '/atlas/architecture' in url:return route.fulfill(json=graph)
        if '/atlas/health' in url:return route.fulfill(json=health)
        return route.fulfill(json={'ok':True,'count':0,'items':[],'events':[]})
    context.route('http://127.0.0.1:5198/api/**',api)
    page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:5198/admin/system-atlas')
    page.wait_for_timeout(8000)
    page.locator('.ar-reactor').wait_for(timeout=15000)
    page.locator('.ar-reactor').scroll_into_view_if_needed()
    page.wait_for_timeout(1800)
    page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
    perf=page.evaluate('''async()=>{const frames=[];let prev=performance.now();await new Promise(resolve=>{function tick(t){frames.push(t-prev);prev=t;if(frames.length<600)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);}); const sorted=[...frames].sort((a,b)=>a-b);const seconds=[];let elapsed=0,count=0;for(const dt of frames){elapsed+=dt;count++;if(elapsed>=1000){seconds.push(count*1000/elapsed);elapsed=0;count=0;}}return {fps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length),min_one_second_fps:Math.min(...seconds),p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],max:Math.max(...frames),dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],canvas:[document.querySelector('.ar-stage canvas').width,document.querySelector('.ar-stage canvas').height]}}''')
    page.get_by_role('textbox',name='노드 검색').fill('부동산')
    assert page.locator('.ar-node-list>button').count()==2
    page.locator('.ar-node-list>button').first.click()
    assert '부동산' in page.locator('.ar-inspector h2').inner_text()
    page.get_by_role('textbox',name='노드 검색').fill('no-match-xyz')
    assert page.locator('.ar-node-list>button').count()==0
    page.get_by_role('textbox',name='노드 검색').fill('')
    page.get_by_role('button',name='연결 집중',exact=True).click()
    page.get_by_role('button',name='모션 ON',exact=True).click()
    page.wait_for_timeout(200)
    assert 'STILL' in page.locator('.ar-stage-top').inner_text()
    page.get_by_role('button',name='모션 OFF',exact=True).click()
    page.get_by_role('button',name='연결 집중',exact=True).click()
    page.set_viewport_size(dict(width=390,height=844))
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'mobile overflow'
    page.emulate_media(reduced_motion='reduce');page.wait_for_timeout(200)
    assert page.get_by_role('button',name='모션 OFF',exact=True).is_disabled()
    assert 'STILL' in page.locator('.ar-stage-top').inner_text()
    state['offline']=True
    page.wait_for_timeout(4000)
    assert 'SIGNAL DELAYED' in page.locator('.ar-heading-meta').inner_text()
    assert not errors,errors
    result={'desktop_performance':perf,'interactions':'passed','mobile_overflow':False,'reduced_motion':'passed','offline':'passed','page_errors':errors}
    (OUT/'results.json').write_text(json.dumps(result,indent=2),encoding='utf8')
    print(json.dumps(result))
    browser.close()
