"""First actual GPU-ready departure lanes, independently of the detailed pass."""
import json,sys,time
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

base,label=sys.argv[1:3]
cid=next((x for x in sys.argv[3:] if not x.startswith('--')),'11290:길음동:1288:래미안길음센터피스')
out=Path(__file__).resolve().parents[2]/'tmp/initial-lanes-qa';out.mkdir(parents=True,exist_ok=True)
result={'base':base,'complex':cid,'errors':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=False,args=['--mute-audio','--window-position=0,0'])
    ctx=browser.new_context(viewport={'width':1200,'height':800})
    ctx.route('**/api/**',lambda route:route.continue_() if route.request.method=='GET' and not any(x in route.request.url.lower() for x in ['activity','visitor','track','pulse','heartbeat','analytics','beacon','page-view']) else route.fulfill(status=200,content_type='application/json',body='{}'))
    ctx.route('**/*youtube*',lambda route:route.abort())
    page=ctx.new_page();page.on('pageerror',lambda e:result['errors'].append(str(e)[:250]))
    page.add_init_script("""(()=>{window.__laneFrames=[];let prev=0;const tick=t=>{const n=window.__holoNative?.frameNo??0;if(n>prev){window.__laneFrames.push(t);prev=n;}requestAnimationFrame(tick);};requestAnimationFrame(tick);})();""")
    if '--profile-worker' in sys.argv:
        page.route('**/initialRoadWorker-*.js',lambda route:route.fulfill(path=str(Path(__file__).resolve().parents[1]/'dist-initial-immediate/assets/profile-initial-worker.js'),content_type='application/javascript'))
        page.add_init_script("""(()=>{const W=window.Worker;window.Worker=class extends W{constructor(url,opts){super(url,opts);if(String(url).includes('initialRoadWorker'))this.addEventListener('message',e=>window.__initialRoadTimings=e.data.result?.timings);}};})();""")
    page.goto(base+'/drone-explore?'+urlencode({'complex':cid,'hour':12,'dronedebug':1}),wait_until='domcontentloaded')
    try:
        page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.roadsVisibleAt",timeout=30000)
        result['first']=page.evaluate("""()=>{const d=document.querySelector('.re-holo-stage').dataset,n=window.__holoNative,s=window.__holoStageAny.current;let meshes=0,vertices=0,ready=false;s.scene.traverse(o=>{if(o.name==='initial road lane lines'){ready=s.drawReady(o);for(const m of o.children){meshes++;vertices+=m.geometry.getAttribute('position').count;}}});return {shownMs:+d.shownAt,lanesMs:+d.roadsVisibleAt,afterShownMs:+d.roadsVisibleAt-(+d.shownAt),workerMs:+d.roadsInitialWorkerMs,canvas:[n.canvas.width,n.canvas.height],quality:n.quality.name,renderer:d.renderer,meshes,vertices,ready,error:d.roadsInitialError};}""")
        print(json.dumps({'first':result['first']}),flush=True)
        result['timings']=page.evaluate("()=>JSON.parse(document.querySelector('.re-holo-stage').dataset.roadsInitialTimings??'null')")
        print(json.dumps({'timings':result['timings']}),flush=True)
        page.screenshot(path=str(out/(label+'-first.png')))
        if '--flight' in sys.argv:
            page.evaluate("()=>{window.__laneFrames=[];window.__drone.flight.setAutoSpeed(12);window.__drone.flight.setAutopilot(true);}")
            page.wait_for_timeout(12000)
            result['flight']=page.evaluate("""()=>{const f=window.__laneFrames,g=f.slice(1).map((t,i)=>t-f[i]).sort((a,b)=>a-b),w=[];let left=0;for(let i=0;i<f.length;i++){while(f[left]<f[i]-1000)left++;if(f[i]>=f[0]+1000)w.push(i-left+1);}const n=window.__holoNative;window.__drone.flight.setAutopilot(false);return {frames:f.length,mean:(f.length-1)*1000/(f.at(-1)-f[0]),minOneSecond:Math.min(...w),p95:g[Math.floor(g.length*.95)],p99:g[Math.floor(g.length*.99)],max:g.at(-1),canvas:[n.canvas.width,n.canvas.height],quality:n.quality.name};}""")
        if '--first-only' not in sys.argv:
            page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.roadsReadyAt",timeout=90000)
            result['detailed']=page.evaluate("""()=>{const d=document.querySelector('.re-holo-stage').dataset,s=window.__holoStageAny.current;let initial=0,full=0;s.scene.traverse(o=>{if(o.name==='initial surveyed roads')initial++;if(o.name==='road markings'&&s.drawReady(o))full++;});return {ms:+d.roadsReadyAt,initialGroups:initial,fullGroups:full};}""")
            page.screenshot(path=str(out/(label+'-detailed.png')))
    except Exception as e:
        result['failure']=str(e)[:300]
        result['state']=page.evaluate("()=>document.querySelector('.re-holo-stage')?Object.assign({},document.querySelector('.re-holo-stage').dataset):{}")
        page.screenshot(path=str(out/(label+'-failure.png')))
    browser.close()
(out/(label+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=True),flush=True)
if result.get('failure') or result['errors'] or not result['first']['ready'] or result['first']['afterShownMs']>5000:sys.exit(1)
