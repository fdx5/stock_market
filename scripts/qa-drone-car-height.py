"""Muted Chrome flight plus a real rendered car crossing a fragmented lane seam."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1]
port,label=int(sys.argv[1]),sys.argv[2]
out=root/'tmp/car-height'/label
if out.exists():raise SystemExit('Use a fresh evidence label')
out.mkdir(parents=True)
errors=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
 try:
  page=b.new_page(viewport={'width':1440,'height':1000})
  page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});navigator.sendBeacon=()=>false")
  page.on('pageerror',lambda e:errors.append(str(e)[:300]))
  page.goto(f'http://127.0.0.1:{port}/drone-review/mangmi',wait_until='domcontentloaded')
  page.wait_for_function('window.__drone && window.__holoNative?.shown && window.__drone.world.traffic.cars.length',timeout=90000)
  page.wait_for_timeout(8000)
  result=page.evaluate('''async()=>{
   const d=window.__drone,w=d.world,n=window.__holoNative,test=new w.traffic.constructor(7),h=w.groundAt(0,0)+.08;
   const pack=p=>new Float32Array([p.length,16,...p.flat()]);
   test.addTile('test-from',pack([[-100,0,h],[-.00001,0,h],[0,0,h+.01]]));
   test.addTile('test-to',pack([[0,3.5,h+.01],[.00001,3.5,h],[100,3.5,h]]));
   const from=test.lanes.get('test-from')[0],to=test.lanes.get('test-to')[0],car=from.cars[0];from.cars.length=0;to.cars.length=0;test.cars=[car];from.cars.push(car);car.s=98;car.v=car.vmax=10;w.root.add(test.group);
   const camera=d.p.camera.position.clone();camera.set(0,150,0);
   const started=performance.now(),frames=[],windows=[],ratios=new Set(),transitions=new Set();let last=started,windowAt=started,windowFrames=0,launches=0,mergeFrames=0,nativePreparedFrames=0,minHeight=Infinity,maxHeight=-Infinity,complete=false;
   const tick=d.tick;d.tick=function(...args){const s=Math.max(0,(performance.now()-started)/1000-8),speed=200/3.6,y=s<18?s*speed:s<36?1000-(s-18)*speed:0;this.flight.auto=false;this.flight.pos.set(0,w.groundAt(0,y)+120,-y);this.flight.vel.set(0,0,0);this.flight.yaw=s<18?0:Math.PI;this.flight.pitch=.35;this.flight.roll=0;return tick.apply(this,args);};
   const render=n.render;n.render=function(...args){
    test.update(.016,camera);mergeFrames+=!!car.via;complete ||=car.lane===to&&!car.via;
    const source=test.near[car.kind]?.count?test.near[car.kind]:test.far;if(source.count){const z=source.instanceMatrix.array[13];minHeight=Math.min(minHeight,z-h);maxHeight=Math.max(maxHeight,z-h);if(!Number.isFinite(z)||z<h-.0001||z>h+.0101)launches++;}
    for(const c of w.traffic.cars)if(c.via)transitions.add(c.via);
    const result=render.apply(this,args),now=performance.now();frames.push(now-last);last=now;windowFrames++;ratios.add(this.canvas.width/1440);
    if(now-windowAt>=1000){windows.push(windowFrames*1000/(now-windowAt));windowAt=now;windowFrames=0;}
    const native=n.meshes.get(source);if(native&&n.renderer.geometryReady(native,native.material))nativePreparedFrames++;
    return result;};
   await new Promise(resolve=>{const loop=()=>performance.now()-started<66000?requestAnimationFrame(loop):resolve();requestAnimationFrame(loop);});
   n.render=render;d.tick=tick;const owned=[];test.group.traverse(o=>{if(o.isMesh)owned.push(o);});test.dispose();await new Promise(resolve=>setTimeout(resolve,700));
   const sorted=frames.slice().sort((a,b)=>a-b),q=p=>sorted[Math.floor((sorted.length-1)*p)];
   return{car:{launches,mergeFrames,completed:complete,nativePreparedFrames,minHeightAboveRoad:minHeight,maxHeightAboveRoad:maxHeight,realNetworkCurvesObserved:transitions.size,remainingNativeTestMeshes:owned.filter(o=>n.meshes.has(o)).length},performance:{renderedFrames:frames.length,averageFps:frames.length/66,minOneSecondFps:Math.min(...windows),p95Ms:q(.95),p99Ms:q(.99),maxMs:Math.max(...frames),canvas:[n.canvas.width,n.canvas.height],pixelRatios:[...ratios],quality:document.querySelector('.re-holo-stage')?.dataset.quality,renderer:'tidewater-webgpu'}};
  }''')
  result.update(errors=errors,chrome=b.version,muted=True)
  (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
  page.screenshot(path=str(out/'scene.png'))
  print(json.dumps(result,ensure_ascii=False))
  assert not errors and result['car']['launches']==0
  assert result['car']['mergeFrames']>0 and result['car']['completed'] and result['car']['nativePreparedFrames']>0
  assert result['car']['remainingNativeTestMeshes']==0
 finally:b.close()
