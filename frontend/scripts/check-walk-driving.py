"""Fresh muted Chrome driving QA; app data stays read-only and session-local."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:5197');parser.add_argument('--out',default='../tmp/walk-driving');parser.add_argument('--mobile',action='store_true');parser.add_argument('--hour',type=int,default=14);parser.add_argument('--eunma',action='store_true');args=parser.parse_args()
out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    page=browser.new_page(viewport={'width':390 if args.mobile else 1440,'height':844 if args.mobile else 900},device_scale_factor=2 if args.mobile else 1,is_mobile=args.mobile,has_touch=args.mobile)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.on('console',lambda m:errors.append(m.text[:800]) if m.type=='error' and ('Shader' in m.text or 'VALIDATE' in m.text) else None)
    complex_id='11680%3A%EB%8C%80%EC%B9%98%EB%8F%99%3A316%3A%EC%9D%80%EB%A7%88' if args.eunma else '41150%3A%ED%98%B8%EC%9B%90%EB%8F%99%3A401-1%3A%EC%8B%A0%EB%8F%846'
    page.goto(args.base+f'/walk?id={complex_id}&hour={args.hour}&debug=1',wait_until='domcontentloaded')
    page.wait_for_function('()=>window.__walk?.game?.parkedCars?.records.size>0&&!document.querySelector(".wk-loading")',timeout=240000)
    page.evaluate('''()=>{const g=window.__walk.game;window.__costs={};for(const [key,object,method] of [['lighting',g.nightLighting,'update'],['worldUpload',g.world,'frame'],['ground',g.ground,'update'],['carBatches',g.carBatches,'update'],['render',g.renderer,'render']]){if(!object)continue;const old=object[method].bind(object),data=window.__costs[key]=[];object[method]=(...args)=>{const t=performance.now(),result=old(...args);data.push(performance.now()-t);return result;};}}''')
    setup=page.evaluate('''()=>{
      const g=window.__walk.game;let selected=null,best=-1,sign=1;
      for(const car of g.parkedCars.records.values()){
        if(Math.hypot(car.x,car.y)>230)continue;const hx=Math.cos(car.heading),hy=Math.sin(car.heading);
        for(const direction of [1,-1]){let free=0;
          for(let d=car.length*.6;d<22;d+=1){const x=car.x+hx*d*direction,y=car.y+hy*d*direction,b={...car.body,x,y};
            const pts=[];for(const a of [-car.length/2,0,car.length/2])for(const w of [-car.width/2,0,car.width/2])pts.push(x+hx*a-hy*w,y+hy*a+hx*w);
            if(g.world.buildingAt(pts)>0||g.world.wetAt(x,y)||g.parkedCars.blocks(b,car.id)||g.ground.blocks(b)||g.nightLighting?.blocks(x,y,b.hx,b.hy,b.length/2,b.width/2)||g.world.readiness(x,y,18)<.9)break;free=d;
          }
          if(free>best){best=free;selected=car;sign=direction;}
        }
      }
      if(!selected)throw Error('No parked car available');window.__driveTestCar=selected;
      for(const side of [1,-1]){const hx=Math.cos(selected.heading),hy=Math.sin(selected.heading),off=selected.width/2+.8,x=selected.x-hy*off*side,y=selected.y+hx*off*side;
        if(!g.blocked(x,y,1,0)){g.pos.set(x,y);g.z=g.world.surfaceAt(x,y);g.camInit=false;g.placeCamera(0,true);return {kind:selected.kind,id:selected.id,free:best,sign,count:g.parkedCars.records.size};}}
      throw Error('No safe position next to selected car');
    }''')
    page.wait_for_timeout(180);page.screenshot(path=str(out/'boarding-prompt.png'))
    page.keyboard.press('f');page.locator('[data-car-speed]').wait_for(timeout=15000)
    page.wait_for_function('()=>window.__walk.game.driving&&window.__walk.game.drivenCars.active.record.separate')
    mounted=page.evaluate('()=>{const a=window.__walk.game.drivenCars.active;return {kind:a.record.kind,engine:a.profile.engine,bank:a.audio.bank,topKmh:a.profile.topKmh,layout:a.profile.layout,audioContext:window.__walk.game.o.sound.audioGraph.ctx.state}}')
    page.screenshot(path=str(out/'mounted-third.png'))
    rear=page.evaluate('()=>{const g=window.__walk.game,a=g.drivenCars.active,b=a.vehicle.body,before=g.camera.position.clone();g.look(2.5,1.1);g.placeCamera(1/60,false);const dx=g.camera.position.x-b.x,dy=-g.camera.position.z-b.y;return {cross:dx*b.hy-dy*b.hx,behind:dx*b.hx+dy*b.hy,height:g.camera.position.y-a.record.z,limit:a.record.height*.5+1.21,mouseMoved:before.distanceTo(g.camera.position)}}')
    assert abs(rear['cross'])<.0001 and rear['behind']<0 and rear['height']<=rear['limit'] and rear['mouseMoved']<.001,rear
    key='w' if setup['sign']>0 else 's';page.keyboard.down(key);page.wait_for_timeout(1700);page.keyboard.down('a');page.wait_for_timeout(400);page.keyboard.up('a');page.keyboard.up(key)
    motion=page.evaluate('()=>{const a=window.__walk.game.drivenCars.active;return {speed:a.vehicle.body.speed,steer:a.vehicle.steer,wheelSpin:a.visual.wheels[0].children[0].rotation.x,engineGain:a.audio?.engineGain.gain.value}}')
    assert abs(motion['wheelSpin'])>.01,motion
    assert motion['engineGain']>0,motion
    assert abs(motion['speed'])>1,motion
    page.keyboard.press('v');page.wait_for_timeout(200)
    assert page.evaluate('()=>window.__walk.game.view')=='first'
    assert page.evaluate('()=>window.__walk.game.drivenCars.active.visual.cabin.group.visible')
    page.screenshot(path=str(out/'cockpit-first.png'))
    page.keyboard.down('Space');page.wait_for_function('()=>Math.abs(window.__walk.game.drivenCars.active.vehicle.body.speed)<.02',timeout=6000);page.keyboard.up('Space')
    # Exit directly from first person: this was the reported ground-facing camera bug.
    page.keyboard.press('f');page.wait_for_function('()=>!window.__walk.game.driving')
    assert page.evaluate('()=>window.__walk.game.avatar.pose')=='stand'
    page.wait_for_timeout(150)
    assert page.evaluate('()=>window.__walk.game.avatar.root.visible')
    restored=page.evaluate('()=>{const g=window.__walk.game;return {view:g.view,pitch:g.pitch,up:g.camera.up.toArray(),cameraHeight:g.camera.position.y-g.z,fov:g.camera.fov}}')
    assert restored['view']=='third' and abs(restored['pitch']+.12)<.001 and restored['cameraHeight']>1 and restored['up']==[0,1,0],restored
    memory=[]
    for i in range(5):
        page.keyboard.press('f');page.wait_for_function('()=>window.__walk.game.driving')
        if i%2==0:page.keyboard.press('v')
        page.keyboard.press('f');page.wait_for_function('()=>!window.__walk.game.driving');page.wait_for_timeout(100)
        assert page.evaluate('()=>window.__walk.game.view==="third"&&window.__walk.game.avatar.root.visible&&window.__walk.game.camera.up.y===1')
        memory.append(page.evaluate('()=>({geometries:window.__walk.game.renderer.info.memory.geometries,textures:window.__walk.game.renderer.info.memory.textures})'))
    page.screenshot(path=str(out/'dismounted.png'))
    lighting=page.evaluate('()=>{const g=window.__walk.game,l=g.nightLighting;return {stats:l.stats,overlaps:l.sites.filter(s=>g.parkedCars.cameraBlocked(s.x,s.y,s.z+.4,.3)).length}}')
    assert lighting['overlaps']==0,lighting
    # Same fixed output dimensions; actual driving render frames, not a timer FPS estimate.
    page.keyboard.press('f');page.wait_for_function('()=>window.__walk.game.driving');page.keyboard.down('w')
    perf=page.evaluate('''()=>new Promise(resolve=>{const g=window.__walk.game,start=performance.now(),frames=[];let last=start;function frame(now){frames.push({t:now-start,dt:now-last});last=now;if(now-start<10000){requestAnimationFrame(frame);return;}const sorted=frames.map(f=>f.dt).sort((a,b)=>a-b),bins=Array.from({length:10},(_,i)=>frames.filter(f=>f.t>=i*1000&&f.t<(i+1)*1000).length),gl=g.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');resolve({fps:frames.length/(now-start)*1000,minOneSecondFps:Math.min(...bins),p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],worst:sorted.at(-1),bins,buffer:[g.renderer.domElement.width,g.renderer.domElement.height],dpr:g.renderer.getPixelRatio(),calls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):''});}requestAnimationFrame(frame);})''')
    page.keyboard.up('w');page.screenshot(path=str(out/'driving-measured.png'))
    assert not errors,errors
    costs=page.evaluate('()=>Object.fromEntries(Object.entries(window.__costs).map(([k,a])=>{a.sort((a,b)=>a-b);return [k,{p95:a[Math.floor(a.length*.95)],max:a.at(-1),mean:a.reduce((s,v)=>s+v,0)/a.length}]}))')
    result={'setup':setup,'mounted':mounted,'rearCamera':rear,'motion':motion,'restored':restored,'repeatedMounts':5,'memory':memory,'lighting':lighting,'performance':perf,'cpuCostsMs':costs,'errors':errors}
    (out/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result),flush=True);browser.close()
