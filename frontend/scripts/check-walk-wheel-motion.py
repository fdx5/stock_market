"""Muted Chrome QA of real traffic wheel shaders; preserves app data."""
import argparse,json,math
from pathlib import Path
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5197');p.add_argument('--out',default='../tmp/walk-wheel-motion');args=p.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']);page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1);errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text[:1800]) if m.type=='error' and ('Shader' in m.text or 'VALIDATE' in m.text) else None)
    page.route('**/wheel-motion-test',lambda r:r.fulfill(content_type='text/html',body='<title>Traffic wheel animation</title><style>body{margin:0}canvas{display:block}</style>'));page.goto(args.base+'/wheel-motion-test')
    setup=page.evaluate('''async()=>{
      const T=await import('/node_modules/.vite/deps/three.js'),{loadWalkCarModels}=await import('/src/walkmode/ground/carModels.ts'),{realCarMaterial,carGlassMaterial}=await import('/src/walkmode/ground/carMaterial.ts'),{CarBatches}=await import('/src/walkmode/ground/CarBatches.ts'),{carAxles,carWheelAttribute}=await import('/src/walkmode/ground/carWheelMotion.ts');
      const models=await loadWalkCarModels(),rigs=[];
      for(const [kind,g]of models.bodies){const axles=carAxles(g),tag=carWheelAttribute(g,axles),uv=g.getAttribute('uv');let tyres=0,bodyMoves=0;for(let i=0;i<tag.count;i++){if(Math.abs(tag.getW(i))>.01)tyres++;if(Math.floor(uv.getX(i)*16)===0&&Math.abs(tag.getW(i))>.01)bodyMoves++;}if(axles.length<2||tyres<30||bodyMoves)throw Error('Invalid wheel rig '+kind);rigs.push({kind,axles:axles.length,animatedVertices:tyres});}
      const paint=realCarMaterial(),glass=carGlassMaterial(),batches=new CarBatches(models,glass),scene=new T.Scene();scene.background=new T.Color('#96a5b0');scene.add(batches.group,new T.HemisphereLight(0xe3efff,0x453e36,2));const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(3,5,4);scene.add(sun);
      const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(1440,900);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);const camera=new T.PerspectiveCamera(54,1.6,.05,1000);
      const source=new T.InstancedMesh(models.bodies.get('sedan'),paint,2);source.count=1;source.setColorAt(0,new T.Color('#8c9ba7'));source.setMatrixAt(0,new T.Matrix4());const registration=batches.add(source);scene.add(source);
      window.wheels={T,models,paint,glass,batches,scene,renderer,camera,source,registration};
      camera.position.set(4.4,1.65,4.2);camera.lookAt(0,.7,0);camera.updateMatrixWorld();batches.update(camera);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);return {rigs,radius:carAxles(models.bodies.get('sedan'))[0].radius};
    }''')
    # Every frame follows the car, so image changes come from moving wheel/rim
    # geometry rather than translating the entire car across the screenshot.
    frames=[]
    for i in range(12):
        state=page.evaluate('''d=>{const w=window.wheels,{T,source,camera,batches,renderer,scene}=w;source.setMatrixAt(0,new T.Matrix4().makeTranslation(0,0,d));camera.position.set(4.4,1.65,4.2+d);camera.lookAt(0,.7,d);camera.updateMatrixWorld();batches.update(camera);renderer.render(scene,camera);const pool=[...batches.pools.values()][0],mesh=pool.meshes[0];return {travel:mesh.geometry.getAttribute('walkWheelMotion').getX(0),calls:renderer.info.render.calls};}''',i*math.tau*setup['radius']/12)
        file=out/f'rolling-{i:02d}.png';page.screenshot(path=str(file));frames.append(file)
    page.evaluate('''()=>{const w=window.wheels;w.batches.update(w.camera);w.renderer.render(w.scene,w.camera);}''');page.screenshot(path=str(out/'stationary.png'))
    last=np.asarray(Image.open(frames[-1]).convert('RGB')).astype(int);stationary=np.asarray(Image.open(out/'stationary.png').convert('RGB')).astype(int)
    stationary_difference=int(np.abs(last-stationary).max());assert stationary_difference<=3,'Stopped car still animates'
    first=np.asarray(Image.open(frames[0]).convert('RGB')).astype(int);changed=(np.abs(first-np.asarray(Image.open(frames[3]).convert('RGB')).astype(int)).max(2)>10).sum();assert changed>100,'Wheels did not change rendered pixels'
    check=page.evaluate('''()=>{const w=window.wheels,{T,source,camera,batches}=w;source.setMatrixAt(0,new T.Matrix4().makeTranslation(.05,0,2));batches.update(camera);let pool=[...batches.pools.values()][0],m=pool.meshes[0],before=m.geometry.getAttribute('walkWheelMotion').getX(0);source.setMatrixAt(0,new T.Matrix4().makeTranslation(.05,0,1.8));batches.update(camera);let reverse=m.geometry.getAttribute('walkWheelMotion').getX(0);const matrix=new T.Matrix4().makeRotationY(.12);matrix.setPosition(.08,0,1.95);source.setMatrixAt(0,matrix);batches.update(camera);const steering=m.geometry.getAttribute('walkWheelMotion').getY(0),lods=[];for(const distance of [8,45,100]){camera.position.set(0,2,1.95+distance);camera.lookAt(.08,1,1.95);camera.updateMatrixWorld();batches.update(camera);const mesh=pool.meshes.find(m=>m.count);lods.push({distance,motion:mesh.geometry.getAttribute('walkWheelMotion').getX(0),animated:mesh.geometry.hasAttribute('walkWheel')});}return {before,reverse,steering,lods};}''')
    assert check['reverse']<check['before'] and check['steering']>0 and all(l['animated'] for l in check['lods']),check
    assert max(l['motion'] for l in check['lods'])-min(l['motion'] for l in check['lods'])<.001,check
    assert not errors,errors
    images=[Image.open(f).convert('RGB').resize((960,600)) for f in frames];images[0].save(out/'traffic-wheels.gif',save_all=True,append_images=images[1:],duration=75,loop=0)
    result={'types':len(setup['rigs']),'rigs':setup['rigs'],'renderedChangedPixels':int(changed),'stationaryMaxChannelDifference':stationary_difference,'renderCalls':state['calls'],'motion':check,'errors':errors};(out/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result),flush=True);browser.close()
