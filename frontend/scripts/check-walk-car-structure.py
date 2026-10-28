"""Inspect all real car meshes/cabins in an isolated muted Chrome scene."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:5197');parser.add_argument('--out',default='../tmp/walk-car-structure');args=parser.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio']);page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text[:1000]) if m.type=='error' and 'Shader' in m.text else None)
    page.route('**/car-structure-test',lambda r:r.fulfill(content_type='text/html',body='<title>Car structure review</title><style>body{margin:0}canvas{display:block}</style>'))
    page.goto(args.base+'/car-structure-test')
    kinds=page.evaluate('''async()=>{
      const T=await import('/node_modules/.vite/deps/three.js'),{loadWalkCarModels}=await import('/src/walkmode/ground/carModels.ts'),{realCarMaterial,carGlassMaterial}=await import('/src/walkmode/ground/carMaterial.ts'),{DrivingCars}=await import('/src/walkmode/game/DrivingCars.ts'),{ParkedCars}=await import('/src/walkmode/game/ParkedCars.ts');
      const models=await loadWalkCarModels(),paint=realCarMaterial(),glass=carGlassMaterial(),registry=new ParkedCars(),sound={resume(){},audioGraph:null};
      const cars=new DrivingCars(models,paint,glass,sound);await cars.prepare();const scene=new T.Scene();scene.background=new T.Color('#6da4ca');scene.add(cars.group,new T.HemisphereLight(0xe2efff,0x393029,2.2));const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(3,6,4);scene.add(sun);
      const floor=new T.Mesh(new T.PlaneGeometry(50,50).rotateX(-Math.PI/2),new T.MeshStandardMaterial({color:0x777b79}));scene.add(floor,new T.GridHelper(50,50));
      const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(1440,900);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
      const camera=new T.PerspectiveCamera(72,1.6,.05,200);window.review={T,models,cars,registry,scene,renderer,camera};return [...models.bodies.keys()];
    }''')
    results=[]
    for kind in kinds:
        data=page.evaluate('''kind=>{const {T,models,cars,registry,scene,renderer,camera}=window.review;cars.dismount();cars.group.children.forEach(o=>o.visible=false);const record=registry.provide(kind,new T.Matrix4().makeTranslation(0,0,0),new T.Color('#b6c5d0'),models.bodies.get(kind));record.id=kind;
          // One independent record per kind: registry IDs are positional in the game.
          registry.records.clear();registry.dispose();record.kind=kind;record.label=kind;const b=models.bodies.get(kind).boundingBox;record.length=b.max.z-b.min.z;record.width=b.max.x-b.min.x;record.height=b.max.y-b.min.y;
          cars.mount(record,{others:()=>[],building:()=>0,pole:()=>false});const a=cars.active;a.visual.root.visible=true;const yaw=Math.atan2(-a.vehicle.body.hx,a.vehicle.body.hy);cars.camera(camera,true,yaw,-.035,0,()=>0);scene.updateMatrixWorld(true);camera.updateMatrixWorld();renderer.render(scene,camera);
          const ray=new T.Raycaster(camera.position,new T.Vector3(0,1,0)),roof=ray.intersectObject(a.visual.lining)[0];
          const front=new T.Raycaster(camera.position,new T.Vector3(0,0,1).applyQuaternion(a.visual.root.quaternion)),obstruction=front.intersectObject(a.visual.lining)[0];
          let display; a.visual.cabin.group.traverse(o=>{if(o.material?.map?.isCanvasTexture)display=o;});
          const box=new T.Box3().setFromObject(display),corners=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new T.Vector3(x,y,z).project(camera).toArray());
          const roofSamples=[];for(const dx of [-.25,0,.25])for(const dz of [-.25,0,.25]){const up=new T.Raycaster(camera.position,new T.Vector3(dx,1,dz).normalize());roofSamples.push(up.intersectObjects([a.visual.lining,a.visual.cabin.group],true).some(h=>h.distance>.04&&h.distance<1));}
          let clear=0,total=0;for(const x of [-.6,-.3,0,.3,.6])for(const y of [.05,.25,.45]){const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(x,y),camera);const hits=ray.intersectObjects([a.visual.lining,a.visual.cabin.group,a.visual.exterior[0]],true);if(!hits.some(h=>h.distance<4))clear++;total++;}
          let exactRear=true;for(const angle of [-3.0,-1,0,.7,2.8]){a.vehicle.body.hx=Math.cos(angle);a.vehicle.body.hy=Math.sin(angle);a.vehicle.theta=angle;cars.pose(0,0);cars.camera(camera,false,angle+2.1,.3,1/60,()=>0);const dx=camera.position.x-a.vehicle.body.x,dy=-camera.position.z-a.vehicle.body.y;exactRear&&=Math.abs(dx*a.vehicle.body.hy-dy*a.vehicle.body.hx)<1e-5&&dx*a.vehicle.body.hx+dy*a.vehicle.body.hy<-(a.record.length*.5+1);}
          a.vehicle.body.hx=0;a.vehicle.body.hy=-1;a.vehicle.theta=-Math.PI/2;cars.pose(0,0);cars.camera(camera,true,0,.8,0,()=>0);renderer.render(scene,camera);
          return {kind,eye:a.profile.eye,roofDistance:roof?.distance??null,roofClosed:roofSamples.every(Boolean),exactRear,clearForwardFraction:clear/total,forwardObstruction:obstruction?.distance??null,opaqueVisible:a.visual.exterior[0].visible,displayVisible:corners.every(v=>Math.abs(v[0])<1&&Math.abs(v[1])<1&&v[2]<1)};
        }''',kind)
        page.screenshot(path=str(out/(kind+'-first.png')))
        results.append(data)
        if kind in ['sedan','suv','sport-coupe','van','cargo','bus']:
            for view in ['roof','side','outside','rear']:
                page.evaluate('''view=>{const {T,cars,scene,renderer,camera}=window.review,a=cars.active,yaw=Math.atan2(-a.vehicle.body.hx,a.vehicle.body.hy);if(view==='outside'){cars.camera(camera,false,yaw,-.12,0,()=>0);camera.position.set(3,1.65,3);camera.lookAt(0,1,0);}else if(view==='rear'){cars.camera(camera,false,yaw+2.2,.3,0,()=>0);}else{cars.camera(camera,true,yaw,-.035,0,()=>0);const y=view==='roof'?.8:-.025,angle=yaw+(view==='side'?1.1:0);camera.lookAt(camera.position.clone().add(new T.Vector3(-Math.sin(angle)*Math.cos(y),Math.sin(y),-Math.cos(angle)*Math.cos(y))));}renderer.render(scene,camera);}''',view)
                page.screenshot(path=str(out/(kind+'-'+view+'.png')))
    report={'cars':results,'errors':errors};(out/'result.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report),flush=True);browser.close()
    assert not errors,errors
    assert all(r['opaqueVisible'] and r['displayVisible'] and r['roofClosed'] and r['exactRear'] and r['clearForwardFraction']>=.6 and r['roofDistance'] is not None and .06<r['roofDistance']<1.0 for r in results),[r for r in results if not(r['opaqueVisible'] and r['displayVisible'] and r['roofClosed'] and r['exactRear'] and r['clearForwardFraction']>=.6 and r['roofDistance'] is not None and .06<r['roofDistance']<1)]
