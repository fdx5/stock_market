"""Cold-memory visible-scene timing in muted Chrome; public read-only snapshot only."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1]
port,label=int(sys.argv[1]),sys.argv[2]
place=sys.argv[3] if len(sys.argv)>3 else 'haeundae'
seconds=int(sys.argv[4]) if len(sys.argv)>4 else 65
out=root/'tmp/drone-visible-loading-20261011'/label
out.mkdir(parents=True,exist_ok=True)
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})")
        page.add_init_script('''window.__loadingStages=[];let previous='';setInterval(()=>{const n=window.__holoNative,s=document.querySelector('.re-holo-stage');const state={detail:n?.detailReady,ready:n?.ready,shown:n?.shown,pending:n?.pending,pipelines:n?.renderer?.pipelines?.size,meshes:n?.meshes?.size,select:s?.dataset.selectAt,built:s?.dataset.builtAt};const key=JSON.stringify(state);if(key!==previous){window.__loadingStages.push({at:performance.now(),...state});previous=key;}},20);''')
        page.add_init_script('''window.__roadInput=null;const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){if(message?.op==='roads'&&!window.__roadInput)window.__roadInput={roads:message.args.roads,footprints:message.args.footprints};return send.call(this,message,...rest);};''')
        page.on('pageerror',lambda e:errors.append(str(e)[:300]))
        page.goto(f'http://127.0.0.1:{port}/drone-review/{place}',wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
        result=page.evaluate('''async seconds=>{
          const d=window.__drone,w=d.world,c=d.p.camera,n=window.__holoNative,stage=document.querySelector('.re-holo-stage');
          const start=performance.now(),samples=[],first=new Map(),targets=new Map(),ratios=new Set(),frames=[],windows=[];
          let last=start,win=start,frame=n.frameNo,beginFrame=frame,sampleAt=-Infinity;
          const sample=at=>{
            const visible=[];
            for(const t of [...w.tiles.values(),...w.viewTiles.values()]){
              if(!t.towers||!w.buildingReady(t))continue;
              for(let i=0;i<t.towers.length;i+=9){
                const a=t.towers,x=a[i],y=a[i+1],h=a[i+2],g=a[i+3],floors=t.appearances?.[a[i+7]]?.floors??Math.round(h/3);
                if(floors<5||Math.hypot(x-d.flight.pos.x,y+d.flight.pos.z)>800)continue;
                const v=c.position.clone().set(x,g+h*.5,-y).project(c);
                if(Math.abs(v.x)>1||Math.abs(v.y)>1||v.z<0||v.z>1)continue;
                const id=t.key+':'+a[i+6]+':'+a[i+4],ready=!!t.surveyHidden?.has(a[i+6]+':'+a[i+4]);
                visible.push({id,x,y,height:h,ready});
                if(ready&&!first.has(id))first.set(id,at);
                if(!targets.has(id))targets.set(id,{x,y,height:h,firstVisibleMs:at});
              }
            }
            const stats=w.stats();samples.push({ms:at,visible:visible.length,visibleDetailed:visible.filter(b=>b.ready).length,stats,stage:{shown:stage.dataset.shownAt,ring:stage.dataset.ringAt,roads:stage.dataset.roadsReadyAt,traffic:stage.dataset.trafficArmedAt}});
          };
          sample(0);
          await new Promise(resolve=>{const tick=t=>{
            if(t<start){requestAnimationFrame(tick);return;}
            frames.push(t-last);last=t;ratios.add(stage.dataset.pixelRatio);
            if(t-win>=1000){windows.push((n.frameNo-frame)*1000/(t-win));frame=n.frameNo;win=t;}
            if(t-sampleAt>=250){sample(t-start);sampleAt=t;}
            if(t-start>=seconds*1000)resolve();else requestAnimationFrame(tick);
          };requestAnimationFrame(tick);});
          frames.sort((a,b)=>a-b);const q=p=>frames[Math.min(frames.length-1,Math.floor(frames.length*p))];
          const milestones={};for(const count of [1,3,6,12,24])milestones[count]=samples.find(s=>s.visibleDetailed>=count)?.ms??null;
          const resources=performance.getEntriesByType('resource').filter(r=>r.name.includes('vworld.kr')||r.name.includes('/3d/')).map(r=>{const u=new URL(r.name);return{kind:u.searchParams.get('DataFile')?'model':u.pathname.includes('3DData')?'list':u.pathname,layer:u.searchParams.get('data'),page:u.searchParams.get('page'),start:r.startTime,duration:r.duration,bytes:r.transferSize};});
          return{selectionToShownMs:Number(stage.dataset.shownAt)-Number(stage.dataset.selectAt),stage:{...stage.dataset},startup:window.__loadingStages.filter(s=>s.at<start+5000),startMs:start,milestones,samples,targets:[...targets].map(([id,v])=>({id,...v,detailedMs:first.get(id)??null})),resources,performance:{minOneSecondFps:Math.min(...windows),windows,p95Ms:q(.95),p99Ms:q(.99),maxMs:frames.at(-1),renderedFrames:n.frameNo-beginFrame,canvas:[n.canvas.width,n.canvas.height],pixelRatios:[...ratios],quality:n.quality.name},heap:performance.memory?.usedJSHeapSize};
        }''',seconds)
        result.update(chrome=browser.version,muted=True,place=place,errors=errors)
        fixture=page.evaluate('window.__roadInput')
        if fixture:(out/'public-road-input.json').write_text(json.dumps(fixture,ensure_ascii=False),encoding='utf8')
        (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        page.screenshot(path=str(out/'final.png'))
        print(json.dumps({k:result[k] for k in ['selectionToShownMs','milestones','performance','heap','errors']},ensure_ascii=False),flush=True)
        assert not errors
    finally:browser.close()
