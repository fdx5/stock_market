"""Large topology and both monitor access paths, using only local mocked APIs."""
from pathlib import Path
fixture_script=Path(__file__).with_name('test-synapse-observatory.py')
ns={'__file__':str(fixture_script)}
exec(compile(fixture_script.read_text(encoding='utf-8').split('\nwith sync_playwright() as p:')[0],str(fixture_script),'exec'),ns)
import copy
import json
import os
import time
from playwright.sync_api import sync_playwright, expect
from app.services import site_graph

base=os.environ.get('TEST_BASE_URL','http://127.0.0.1:5198')
output=ns['OUT']; original=ns['graph']; sample=ns['fixture']()
scale=copy.deepcopy(original)
domains=[n['id'] for n in scale['nodes'] if n['kind']=='service']
scale['modules']=[{'id':f'app.scale.module_{i}','file':f'fixture/module_{i}.py','group':domains[i%6],
  'imports':[f'app.scale.module_{(i+j+1)%3000}' for j in range(3)],'hosts':[],'tables':[],'cache':False} for i in range(3000)]
scale['endpoints']=[{'path':f'/api/fixture/{i}','methods':['GET'],'group':domains[i%6],'module':f'app.scale.module_{i}',
 'function':f'fixture_{i}','dependencies':[f'app.scale.module_{(i+j)%3000}' for j in range(6)]} for i in range(3000)]
for n in scale['nodes']:
    n['modules']=[m['id'] for m in scale['modules'] if m['group']==n['id']]
    n['endpoint_count']=sum(e['group']==n['id'] for e in scale['endpoints'])
mode={'value':'admin'}; requests=[]; pulse_calls=0
legacy=site_graph.build_graph(ns['routes'])

def respond(route):
    global pulse_calls
    if '/src/api/' in route.request.url:
        route.continue_(); return
    path=route.request.url.split('?')[0];requests.append(path)
    if mode['value']=='limited':
        assert '/atlas/' not in path, 'Monitor credentials attempted privileged API'
        if path.endswith('/monitor/graph'):route.fulfill(json=legacy)
        elif path.endswith('/monitor/pulse'):
            pulse_calls+=1
            row=next(n for n in legacy['nodes'] if n['kind']=='api')
            route.fulfill(json={'api_cursor':pulse_calls,'activity_cursor':pulse_calls,'active_sessions':3,
             'api':[{'id':pulse_calls,'ts':time.time(),'route':row['path'],'method':'GET','status':200,'ms':42}],
             'activity':[{'id':pulse_calls,'created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'session_id':'fixture-session',
              'type':'page_view','path':'/desk','label':None,'stock_code':None,'stock_name':None,'action':None,'object_key':None,'value':None}]})
        else:route.fulfill(json={'ok':True,'count':0,'country':'KR','events':[]})
        return
    if path.endswith('/atlas/architecture'):route.fulfill(json=scale if mode['value']=='scale' else original)
    elif path.endswith('/atlas/snapshot'):
        data=copy.deepcopy(sample);data['at']=time.time()
        if mode['value']=='scale':
            data['traces']=[];data['external'].update(flows=[],recent=[])
            data['api']['recent']=[{'id':i,'ts':time.time(),'route':e['path'],'method':'GET','status':503 if i%39==0 else 200,'ms':30+i} for i,e in enumerate(scale['endpoints'][:600])]
        route.fulfill(json=data)
    elif path.endswith('/atlas/health'):route.fulfill(json=ns['health'])
    else:route.fulfill(json={'ok':True,'count':0,'country':'KR','events':[]})

report={}
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    ctx=browser.new_context(viewport={'width':1600,'height':1100})
    ctx.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'isolated-fixture',expires_at:Date.now()/1000+3600}));")
    ctx.route('**/api/**',respond);ctx.route('https://**/*',lambda r:r.abort())
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/admin/monitor')
    page.wait_for_timeout(2500)
    print(json.dumps({'stage':'admin-entry','url':page.url,'errors':errors,'nodes':page.locator('.sn-scene').count()},ensure_ascii=False),flush=True)
    page.screenshot(path=str(output/'entry-diagnostic.png'),full_page=True)
    expect(page.locator('.sn-brand h1')).to_be_visible(timeout=20000)
    expect(page.locator('.sn-scene')).to_have_attribute('data-state','ready')
    report['admin_monitor_route']='new observatory with authenticated atlas data'
    print('Starting 30k+ connection scale fixture',flush=True)
    mode['value']='scale'
    start=time.monotonic();page.reload()
    expect(page.locator('.sn-scene')).to_have_attribute('data-state','ready',timeout=60000)
    report['scale_ready_s']=round(time.monotonic()-start,2)
    page.wait_for_function("Number(document.querySelector('.sn-scene').dataset.frames)>45",timeout=60000)
    report['scale_nodes']=int(page.locator('.sn-scene').get_attribute('data-nodes'))
    report['scale_links']=int(page.locator('.sn-scene').get_attribute('data-links'))
    assert report['scale_links']>=30000
    report['scale_fps']=page.locator('.sn-render-status').inner_text()
    report['scale_dom_nodes']=page.locator('*').count()
    assert report['scale_dom_nodes']<1600
    page.get_by_label('통신 노드 검색').fill('/api/fixture/2999')
    page.locator('.sn-search-results>button').first.click()
    expect(page.locator('.sn-node-identity h2')).to_have_text('/api/fixture/2999')
    page.get_by_role('button',name='노드 검색 초기화',exact=True).click()
    page.get_by_role('button',name='표본 재생',exact=True).click()
    page.screenshot(path=str(output/'synapse-scale.png'),full_page=True)
    ctx.close()
    mode['value']='limited'
    limited=browser.new_context(viewport={'width':1440,'height':1100})
    limited.add_init_script("localStorage.setItem('monitor_session',JSON.stringify({token:'monitor-fixture',expires_at:Date.now()/1000+3600}));")
    limited.route('**/api/**',respond);limited.route('https://**/*',lambda r:r.abort())
    page=limited.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/admin/monitor')
    expect(page.locator('.sn-scene')).to_have_attribute('data-state','ready',timeout=60000)
    expect(page.locator('.sn-access-actions>div').first).to_be_visible()
    expect(page.locator('.sn-metrics')).to_contain_text('계측 미제공')
    page.get_by_role('button',name='관측 정지',exact=True).click()
    page.wait_for_timeout(250);count=pulse_calls;page.wait_for_timeout(1400);assert pulse_calls==count
    page.get_by_role('button',name='관측 재개',exact=True).click()
    page.get_by_role('button',name='관측 범위 ↗',exact=True).click()
    expect(page.locator('.sn-access-summary')).to_be_visible()
    page.screenshot(path=str(output/'synapse-monitor-access.png'),full_page=True)
    report['monitor_only_access']='3D, API journal, activity journal, pause, scope details; no privileged API calls'
    limited.close()
    locked=browser.new_context()
    locked.route('**/api/**',respond);locked.route('https://**/*',lambda r:r.abort())
    page=locked.new_page();page.goto(base+'/admin/monitor')
    expect(page.get_by_label('패스코드',exact=True)).to_be_visible()
    report['locked_route']='existing passcode gate preserved'
    assert not errors,errors
    report['errors']=errors;report['result']='passed'
    browser.close()
(output/'scale-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
