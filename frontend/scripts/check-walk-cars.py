"""Fresh-browser /walk car asset, glazing and visual QA. No app DB mutations."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:5197');parser.add_argument('--out',default='../tmp/walk-cars-quality')
args=parser.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
public=Path(__file__).resolve().parents[1]/'public/3d'
original=json.loads((public/'cars.json').read_text())['kinds'];meta=json.loads((public/'walk/cars/cars.json').read_text())['kinds'];data=(public/'walk/cars/cars.bin').read_bytes()
added=set(meta)-set(original);assert len(added)>=20,len(added)
assert len({v['frontDesign'] for v in meta.values()})>=6
assert len({v['rearDesign'] for v in meta.values()})>=6
hashes=set()
for name,part in meta.items():
    positions=np.frombuffer(data,dtype='<f4',count=part['verts']*3,offset=part['pos']);assert np.isfinite(positions).all(),name
    indices=np.frombuffer(data,dtype='<u2',count=part['index'],offset=part['idx']);assert int(indices.max())<part['verts'],name
    uv=np.frombuffer(data,dtype='<u2',count=part['verts']*2,offset=part['uv']).reshape(-1,2)/65535
    slots=set(np.floor(uv[:,0]*16).astype(int));assert {0,1,3,9,14,15}<=slots,(name,slots)
    hashes.add(hashlib.sha256(positions.tobytes()).hexdigest())
assert len(hashes)==len(meta),'Duplicate car shapes'
report={'newTypes':len(added),'detailedTypes':len(meta),'totalTypes':len(set(meta)|set(original)),'frontFamilies':6,'rearFamilies':6,'uniqueGeometries':len(hashes)}

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda message:errors.append(message.text[:800]) if message.type=='error' and ('Shader' in message.text or 'VALIDATE' in message.text) else None)
    page.goto(args.base+'/walk?id=41150%3A%ED%98%B8%EC%9B%90%EB%8F%99%3A401-1%3A%EC%8B%A0%EB%8F%846&hour=14&debug=1',wait_until='domcontentloaded')
    page.wait_for_function('()=>window.__walk?.game?.entrances.length>0&&!document.querySelector(".wk-loading")',timeout=180000)
    report['runtime']=page.evaluate('''()=>{const g=window.__walk.game,meshes=[];g.scene.traverse(o=>{if(o.isInstancedMesh&&o.material.userData.carGlass)meshes.push(o);});return {quality:g.scene.userData.walkCarQuality,types:g.loadedCars.bodies.size,glazingMeshes:meshes.length,sharedTransforms:meshes.every(m=>m.instanceMatrix===m.parent.instanceMatrix),transparent:g.carGlass.transparent,depthWrite:g.carGlass.depthWrite,buffer:[g.renderer.domElement.width,g.renderer.domElement.height]}}''')
    assert report['runtime']['types']>=37,report
    assert report['runtime']['sharedTransforms'] and report['runtime']['glazingMeshes']>0,report
    page.evaluate('''async()=>{
      const T=await import('/node_modules/.vite/deps/three.js');const g=window.__walk.game;g.pause();
      const scene=new T.Scene();scene.background=new T.Color('#aeb7c1');scene.environment=g.scene.environment;
      scene.environmentIntensity=.8;const sun=new T.DirectionalLight('#fff6e7',3.2);sun.position.set(-3,6,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.5,far:25});sun.shadow.normalBias=.025;scene.add(sun);
      const fill=new T.HemisphereLight('#e2edff','#514b43',1.1);scene.add(fill);
      const floor=new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshStandardMaterial({color:'#757c82',roughness:.91}));floor.rotation.x=-Math.PI/2;floor.position.y=-.005;floor.receiveShadow=true;scene.add(floor);
      window.__carReview={T,scene,group:new T.Group()};scene.add(window.__carReview.group);
      document.querySelectorAll('.wk-topbar,.wk-help,.wk-prompt,.wk-bike-speed,.wk-bike-buttons,.wk-minimap').forEach(e=>e.style.display='none');
    }''')
    shots=[]
    for name,part in meta.items():
        for side in ['front','rear']:
            page.evaluate('''({name,side})=>{
              const g=window.__walk.game,{T,scene,group}=window.__carReview;group.clear();
              const body=new T.Mesh(g.loadedCars.bodies.get(name),g.carMaterial),glass=new T.Mesh(g.loadedCars.windows.get(name),g.carGlass);body.castShadow=body.receiveShadow=true;group.add(body,glass);
              const b=body.geometry.boundingBox,size=b.max.clone().sub(b.min),distance=Math.max(4.3,size.z*.9);
              g.camera.position.set(distance*.70,2.05,side==='front'?distance*.78:-distance*.78);g.camera.lookAt(0,size.y*.47,0);
              g.renderer.render(scene,g.camera);
            }''',{'name':name,'side':side})
            path=out/(name+'-'+side+'.png');page.locator('.wk-canvas').screenshot(path=str(path));shots.append((name,side,path))
    assert not errors,errors
    report['errors']=errors;browser.close()
font=ImageFont.truetype('C:/Windows/Fonts/malgun.ttf',18)
for side in ['front','rear']:
    subset=[s for s in shots if s[1]==side];w,h=420,290;cols=4;rows=(len(subset)+cols-1)//cols
    sheet=Image.new('RGB',(w*cols,h*rows),'#121b27');draw=ImageDraw.Draw(sheet)
    for index,(name,_,path) in enumerate(subset):
        im=Image.open(path).convert('RGB');im.thumbnail((w,h-32),Image.Resampling.LANCZOS);x=index%cols*w;y=index//cols*h
        sheet.paste(im,(x+(w-im.width)//2,y));draw.text((x+10,y+h-28),meta[name]['label'],font=font,fill='#d9edf4')
    sheet.save(out/('catalog-'+side+'.jpg'),quality=93)
(out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False),flush=True)
