"""Serial Chrome verification against a read-only local UI preview."""
import json, sys, time
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

base, mode, label = sys.argv[1:4]
out = Path(__file__).resolve().parents[2] / 'tmp/resume-qa' / label
out.mkdir(parents=True, exist_ok=False)
audit = Path(__file__).with_name('audit-view-bridge-surfaces.js').read_text(encoding='utf-8')
result = {'mode':mode, 'viewport':[1920,1080], 'errors':[]}
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=False,
        args=['--mute-audio','--window-size=1920,1080','--window-position=0,0'])
    context = browser.new_context(viewport={'width':1920,'height':1080})
    page = context.new_page()
    page.on('pageerror', lambda e: result['errors'].append(str(e).split('?')[0][:200]))
    page.add_init_script("""(()=>{const points=[];window.__qaFrames=points;let prev=0;
      const tick=t=>{const n=window.__holoNative?.frameNo??0;if(n>prev){points.push(t);prev=n;}requestAnimationFrame(tick);};requestAnimationFrame(tick);})();""")
    query={'complex':'11680:압구정동:486:한양4','hour':12,'dronedebug':1,'fps':1}
    if mode=='building':query['3d']=1
    started=time.time()
    try:
        page.goto(base+('/realestate-map?' if mode=='building' else '/drone-explore?')+urlencode(query),wait_until='domcontentloaded')
        page.wait_for_function("window.__holoNative?.shown && window.__qaViewRoads && document.querySelector('.re-holo-stage')?.dataset.shownAt",timeout=150000)
        result['shownSeconds']=round(time.time()-started,2)
        page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.roadsReadyAt",timeout=150000)
        result['roadsSeconds']=round(time.time()-started,2)
        # Same output scale throughout; never lower quality or resolution for FPS.
        page.wait_for_timeout(12000)
        result['scene']=page.evaluate(audit)
        result['render']=page.evaluate("""()=>{const n=window.__holoNative,s=document.querySelector('.re-holo-stage');
          return {canvas:[n.canvas.width,n.canvas.height],quality:n.quality.name,renderer:s.dataset.renderer,pixelRatio:s.dataset.pixelRatio,
          milestones:Object.fromEntries(['shownAt','waterReadyAt','roadsFirstAt','roadsReadyAt','plantsReadyAt','trafficReadyAt','trafficArmedAt'].map(k=>[k,s.dataset[k]]))};}""")
        result['frames']=page.evaluate('window.__qaFrames')
        before=page.evaluate("""()=>{const s=window.__holoStageAny.current,out=[];s.scene.traverseVisible(o=>{
          for(const c of o.userData.traffic?.cars??[])out.push({x:c.x,y:c.y,s:c.s,road:c.road});});return out;}""")
        page.wait_for_timeout(3000)
        after=page.evaluate("""()=>{const s=window.__holoStageAny.current,out=[];s.scene.traverseVisible(o=>{
          for(const c of o.userData.traffic?.cars??[])out.push({x:c.x,y:c.y,s:c.s,road:c.road});});return out;}""")
        result['traffic']={'before':len(before),'after':len(after),'changed':sum(a!=b for a,b in zip(before,after))}
        result['traffic']['readiness']=page.evaluate("""()=>{const s=window.__holoStageAny.current,n=window.__holoNative,t=s.traffic;
          const out={surface:[],traffic:[],drawReady:t?s.drawReady(t.group):null};
          s.scene.traverseVisible(o=>{if(o.name==='road surface and markings')out.surface.push(s.drawReady(o));});
          t?.group.traverseVisible(o=>{if(o.isMesh&&!s.drawReady(o))out.traffic.push({name:o.name,count:o.count??1,vertices:o.geometry.getAttribute('position')?.count,diagnostic:n.explain(o)});});
          return out;}""")
        page.screenshot(path=str(out/'overview.png'))
        if mode=='building':
            # Freeze the user's orbit and inspect the full surveyed decks from above.
            page.evaluate("""()=>{const s=window.__holoStageAny.current;s.controls.autoRotate=false;s.intro=null;s.fly=null;
              s.camera.position.set(650,1500,-950);s.controls.target.set(250,0,-650);s.controls.update();}""")
            page.wait_for_timeout(1500)
            page.screenshot(path=str(out/'bridge-overview.png'))
        else:
            page.evaluate("""()=>{const d=window.__drone;d.flight.place(0,0,d.world.groundAt(0,0),150,0);d.flight.setAutoSpeed(0);d.flight.setAutopilot(false);d.flight.tilt=-.35;}""")
            page.wait_for_timeout(1200)
            page.screenshot(path=str(out/'bridge-overview.png'))
            if '--flight' in sys.argv:
                if '--timing' in sys.argv:
                    page.evaluate("""()=>{const s=window.__holoStageAny.current,d=window.__drone,n=window.__holoNative;
                      const samples=window.__qaTimings={};
                      for(const [name,object,key] of [['native-render',n,'render'],['native-sync',n,'sync'],['view-traffic',s.traffic,'update'],
                        ['tile-world',d.world,'update'],['tile-traffic',d.world.traffic,'update']]){
                        if(typeof object?.[key]!=='function')continue;const original=object[key];samples[name]=[];
                        object[key]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{samples[name].push(performance.now()-start);}};
                      }}""")
                route=page.evaluate("""()=>{const r=window.__qaViewRoads.find(r=>r.id?.startsWith('deck:'));
                  const ends=[r.line[0],r.line.at(-1)].sort((a,b)=>a[1]-b[1]);return ends;}""")
                south,north=route
                legs=[('approach',[0,0,120],[*south,120],10),
                      ('bridge',[*south,40],[*north,40],14),
                      ('north-city',[*north,80],[north[0],north[1]+600,80],10),
                      ('return',[north[0],north[1]+600,120],[0,0,120],12)]
                result['flight']=[]
                for name,a,b,seconds in legs:
                    metrics=page.evaluate("""async a=>{const d=window.__drone,n=window.__holoNative,stamps=[];
                      d.flight.setAutoSpeed(0);d.flight.setAutopilot(false);let last=n.frameNo,start=performance.now();
                      await new Promise(resolve=>{const tick=t=>{if(n.frameNo>last){stamps.push(t);last=n.frameNo;}
                        const f=Math.min(1,(t-start)/(a.seconds*1000)),x=a.a[0]+(a.b[0]-a.a[0])*f,y=a.a[1]+(a.b[1]-a.a[1])*f;
                        d.flight.place(x,y,d.world.groundAt(x,y),a.a[2]+(a.b[2]-a.a[2])*f,-Math.atan2(a.b[0]-a.a[0],a.b[1]-a.a[1]));d.flight.tilt=-.3;
                        if(f<1)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
                      const gaps=stamps.slice(1).map((t,i)=>t-stamps[i]).sort((a,b)=>a-b),wins=[];let left=0;
                      for(let i=0;i<stamps.length;i++){while(stamps[left]<stamps[i]-1000)left++;if(stamps[i]>=stamps[0]+1000)wins.push(i-left+1);}
                      return {name:a.name,meanFps:(stamps.length-1)*1000/(stamps.at(-1)-stamps[0]),minOneSecond:Math.min(...wins),
                        p95Ms:gaps[Math.floor(gaps.length*.95)],p99Ms:gaps[Math.floor(gaps.length*.99)],maxMs:gaps.at(-1),
                        canvas:[n.canvas.width,n.canvas.height],quality:n.quality.name,world:d.world.stats()};}""",
                        {'name':name,'a':a,'b':b,'seconds':seconds})
                    result['flight'].append(metrics)
                    if '--timing' in sys.argv:
                        metrics['cpu']=page.evaluate("""()=>Object.fromEntries(Object.entries(window.__qaTimings).map(([k,a])=>{
                          a.sort((a,b)=>a-b);const out={calls:a.length,meanMs:a.reduce((s,x)=>s+x,0)/(a.length||1),p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)};
                          a.length=0;return [k,out];}))""")
                    print(json.dumps({'flight':metrics},ensure_ascii=True),flush=True)
                    page.screenshot(path=str(out/('flight-'+name+'.png')))
    except Exception as exc:
        result['error']=str(exc).split('?')[0][:300]
        page.screenshot(path=str(out/'error.png'))
    browser.close()

frames=result.pop('frames',[])
shown=float(result.get('render',{}).get('milestones',{}).get('shownAt',0) or 0)
frames=[t for t in frames if t>=shown]
if len(frames)>2:
    gaps=sorted(b-a for a,b in zip(frames,frames[1:]))
    windows=[];left=0
    for i,t in enumerate(frames):
        while frames[left]<t-1000:left+=1
        if t>=frames[0]+1000:windows.append(i-left+1)
    result['renderedFps']={'mean':round((len(frames)-1)*1000/(frames[-1]-frames[0]),2),
        'minOneSecond':min(windows) if windows else None,'p95Ms':round(gaps[int(len(gaps)*.95)],2),
        'p99Ms':round(gaps[int(len(gaps)*.99)],2),'maxMs':round(max(gaps),2)}
(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=True),flush=True)
