"""Read-only browser regression: live 33k-link updates, canvas continuity and frame gaps.
All API calls are intercepted; no app process, credentials or DB is used.
Run BASELINE=1 for the old deployment (records without the new regression gates).
"""
from pathlib import Path
fixture_script=Path(__file__).with_name('test-synapse-scale.py')
ns={'__file__':str(fixture_script)}
exec(compile(fixture_script.read_text(encoding='utf-8').split('\nwith sync_playwright() as p:')[0],str(fixture_script),'exec'),ns)
import copy,json,os,time
from playwright.sync_api import sync_playwright,expect
base=os.environ.get('TEST_BASE_URL','http://127.0.0.1:5201')
out=ns['output'];ns['mode']['value']='scale';polls=0;churn=False
original_respond=ns['respond']
def respond(route):
    global polls
    if route.request.url.split('?')[0].endswith('/atlas/snapshot'):
        polls+=1;data=copy.deepcopy(ns['sample']);now=time.time();data['at']=now;data['traces']=[]
        data['external'].update(flows=[],recent=[])
        data['api']['recent']=[{'id':polls*1000+i,'ts':now,'route':e['path'],'method':'GET','status':200,'ms':30+i} for i,e in enumerate(ns['scale']['endpoints'][:600])]
        if churn:
            host=f'fixture-{polls}.invalid';path='/api/fixture/0'
            data['external']['flows']=[{'route':path,'host':host}]
            data['external']['recent']=[{'id':polls,'ts':now,'host':host,'route':path,'target':'ext-resources','status':200,'ms':20}]
        route.fulfill(json=data)
    else:original_respond(route)
probe="""(()=>{
const probe=window.__continuity={frames:[],long:[],canvases:new Set(),uploadBytes:0};
new PerformanceObserver(list=>probe.long.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});
for(const cls of [WebGLRenderingContext,WebGL2RenderingContext]){
 const clear=cls.prototype.clear;
 cls.prototype.clear=function(...args){if(this.canvas.closest('.sn-scene')){probe.frames.push(performance.now());probe.canvases.add(this.canvas);}return clear.apply(this,args);};
 const update=cls.prototype.bufferSubData;
 cls.prototype.bufferSubData=function(target,offset,data,srcOffset,length){if(this.canvas.closest('.sn-scene'))probe.uploadBytes+=(length===undefined?data.byteLength:length*data.BYTES_PER_ELEMENT);return update.apply(this,arguments);};
}
})();"""
report={};errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    ctx=browser.new_context(viewport={'width':1600,'height':1100})
    ctx.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'isolated-fixture',expires_at:Date.now()/1000+3600}));")
    ctx.add_init_script(probe)
    ctx.route('**/api/**',respond);ctx.route('https://**/*',lambda r:r.fallback() if r.request.url.startswith(base+'/') else r.abort())
    page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/admin/monitor')
    expect(page.locator('.sn-scene')).to_have_attribute('data-state','ready',timeout=60000)
    page.wait_for_timeout(3000)
    initial_links=int(page.locator('.sn-scene').get_attribute('data-links'));assert initial_links>=33000
    for name in ['metrics','new_paths']:
        churn=name=='new_paths'
        page.evaluate("""()=>{const p=window.__continuity;p.frames=[];p.long=[];p.canvases.clear();p.uploadBytes=0;window.__initialCanvas=document.querySelector('.sn-scene canvas');}""")
        page.wait_for_timeout(16000)
        result=page.evaluate("""()=>{const p=window.__continuity;const gaps=p.frames.slice(1).map((t,i)=>t-p.frames[i]).sort((a,b)=>a-b);return {frames:p.frames.length,median_ms:gaps[Math.floor(gaps.length*.5)],p95_ms:gaps[Math.floor(gaps.length*.95)],p99_ms:gaps[Math.floor(gaps.length*.99)],max_gap_ms:Math.max(0,...gaps),gaps_over_100ms:gaps.filter(t=>t>100).length,long_tasks:p.long.length,max_task_ms:Math.max(0,...p.long),canvases:p.canvases.size,same_canvas:window.__initialCanvas===document.querySelector('.sn-scene canvas'),upload_bytes:p.uploadBytes,links:Number(document.querySelector('.sn-scene').dataset.links),revision:document.querySelector('.sn-scene').dataset.topologyRevision};}""")
        report[name]=result;print(json.dumps({name:result}),flush=True)
        if not os.environ.get('BASELINE'):
            assert result['same_canvas'] and result['canvases']==1,result
            assert result['frames']>=300,result
    assert report['new_paths']['links']>initial_links,'New real fixture paths must be incorporated'
    assert not errors,errors
    report.update(result='passed',polls=polls,errors=errors)
    page.screenshot(path=str(out/'continuity.png'),full_page=True)
    browser.close()
(out/'continuity-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
