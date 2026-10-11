"""Fixed camera flight replay with public GIS data; memory-only, muted Chrome."""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode,urlsplit
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf8')
root = Path(__file__).resolve().parents[1]
port, label = int(sys.argv[1]), sys.argv[2]
place = sys.argv[3] if len(sys.argv) > 3 else 'haeundae'
out = root / 'tmp/drone-visible-loading-20261011' / label
out.mkdir(parents=True, exist_ok=True)
errors, logs = [], []
def urlsplit_path(url):
    return urlsplit(url).path.split('/')[-1]
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--mute-audio'])
    try:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})")
        page.on('pageerror', lambda e: errors.append(str(e)[:300]))
        page.on('console', lambda m: logs.append(m.text[:250]) if m.text.startswith('[dtile]') else None)
        ids={'haeundae':'26350:우동:1407:해운대두산위브더제니스','mangmi':'26500:망미동:209-4:한성기린'}
        query=urlencode({'complex':ids[place],'hour':12,'fps':1,'dronedebug':1})
        page.goto(f'http://127.0.0.1:{port}/drone-explore?'+query, wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown', timeout=90000)
        if '--bundles32' in sys.argv:
            page.evaluate('window.__holoNative.renderer.bundleChunkSize=32')
        cdp=page.context.new_cdp_session(page)
        if '--profile' in sys.argv:
            cdp.send('Profiler.enable');cdp.send('Profiler.setSamplingInterval',{'interval':1000});cdp.send('Profiler.start')
        result = page.evaluate('''async()=>{
          const d=window.__drone,w=d.world,n=window.__holoNative,c=d.p.camera;
          const start=performance.now(),events=[],targets=new Map(),samples=[],frames=[],windows=[],ratios=new Set(),scopes={},modelTargets=new Map(),knownDetailed=new Map();
          const point=c.position.clone();let sampleCost=0,maxSampleCost=0;
          const pace=w.pace;w.pace=async function(...args){const at=performance.now();try{return await pace.apply(this,args);}finally{const s=scopes.pace??={count:0,total:0,max:0};const ms=performance.now()-at;s.count++;s.total+=ms;s.max=Math.max(s.max,ms);}};
          for(const [owner,key,label] of [[w,'update','streaming'],[n,'sync','sync'],[n,'render','render']]){
            const f=owner[key];owner[key]=function(...args){const at=performance.now();try{return f.apply(this,args);}finally{const s=scopes[label]??={count:0,total:0,max:0};const ms=performance.now()-at;s.count++;s.total+=ms;s.max=Math.max(s.max,ms);}};
          }
          for(const method of ['tileGrid','load','surveyTile']){
            const original=w[method];w[method]=async function(t,...args){
              const at=performance.now();try{return await original.call(this,t,...args);}
              finally{events.push({method,key:t.key,at:at-start,ms:performance.now()-at,state:t.state,survey:t.survey});}
            };
          }
          const pose=ms=>{
            // The identical 200 km/h path is replayed independently of loading
            // brakes. This measures what the camera actually waits for at each
            // coordinate instead of comparing routes of different lengths.
            const s=Math.max(0,ms-12000)/1000,speed=200/3.6;
            let x=0,y=0,yaw=0,vx=0,vy=0;
            if(s<=18){y=s*speed;vy=s>0?speed:0;}
            else if(s<=36){y=1000;x=(s-18)*speed;yaw=-Math.PI/2;vx=speed;}
            else {x=1000;y=1000-Math.min(18,s-36)*speed;yaw=Math.PI;vy=-speed;}
            d.flight.place(x,y,w.groundAt(x,y),300,yaw);d.flight.tilt=-.4;d.flight.vel.set(vx,0,-vy);
          };
          let next=0,last=start,win=start,winFrames=n.frameNo,initialFrame=n.frameNo;
          const sample=ms=>{
            const sampleStart=performance.now();
            const visible=[];
            for(const t of w.tiles.values()){
              const dx=t.cx-d.flight.pos.x,dy=t.cy+d.flight.pos.z,dist=Math.hypot(dx,dy);
              if(dist>1100)continue;
              const v=c.position.clone().set(t.cx,w.groundAt(t.cx,t.cy)+40,-t.cy).project(c);
              if(Math.abs(v.x)>1.15||Math.abs(v.y)>1.15||v.z<0||v.z>1)continue;
              const ready=t.state==='ready',id=t.key;
              let target=targets.get(id);if(!target){target={id,firstVisibleMs:ms,readyMs:null,firstState:t.state};targets.set(id,target);}
              if(ready&&target.readyMs===null)target.readyMs=ms;
              visible.push({id,state:t.state,ready,startedMs:t.startedAt-start,readyAtMs:t.readyAt-start});
            }
            let visibleModels=0,readyModels=0;
            for(const t of [...w.tiles.values(),...w.viewTiles.values()]){
              const a=t.towers;if(!a)continue;
              const buffered=!!t.surveyGroup&&t.surveyGroup.children.every(o=>{
                const m=n.meshes.get(o),row=m?.__frameRow,state=n.renderer.geometries.get(o.geometry);
                if(!m||m.geometry!==o.geometry||!row||row.geo!==o.geometry||row.gpuState!==state)return false;
                for(let k=0;k<row.refs.length;k++){const src=row.refs[k],b=state?.buffers.get(src);if(!b||b.array!==src.array||b.version!==(src.version??0))return false;}
                return !o.geometry.index||(state?.indexSrc===o.geometry.index.array&&state.indexVersion===(o.geometry.index.version??0));
              });
              for(let i=0;i<a.length;i+=9){
                const id=t.key+':'+a[i+6]+':'+a[i+4],ready=buffered&&!!t.surveyHidden?.has(a[i+6]+':'+a[i+4]);
                if(ready&&!knownDetailed.has(id))knownDetailed.set(id,ms);
                if(Math.hypot(a[i]-d.flight.pos.x,a[i+1]+d.flight.pos.z)>800)continue;
                point.set(a[i],a[i+3]+a[i+2]*.5,-a[i+1]).project(c);
                if(Math.abs(point.x)>1||Math.abs(point.y)>1||point.z<0||point.z>1)continue;
                visibleModels++;if(ready)readyModels++;
                let target=modelTargets.get(id);if(!target){target={id,firstVisibleMs:ms,detailedAtMs:knownDetailed.get(id)??null,readyAtFirstSight:ready};modelTargets.set(id,target);}
                if(ready&&target.detailedAtMs===null)target.detailedAtMs=knownDetailed.get(id);
              }
            }
            const cost=performance.now()-sampleStart;sampleCost+=cost;maxSampleCost=Math.max(maxSampleCost,cost);
            samples.push({ms,x:d.flight.pos.x,y:-d.flight.pos.z,visible,visibleModels,readyModels,gpu:{...n.timer?.ms},stats:w.stats()});
          };
          // Establish the replay camera before the first sample, rather than
          // counting the previous complex-orbit camera as visible replay tiles.
          pose(0);d.flight.apply(c);c.updateMatrixWorld();sample(0);
          await new Promise(resolve=>{const tick=at=>{
            if(at<start){requestAnimationFrame(tick);return;}
            const ms=at-start;frames.push(at-last);last=at;ratios.add(document.querySelector('.re-holo-stage').dataset.pixelRatio);
            if(at-win>=1000){windows.push({ms,fps:(n.frameNo-winFrames)*1000/(at-win)});win=at;winFrames=n.frameNo;}
            pose(ms);
            if(ms>=next){sample(ms);next=ms+250;}
            if(ms>=66000)resolve();else requestAnimationFrame(tick);
          };requestAnimationFrame(tick);});
          frames.sort((a,b)=>a-b);const q=p=>frames[Math.min(frames.length-1,Math.floor(frames.length*p))];
          const all=[...targets.values()],cold=all.filter(t=>t.firstVisibleMs>=12000&&t.readyMs!==null&&t.firstState!=='ready');
          const waits=cold.map(t=>t.readyMs-t.firstVisibleMs).sort((a,b)=>a-b);
          const quant=(a,p)=>a.length?a[Math.min(a.length-1,Math.floor(a.length*p))]:null;
          const waitingIntegral=(from,to)=>samples.slice(0,-1).reduce((sum,s,i)=>sum+
            Math.max(0,Math.min(to,samples[i+1].ms)-Math.max(from,s.ms))*s.visible.filter(t=>!t.ready).length,0);
          const visibleModels=[...modelTargets.values()],entered=visibleModels.filter(t=>t.firstVisibleMs>=12000);
          const buildingIntegral=samples.slice(0,-1).reduce((sum,s,i)=>sum+Math.max(0,Math.min(66000,samples[i+1].ms)-Math.max(12000,s.ms))*(s.visibleModels-s.readyModels),0);
          return{path:'north 1000m, east 1000m, south 1000m; 200km/h at 300m AGL',events,targets:all,samples,scopes,
            visibleAssembly:{movingWaitingBuildingMs:buildingIntegral,enteredMoving:entered.length,preloadedAtFirstSight:entered.filter(t=>t.readyAtFirstSight).length,unresolved:visibleModels.filter(t=>t.detailedAtMs===null).length,models:visibleModels,averageSamplingMs:sampleCost/samples.length,maxSamplingMs:maxSampleCost},
            moving:{newTiles:all.filter(t=>t.firstVisibleMs>=12000).length,coldCompleted:cold.length,unresolved:all.filter(t=>t.readyMs===null).length,
              medianWaitMs:quant(waits,.5),p90WaitMs:quant(waits,.9),waitingTileMs:waitingIntegral(12000,66000)},
            initial:{waitingTileMs:waitingIntegral(0,12000)},
            performance:{minOneSecondFps:Math.min(...windows.map(w=>w.fps)),windows,p95Ms:q(.95),p99Ms:q(.99),maxMs:frames.at(-1),
              renderedFrames:n.frameNo-initialFrame,canvas:[n.canvas.width,n.canvas.height],pixelRatios:[...ratios],quality:n.quality.name,bundleChunkSize:n.renderer.bundleChunkSize},
            heap:performance.memory?.usedJSHeapSize,stage:{...document.querySelector('.re-holo-stage').dataset}};
        }''')
        if '--profile' in sys.argv:
            profile=cdp.send('Profiler.stop')['profile'];nodes={n['id']:n['callFrame'] for n in profile['nodes']};counts={}
            for sample in profile.get('samples',[]):
                f=nodes[sample];key=(f['functionName'] or '(anonymous)')+' @ '+urlsplit_path(f['url'])+':'+str(f['lineNumber']+1)
                counts[key]=counts.get(key,0)+1
            result['cpuSamples']=sorted(counts.items(),key=lambda p:-p[1])[:50]
        result.update(chrome=browser.version,muted=True,place=place,errors=errors,phaseLogs=logs)
        (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        page.screenshot(path=str(out/'final.png'))
        summary={k:result[k] for k in ['moving','heap','errors','scopes']}
        summary['performance']={k:v for k,v in result['performance'].items() if k!='windows'}
        summary['visibleAssembly']={k:v for k,v in result['visibleAssembly'].items() if k!='models'}
        print(json.dumps(summary,ensure_ascii=False),flush=True)
        assert not errors
    finally:
        browser.close()
