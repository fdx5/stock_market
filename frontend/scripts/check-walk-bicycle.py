"""Read-only outdoor/indoor flow QA. No DB cleanup, seeding or resolution changes."""
import argparse
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--base',default='http://127.0.0.1:5197')
parser.add_argument('--out',default='../tmp/walk-bicycle-qa')
parser.add_argument('--mobile',action='store_true')
parser.add_argument('--measure',action='store_true')
parser.add_argument('--sindo',action='store_true')
parser.add_argument('--outdoor-only',action='store_true')
args=parser.parse_args()
out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
complex_id='41150%3A%ED%98%B8%EC%9B%90%EB%8F%99%3A401-1%3A%EC%8B%A0%EB%8F%846' if args.sindo else '11680%3A%EB%8C%80%EC%B9%98%EB%8F%99%3A316%3A%EC%9D%80%EB%A7%88'
url=args.base+'/walk?id='+complex_id+'&hour=14&debug=1'
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    page=browser.new_page(viewport={'width':390 if args.mobile else 1440,'height':844 if args.mobile else 900},device_scale_factor=2 if args.mobile else 1,is_mobile=args.mobile,has_touch=args.mobile)
    errors=[]; shader_errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda message:shader_errors.append(message.text[:500]) if message.type=='error' and ('Shader' in message.text or 'VALIDATE' in message.text) else None)
    page.goto(url,wait_until='domcontentloaded')
    try:
        page.wait_for_function('()=>window.__walk?.game?.entrances.length>0 && !document.querySelector(".wk-loading")',timeout=180000)
    except Exception:
        print(json.dumps({'stage':'outdoor','errors':errors,'shaderErrors':shader_errors,'screen':page.locator('body').inner_text()[:1200]},ensure_ascii=False)); raise
    initial=page.evaluate('''()=>{const g=window.__walk.game;return {entrances:g.entrances.length,bikes:g.bicycles.records.size,gateBikes:[...g.bicycles.records.values()].filter(b=>b.id.startsWith('gate:')).length,facade:g.mats.facades.apt.userData.walkSurfaceQuality,buffer:[g.renderer.domElement.width,g.renderer.domElement.height],dpr:g.renderer.getPixelRatio()}}''')
    print(json.dumps({'initial':initial}),flush=True)
    page.screenshot(path=str(out/'outdoor-before.png'))
    # Fresh arrivals can ride without going indoors. Repeat the reported UI sequence.
    page.get_by_role('button',name='🚲 자전거 타기 E',exact=False).wait_for(timeout=15000)
    repeats=[]
    for cycle in range(8):
        page.get_by_role('button',name='🚲 자전거 타기 E',exact=False).click()
        page.wait_for_timeout(180)
        repeats.append(page.evaluate('''()=>{const g=window.__walk.game,p=g.avatar.root.position.clone();p.y+=1;const projected=p.project(g.camera);return {riding:g.cycling,visible:g.avatar.root.visible,pose:g.avatar.pose,view:g.view,position:[g.pos.x,g.pos.y],avatar:[g.avatar.root.position.x,g.avatar.root.position.y,g.avatar.root.position.z],projected:[projected.x,projected.y,projected.z],camera:g.camera.position.toArray()}}'''))
        page.get_by_role('button',name='자전거 내리기 E',exact=False).click()
        page.wait_for_timeout(180)
        repeats.append(page.evaluate('''()=>{const g=window.__walk.game,p=g.avatar.root.position.clone();p.y+=1;const projected=p.project(g.camera);return {riding:g.cycling,visible:g.avatar.root.visible,pose:g.avatar.pose,view:g.view,position:[g.pos.x,g.pos.y],avatar:[g.avatar.root.position.x,g.avatar.root.position.y,g.avatar.root.position.z],projected:[projected.x,projected.y,projected.z],camera:g.camera.position.toArray()}}'''))
    (out/'repeat-visibility.json').write_text(json.dumps(repeats,indent=2),encoding='utf-8')
    assert all(r['visible'] and abs(r['projected'][0])<1 and abs(r['projected'][1])<1 and r['projected'][2]<1 for r in repeats),repeats
    # Move to an existing surveyed entrance, then use the same entry UI as the player.
    page.evaluate('()=>{const g=window.__walk.game;const e=g.entrances.find(e=>e.name.includes(g.o.complexName)||g.o.complexName.includes(e.name))??g.entrances[0];window.__bikeTestDoor=e;g.placeAt(e,2.2)}')
    if not args.outdoor_only:
        page.get_by_role('button',name='건물 들어가기',exact=True).click()
        page.get_by_role('button',name='🛗 올라가기').wait_for(timeout=45000)
        page.get_by_role('button',name='🛗 올라가기').click()
        page.wait_for_function('()=>window.__walk?.interior?.running',timeout=120000)
        page.screenshot(path=str(out/'interior.png'))
        page.get_by_role('button',name='나가기',exact=False).click()
        page.get_by_role('button',name='🚲 자전거 타기 E',exact=False).wait_for(timeout=20000)
        page.screenshot(path=str(out/'bicycle-at-dong.png'))
    else:
        page.evaluate('()=>window.__walk.game.returnFromInterior(window.__bikeTestDoor)')
    counts=page.evaluate('()=>{const g=window.__walk.game;return {all:g.bicycles.records.size,dong:[...g.bicycles.records.values()].filter(b=>!b.id.startsWith("gate:")).length}}')
    assert counts['dong']>0,counts
    door_id=page.evaluate('()=>window.__bikeTestDoor.name+"|"+window.__bikeTestDoor.dong')
    assert page.evaluate('(id)=>window.__walk.game.bicycles.records.has(id)',door_id)
    page.get_by_role('button',name='🚲 자전거 타기 E',exact=False).click()
    page.locator('[data-bike-speed]').wait_for()
    assert page.evaluate('()=>window.__walk.game.cycling')
    page.wait_for_timeout(120)
    assert page.evaluate('()=>{const g=window.__walk.game,c=g.camera.position;return g.world.buildingAt([c.x,-c.z])<=c.y}'),'chase camera entered a building'
    page.screenshot(path=str(out/'mounted.png'))
    touch_controls=None
    if args.mobile:
        cdp=page.context.new_cdp_session(page)
        origin=page.evaluate('()=>({x:window.__walk.game.pos.x,y:window.__walk.game.pos.y})')
        first={'x':70,'y':600,'id':1}
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[first]})
        first={'x':70,'y':500,'id':1}
        cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[first]})
        page.wait_for_timeout(1000)
        travelled=page.evaluate('(p)=>Math.hypot(window.__walk.game.pos.x-p.x,window.__walk.game.pos.y-p.y)',origin)
        assert travelled>.1,travelled
        rect=page.get_by_role('button',name='브레이크',exact=True).bounding_box()
        second={'x':rect['x']+rect['width']/2,'y':rect['y']+rect['height']/2,'id':2}
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[first,second]})
        page.wait_for_timeout(600)
        assert page.evaluate('()=>window.__walk.game.bicycleMotion.speed')==0
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        assert page.evaluate('()=>window.__walk.game.stick.length()===0&&!window.__walk.game.keys.has("Space")')
        touch_controls={'joystickTravelMetres':round(travelled,2),'twoFingerBrake':True,'releasedCleanly':True}
    # Verify real-frame keyboard acceleration, steering and braking in the surveyed scene.
    page.keyboard.down('w'); page.wait_for_timeout(3500); page.keyboard.up('w')
    speed=page.evaluate('()=>window.__walk.game.bicycleMotion.speed*3.6')
    assert 0<=speed<=60,speed
    page.wait_for_timeout(160)
    audio=page.evaluate('''()=>{const s=window.__walk.game.o.sound;return {context:s.ctx?.state,coastingGain:s.bicycleNode?.channels[3].gain.gain.value,speed:window.__walk.game.bicycleMotion.speed}}''')
    assert audio['context']=='running',audio
    if audio['speed']>.1: assert audio['coastingGain']>0,audio
    page.keyboard.down('Space')
    page.wait_for_timeout(120)
    audio['brakeGain']=page.evaluate('()=>window.__walk.game.o.sound.bicycleNode?.channels[4].gain.gain.value??0')
    if audio['speed']>2: assert audio['brakeGain']>0,audio
    page.wait_for_function('()=>window.__walk.game.bicycleMotion.speed===0',timeout=5000)
    page.keyboard.up('Space')
    page.keyboard.press('e')
    assert not page.evaluate('()=>window.__walk.game.cycling')
    assert page.evaluate('()=>window.__walk.game.avatar.pose')=='stand'
    assert page.evaluate('()=>window.__walk.game.o.sound.bicycleNode?.stopped??true')
    page.get_by_role('button',name='효과음 끄기',exact=True).click()
    assert page.evaluate('()=>window.__walk.game.o.sound.master.gain.value')==0
    page.get_by_role('button',name='효과음 켜기',exact=True).click()
    assert abs(page.evaluate('()=>window.__walk.game.o.sound.master.gain.value')-.8)<1e-6
    # Repeated exits of the same apartment reuse its one record, not a fresh bike per exit.
    repeated=page.evaluate('''()=>{const g=window.__walk.game;const e=window.__bikeTestDoor;g.returnFromInterior(e);g.returnFromInterior(e);return [...g.bicycles.records.values()].filter(b=>!b.id.startsWith('gate:')).length}''')
    assert repeated>=counts['dong'],repeated
    assert page.evaluate('(id)=>[...window.__walk.game.bicycles.records.values()].filter(b=>b.id===id).length',door_id)==1
    performance=None
    if args.measure:
        page.keyboard.press('e')
        assert page.evaluate('()=>window.__walk.game.cycling')
        page.wait_for_timeout(600)
        page.keyboard.down('w')
        performance=page.evaluate('''()=>new Promise(resolve=>{const g=window.__walk.game,frames=[],start=performance.now();let last=start,maxSpeed=0;function sample(now){frames.push({t:now-start,dt:now-last});last=now;maxSpeed=Math.max(maxSpeed,g.bicycleMotion.speed*3.6);if(now-start<10000){requestAnimationFrame(sample);return;}const full=Math.floor((now-start)/1000),bins=Array.from({length:full},(_,i)=>frames.filter(f=>f.t>=i*1000&&f.t<(i+1)*1000).length);const sorted=frames.map(f=>f.dt).sort((a,b)=>a-b);const gl=g.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');resolve({fps:frames.length/(now-start)*1000,minOneSecondFps:Math.min(...bins),p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],worst:sorted.at(-1),maxSpeedKmh:maxSpeed,buffer:[g.renderer.domElement.width,g.renderer.domElement.height],dpr:g.renderer.getPixelRatio(),drawCalls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'',renderer:'Chrome WebGL2',headless:true,bins});}requestAnimationFrame(sample)})''')
        page.keyboard.up('w')
        page.screenshot(path=str(out/'cycling-measured.png'))
    assert not errors,errors
    assert not shader_errors,shader_errors
    result={'initial':initial,'indoorSkipped':args.outdoor_only,'afterIndoor':counts,'realSceneSpeedKmh':round(speed,2),'repeatedExitBikeCount':repeated,'repeatMountDismountCycles':8,'audio':audio,'touchControls':touch_controls,'performance':performance,'errors':errors,'shaderErrors':shader_errors}
    (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False),flush=True)
    # Inspect the actual loaded assets from close range after the flow/performance run.
    page.evaluate('()=>window.__walk.game.pause()')
    for kind in ['car','tree','avatar']:
        found=page.evaluate('''kind=>{
          const g=window.__walk.game;g.scene.updateMatrixWorld(true);let chosen=null,best=Infinity;
          if(kind==='avatar'){
            if(g.cycling)g.interactBicycle();g.avatar.root.visible=true;
            const p=g.avatar.root.position.clone(),forward=g.avatar.root.getWorldDirection(p.clone());
            g.camera.position.copy(p).addScaledVector(forward,2.7);g.camera.position.y+=1.35;
            p.y+=1.02;g.camera.lookAt(p);g.renderer.render(g.scene,g.camera);return true;
          }
          g.scene.traverse(mesh=>{
            if(!mesh.isInstancedMesh||!mesh.count)return;
            if(kind==='car'&&!mesh.material.userData.carModel)return;
            if(kind==='tree'&&!mesh.material.userData.walkSurfaceQuality?.startsWith('photographic-leaf'))return;
            const matrix=g.camera.matrixWorld.clone(),p=g.camera.position.clone();
            for(let i=0;i<mesh.count;i++){
              mesh.getMatrixAt(i,matrix);p.setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);
              const distance=Math.hypot(p.x-g.pos.x,p.z+g.pos.y);
              if(distance<best){best=distance;chosen=p.clone();}
            }
          });
          if(!chosen)return false;g.avatar.root.visible=false;
          const distance=kind==='car'?4.6:9;
          for(const angle of [.7,2.2,3.8,5.4]){
            g.camera.position.copy(chosen);g.camera.position.x+=Math.cos(angle)*distance;g.camera.position.z+=Math.sin(angle)*distance;g.camera.position.y+=kind==='car'?2:4.3;
            if(g.world.buildingAt([g.camera.position.x,-g.camera.position.z])<g.camera.position.y)break;
          }
          chosen.y+=kind==='car'?.7:4;g.camera.lookAt(chosen);g.renderer.render(g.scene,g.camera);return true;
        }''',kind)
        if found: page.screenshot(path=str(out/(kind+'-detail.png')))
    browser.close()
