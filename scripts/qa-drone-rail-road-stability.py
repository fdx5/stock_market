"""Muted, database-free real Chrome flight and controlled DEM-refresh replay."""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1]
port,label=int(sys.argv[1]),sys.argv[2]
place=sys.argv[3] if len(sys.argv)>3 else 'uijeongbu'
out=root/'tmp/rail-road-stability'/label;out.mkdir(parents=True,exist_ok=True)
errors=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
 try:
  page=b.new_page(viewport={'width':1440,'height':1000})
  page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});navigator.sendBeacon=()=>false")
  page.on('pageerror',lambda e:errors.append(str(e)[:300]))
  page.goto(f'http://127.0.0.1:{port}/drone-review/{place}',wait_until='domcontentloaded')
  page.wait_for_function('window.__drone && window.__holoNative?.shown && window.__holoStageAny?.current?.rail?.entries.size',timeout=90000)
  page.wait_for_timeout(8000)
  result=page.evaluate('''async()=>{
   const d=window.__drone,w=d.world,n=window.__holoNative,r=window.__holoStageAny.current.rail,c=d.p.camera;
   const started=performance.now(),events=[],frames=[],windows=[],ratios=new Set(),snapshots=[];let last=started,windowAt=started,windowFrames=0,offset=0,refresh=0;
   const baseHeight=r.o.heightAt;r.o.heightAt=(x,y)=>baseHeight(x,y)+offset;
   const firstBed=g=>g?.children.find(o=>o.isMesh&&!o.isInstancedMesh);
   const drawable=o=>{const m=n.meshes.get(o);if(!m)return false;const mats=Array.isArray(m.material)?m.material:[m.material];return mats.every(mat=>n.renderer.geometryReady(m,mat)&&n.renderer.materialReady(m,mat,[{kind:'color',colorFormats:['rgba16float'],depthFormat:'depth32float'}]));};
   const capture=(kind,key,before,beforeGeometry,hadDrawable,after)=>{if(!before||!after||(before===after&&beforeGeometry===after.geometry))return;
    for(const e of events)if(!e.done&&e.kind===kind&&e.key===key){e.done=true;e.superseded=true;}
    if(events.length<600)events.push({kind,key,at:performance.now()-started,old:before,next:after,sameObject:before===after,hadDrawable,gapFrames:0,waitFrames:0,done:false});};
   let inBuilt=false;
   const built=r.built;r.built=function(data){const old=firstBed(this.entries.get(data.path?.id)?.group),geometry=old?.geometry,ready=drawable(old),stations=[...this.stations].map(([key,s])=>{const mesh=firstBed(s.model?.group);return{key,mesh,geometry:mesh?.geometry,ready:drawable(mesh)};});
    inBuilt=true;try{built.call(this,data);}finally{inBuilt=false;}capture('rail',data.path?.id,old,geometry,ready,firstBed(this.entries.get(data.path?.id)?.group));
    for(const s of stations)capture('station',s.key,s.mesh,s.geometry,s.ready,firstBed(this.stations.get(s.key)?.model?.group));};
   const station=r.placeStation;r.placeStation=function(s){if(inBuilt)return station.call(this,s);const old=firstBed(s.model?.group),geometry=old?.geometry,ready=drawable(old),key=s.owners.values().next().value?.facility.id;station.call(this,s);capture('station',key,old,geometry,ready,firstBed(s.model?.group));};
   const tick=d.tick;d.tick=function(...args){const ms=performance.now()-started,s=Math.max(0,ms/1000-8),speed=200/3.6,y=s<18?s*speed:s<36?1000-(s-18)*speed:0;
    this.flight.auto=false;this.flight.pos.set(0,w.groundAt(0,y)+120,-y);this.flight.vel.set(0,0,0);this.flight.yaw=s<18?0:Math.PI;this.flight.pitch=.35;this.flight.roll=0;return tick.apply(this,args);};
   const render=n.render;n.render=function(...args){const result=render.apply(this,args),now=performance.now();frames.push(now-last);last=now;windowFrames++;ratios.add(this.canvas.width/1440);
    if(now-windowAt>=1000){windows.push(windowFrames*1000/(now-windowAt));windowAt=now;windowFrames=0;}
    for(const e of events)if(!e.done){const current=e.kind==='rail'?firstBed(r.entries.get(e.key)?.group):firstBed(r.stations.get(e.key)?.model?.group);
     if(current!==e.next){e.done=true;e.retired=true;continue;}e.waitFrames++;
     if(e.hadDrawable&&!drawable(e.old)&&!drawable(e.next))e.gapFrames++;
     if(drawable(e.next)&&n.meshes.get(e.next)?.geometry===e.next.geometry){e.done=true;e.readyMs=now-started;}}
    return result;};
   await new Promise(resolve=>{const loop=()=>{const ms=performance.now()-started;if(ms>=6000+refresh*14000&&refresh<4){offset+=.12;refresh++;r.syncAt=-1;}
    if(!snapshots.length||ms-snapshots.at(-1).ms>3000)snapshots.push({ms,entries:r.entries.size,stations:[...r.stations.values()].filter(s=>s.model?.group.children.length).length,queued:r.jobs.length,workerError:r.stats.error});
    if(ms<66000)requestAnimationFrame(loop);else resolve();};requestAnimationFrame(loop);});
   n.render=render;d.tick=tick;r.built=built;r.placeStation=station;r.o.heightAt=baseHeight;
   // Coast clipping can replace grid topology. Index the actual drawn triangles,
   // rather than assuming their vertex order still follows the original DEM grid.
   let checked=0,buried=0,maxIntrusion=0,tiles=0;
   for(const t of w.tiles.values()){
    const road=t.zup?.children.find(o=>o.isMesh&&o.material===w.asphalt),ground=t.zup?.children.find(o=>o.isMesh&&o.geometry.userData.skirtGrid);
    if(!road||!ground)continue;tiles++;const gp=ground.geometry.attributes.position,gi=ground.geometry.index,p=road.geometry.attributes.position,idx=road.geometry.index,bins=new Map();
    for(let k=0;k<gi.count;k+=3){const a=gi.getX(k),b=gi.getX(k+1),c=gi.getX(k+2),ax=gp.getX(a),ay=gp.getY(a),bx=gp.getX(b),by=gp.getY(b),cx=gp.getX(c),cy=gp.getY(c),den=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(den)<1e-9)continue;
     const tri={ax,ay,bx,by,cx,cy,az:gp.getZ(a),bz:gp.getZ(b),cz:gp.getZ(c),den};
     for(let i=Math.floor(Math.min(ax,bx,cx)/8);i<=Math.floor(Math.max(ax,bx,cx)/8);i++)for(let j=Math.floor(Math.min(ay,by,cy)/8);j<=Math.floor(Math.max(ay,by,cy)/8);j++){const key=i+','+j,list=bins.get(key);if(list)list.push(tri);else bins.set(key,[tri]);}}
    const at=(x,y)=>{let h=null;for(const q of bins.get(Math.floor(x/8)+','+Math.floor(y/8))??[]){const u=((x-q.ax)*(q.cy-q.ay)-(y-q.ay)*(q.cx-q.ax))/q.den,v=((q.bx-q.ax)*(y-q.ay)-(q.by-q.ay)*(x-q.ax))/q.den;
     if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6){const z=q.az*(1-u-v)+q.bz*u+q.cz*v;h=h===null?z:Math.max(h,z);}}return h;};
    const stride=Math.max(1,Math.floor(idx.count/3/1000));
    for(let k=0;k<idx.count;k+=3*stride){const ids=[idx.getX(k),idx.getX(k+1),idx.getX(k+2)];for(const weights of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]){const x=ids.reduce((s,id,i)=>s+p.getX(id)*weights[i],0),y=ids.reduce((s,id,i)=>s+p.getY(id)*weights[i],0),z=ids.reduce((s,id,i)=>s+p.getZ(id)*weights[i],0),h=at(x,y);if(h===null)continue;checked++;if(h-z>.005){buried++;maxIntrusion=Math.max(maxIntrusion,h-z);}}}
   }
   const sorted=frames.slice().sort((a,b)=>a-b),q=p=>sorted[Math.floor((sorted.length-1)*p)];
   return{events:events.map(({old,next,...e})=>e),snapshots,terrainRefreshes:refresh,roadClearance:{tiles,checked,buried,maxIntrusion},performance:{renderedFrames:frames.length,averageFps:frames.length/66,minOneSecondFps:Math.min(...windows),p95Ms:q(.95),p99Ms:q(.99),maxMs:Math.max(...frames),canvas:[n.canvas.width,n.canvas.height],pixelRatios:[...ratios],renderer:'tidewater-webgpu',quality:document.querySelector('.re-holo-stage')?.dataset.quality},rail:r.inspect()};
  }''')
  result.update(errors=errors,muted=True,chrome=b.version,place=place)
  page.screenshot(path=str(out/'scene.png'))
  result['cleanup']=page.evaluate('''async()=>{const r=window.__holoStageAny.current.rail,n=window.__holoNative,objects=[],geometries=new Set();r.group.traverse(o=>{if(o.isMesh){objects.push(o);const m=n.meshes.get(o);if(m)geometries.add(m.geometry);}});r.dispose();await new Promise(resolve=>setTimeout(resolve,700));return{railEntries:r.entries.size,stationOwners:r.stations.size,remainingNativeRailMeshes:objects.filter(o=>n.meshes.has(o)).length,remainingNativeRailGeometries:[...geometries].filter(g=>n.renderer.geometries.has(g)).length};}''')
  (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
  events=result['events']
  print(json.dumps({'events':len(events),'railReplacements':sum(e['kind']=='rail' for e in events),'stationUpdates':sum(e['kind']=='station' for e in events),'replacedObjects':sum(not e['sameObject'] for e in events),'gapFrames':sum(e['gapFrames'] for e in events),'unfinished':sum(not e['done'] for e in events),'roadClearance':result['roadClearance'],'performance':result['performance'],'cleanup':result['cleanup'],'errors':errors},ensure_ascii=False))
 finally:b.close()
