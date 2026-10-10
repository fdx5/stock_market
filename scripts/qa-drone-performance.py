"""Bounded Chrome flight benchmark against the isolated local snapshot API only."""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
label = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 5173
profile_on = '--profile' in sys.argv
out = root / 'tmp/drone-performance-20261010' / label
out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    try:
        page = browser.new_page(viewport={'width':1440, 'height':1000})
        page.on('pageerror', lambda e: errors.append(str(e)[:300]))
        page.route('**/api/**', lambda r: r.continue_() if r.request.url.startswith((f'http://127.0.0.1:{port}/', 'http://127.0.0.1:8003/')) else r.abort())
        query = {'complex':'26350:\uC6B0\uB3D9:1407:\uD574\uC6B4\uB300\uB450\uC0B0\uC704\uBE0C\uB354\uC81C\uB2C8\uC2A4', 'hour':12, 'dronedebug':1, 'fps':1}
        page.goto(f'http://127.0.0.1:{port}/drone-explore?'+urlencode(query), wait_until='domcontentloaded')
        page.wait_for_function('window.__drone?.world.region?.field && window.__holoNative?.shown', timeout=90000)
        page.wait_for_timeout(5000)
        page.evaluate('''()=>{
          window.__qaCpu={};const track=(owner,key,label)=>{if(!owner?.[key])return;const f=owner[key];owner[key]=function(...a){const t=performance.now();try{return f.apply(this,a);}finally{const s=window.__qaCpu[label]??={count:0,total:0,max:0};const ms=performance.now()-t;s.count++;s.total+=ms;s.max=Math.max(s.max,ms);}};};
          const d=window.__drone,w=d.world,s=window.__holoStageAny?.current;
          track(w,'update','streaming');track(w.traffic,'update','streamed-cars');track(w.seaCoverage,'update','sea-cut');track(w.o,'onSeaReady','ground-sink');track(d.signs,'draw','signs');track(s?.rail,'update','rail');track(window.__holoNative,'render','render');
          s?.tick.forEach((f,i)=>{s.tick[i]=function(...a){const t=performance.now();try{return f.apply(this,a);}finally{const x=window.__qaCpu['view-tick-'+i]??={count:0,total:0,max:0};const ms=performance.now()-t;x.count++;x.total+=ms;x.max=Math.max(x.max,ms);}};});
        }''')
        cdp = page.context.new_cdp_session(page)
        if profile_on:
            cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval':1000}); cdp.send('Profiler.start')
        segments = [
            ('initial-city',35.15661,129.14506,90,0,0,-.3),
            ('city-flight',35.15661,129.14506,70,0,420,-.3),
            ('shore-flight',35.1581,129.1636,15,420,0,-.3),
            ('bridge-flight',35.1486,129.1202,50,350,100,-.5),
            ('return-city',35.15661,129.14506,90,0,0,-.3),
        ]
        if '--quick' in sys.argv: segments = [segments[0],segments[2]]
        results = []
        for name,lat,lon,h,dx,dy,tilt in segments:
            result = page.evaluate('''async a=>{
              const d=window.__drone,w=d.world,c=w.o.data.center,kx=111320*Math.cos(c.lat*Math.PI/180);
              const x=(a.lon-c.lon)*kx,y=(a.lat-c.lat)*110540;
              const put=t=>{const px=x+a.dx*t,py=y+a.dy*t;d.flight.place(px,py,w.groundAt(px,py),a.h,0);d.flight.tilt=a.tilt;};put(0);
              await new Promise(r=>setTimeout(r,2500));
              const stamps=[],windows=[],start=performance.now();let last=start,win=start,n=0;
              await new Promise(resolve=>{const frame=now=>{
                const dt=now-last;last=now;stamps.push(dt);n++;
                if(now-win>=1000){windows.push(n*1000/(now-win));win=now;n=0;}
                const elapsed=now-start;put(Math.min(1,elapsed/10000));
                if(elapsed<10000)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
              stamps.sort((a,b)=>a-b);const q=p=>stamps[Math.min(stamps.length-1,Math.floor(stamps.length*p))];
              const stage=document.querySelector('.re-holo-stage'),rail=window.__holoRail;
              return {name:a.name,frames:stamps.length,meanFps:stamps.length*1000/(performance.now()-start),minWindowFps:Math.min(...windows),windows,
                p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),worstMs:stamps.at(-1),over20ms:stamps.filter(t=>t>20).length,
                world:w.stats(),heap:performance.memory?.usedJSHeapSize,stage:{...stage?.dataset},rail:rail?.inspect?.(),fpsText:document.querySelector('.re-holo-fps')?.textContent};
            }''', dict(name=name,lat=lat,lon=lon,h=h,dx=dx,dy=dy,tilt=tilt))
            results.append(result)
            print(json.dumps({k:result[k] for k in ['name','meanFps','minWindowFps','p95Ms','worstMs','heap','world']},ensure_ascii=False), flush=True)
        profile=cdp.send('Profiler.stop')['profile'] if profile_on else {'nodes':[]}
        counts={}
        nodes={n['id']:n['callFrame'] for n in profile['nodes']}
        for node in profile.get('samples',[]):
            frame=nodes[node];key=frame['functionName'] or '(anonymous)';counts[key]=counts.get(key,0)+1
        cdp.send('HeapProfiler.collectGarbage')
        retained=page.evaluate('''()=>({heap:performance.memory?.usedJSHeapSize,world:window.__drone.world.stats(),workers:window.__drone.world.surveyPool?.pending??0,rail:window.__holoStageAny?.current?.rail?.inspect()})''')
        report={'chrome':browser.version,'viewport':[1440,1000],'profileOn':profile_on,'results':results,'retained':retained,'cpuScopes':page.evaluate('window.__qaCpu'),'cpuSamples':sorted(counts.items(),key=lambda a:-a[1])[:40],'errors':errors,
                'gate50fps':all(r['minWindowFps']>=50 for r in results),'gateNearest':'requires streaming progress check','gateMemory':'bounded resource test plus retained heap; not a nationwide soak test'}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        page.screenshot(path=str(out/'final.png'))
        print(json.dumps({'cpuSamples':report['cpuSamples'][:15],'cpuScopes':report['cpuScopes'],'errors':errors},ensure_ascii=False),flush=True)
    finally:
        browser.close()
