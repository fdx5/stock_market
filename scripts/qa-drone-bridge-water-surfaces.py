"""Compare bridge pavement against every visible water triangle, memory-only QA."""
import json,sys
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1];port=int(sys.argv[1]);label=sys.argv[2]
out=root/'tmp/drone-bridge-water'/label;out.mkdir(parents=True,exist_ok=True)
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})")
        page.on('pageerror',lambda e:errors.append(str(e)[:300]))
        q=urlencode({'complex':'26500:망미동:209-4:한성기린','hour':12,'fps':1,'dronedebug':1})
        page.goto(f'http://127.0.0.1:{port}/drone-explore?'+q,wait_until='domcontentloaded')
        page.wait_for_function("window.__drone?.world.region?.field && document.querySelector('.re-holo-stage')?.dataset.roadsReadyAt",timeout=180000)
        page.evaluate('''()=>{const d=window.__drone,r=d.p.data.roads.find(r=>r.link_id==='1430026200'),p=r.line[Math.floor(r.line.length/2)];window.__qaBridgePoint=p;d.flight.place(...p,d.world.groundAt(...p),85,0);d.flight.tilt=-1.1;}''')
        page.wait_for_timeout(10000)
        page.wait_for_function("()=>{const d=window.__drone,roads=[];d.p.scene.traverseVisible(m=>{if(m.isMesh&&m.geometry.attributes.roadLevel)roads.push(m);});return roads.length>0&&roads.every(m=>d.world.o.drawReady(m));}",timeout=90000)
        if '--double-sided' in sys.argv:
            page.evaluate("()=>{window.__drone.p.scene.traverseVisible(m=>{if(m.isMesh&&m.geometry.attributes.roadLevel){m.material.side=2;m.material.needsUpdate=true;}});}")
            page.wait_for_timeout(2000)
        page.wait_for_timeout(500)
        page.screenshot(path=str(out/'bridge.png'))
        result=page.evaluate('''()=>{
          const d=window.__drone,[cx,cy]=window.__qaBridgePoint,R=180,cell=32,waters=[],roads=[],pavement=[],cells=new Map();
          const world=(m,p,i)=>{const e=m.matrixWorld.elements,x=p.getX(i),y=p.getY(i),z=p.getZ(i);return[e[0]*x+e[4]*y+e[8]*z+e[12],-(e[2]*x+e[6]*y+e[10]*z+e[14]),e[1]*x+e[5]*y+e[9]*z+e[13]];};
          d.p.scene.updateMatrixWorld();
          d.p.scene.traverseVisible(m=>{
            if(!m.isMesh)return;const g=m.geometry,p=g.attributes.position,level=g.attributes.roadLevel;
            if(level){for(let i=0;i<p.count;i++){if(level.getX(i)<.5)continue;const v=world(m,p,i);if(Math.abs(v[0]-cx)<=R&&Math.abs(v[1]-cy)<=R)roads.push({v,name:m.name});}}
            if(m.name==='road surface'||m.material===d.world.asphalt)for(let k=0;k<(g.index?.count??p.count);k+=3){const index=j=>g.index?g.index.getX(j):j,a=world(m,p,index(k)),b=world(m,p,index(k+1)),c=world(m,p,index(k+2));if(Math.min(a[0],b[0],c[0])<=cx+R&&Math.max(a[0],b[0],c[0])>=cx-R&&Math.min(a[1],b[1],c[1])<=cy+R&&Math.max(a[1],b[1],c[1])>=cy-R)pavement.push({a,b,c,name:m.name});}
            if(!m.material?.userData?.water||!g.index)return;
            const w={name:m.name||m.parent?.name||'water',triangles:0,min:Infinity,max:-Infinity};waters.push(w);
            for(let k=0;k<g.index.count;k+=3){
              const a=world(m,p,g.index.getX(k)),b=world(m,p,g.index.getX(k+1)),c=world(m,p,g.index.getX(k+2));
              const x0=Math.max(cx-R,Math.min(a[0],b[0],c[0])),x1=Math.min(cx+R,Math.max(a[0],b[0],c[0])),y0=Math.max(cy-R,Math.min(a[1],b[1],c[1])),y1=Math.min(cy+R,Math.max(a[1],b[1],c[1]));
              if(x0>x1||y0>y1)continue;
              w.triangles++;w.min=Math.min(w.min,a[2],b[2],c[2]);w.max=Math.max(w.max,a[2],b[2],c[2]);
              const t={a,b,c,name:w.name};
              for(let i=Math.floor(x0/cell);i<=Math.floor(x1/cell);i++)for(let j=Math.floor(y0/cell);j<=Math.floor(y1/cell);j++){const key=i+','+j;let list=cells.get(key);if(!list)cells.set(key,list=[]);list.push(t);}
            }
          });
          let checked=0,submerged=0,minClearance=Infinity;const witnesses=[];
          for(const {v,name}of roads){let high=-Infinity,source='';
            for(const {a,b,c,name:water}of cells.get(Math.floor(v[0]/cell)+','+Math.floor(v[1]/cell))??[]){
              const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-9)continue;
              const u=((b[1]-c[1])*(v[0]-c[0])+(c[0]-b[0])*(v[1]-c[1]))/den,z=((c[1]-a[1])*(v[0]-c[0])+(a[0]-c[0])*(v[1]-c[1]))/den;
              if(u< -1e-7||z< -1e-7||u+z>1+1e-7)continue;
              const h=u*a[2]+z*b[2]+(1-u-z)*c[2];if(h>high){high=h;source=water;}
            }
            if(!Number.isFinite(high))continue;checked++;minClearance=Math.min(minClearance,v[2]-high);
            if(v[2]<=high+.05){submerged++;if(witnesses.length<12)witnesses.push({position:v,road:name,water:source,waterHeight:high});}
          }
          const at=(v,triangles)=>{let high=-Infinity;for(const {a,b,c}of triangles){const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-9)continue;const u=((b[1]-c[1])*(v[0]-c[0])+(c[0]-b[0])*(v[1]-c[1]))/den,z=((c[1]-a[1])*(v[0]-c[0])+(a[0]-c[0])*(v[1]-c[1]))/den;if(u>=-1e-7&&z>=-1e-7&&u+z<=1+1e-7)high=Math.max(high,u*a[2]+z*b[2]+(1-u-z)*c[2]);}return high;};
          const line=d.p.data.roads.find(r=>r.link_id==='1430026200').line,coverage={wetSamples:0,missing:0,submerged:0,witnesses:[]};
          for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));for(let k=0;k<=n;k++){const v=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n];if(Math.abs(v[0]-cx)>R||Math.abs(v[1]-cy)>R)continue;const water=at(v,cells.get(Math.floor(v[0]/cell)+','+Math.floor(v[1]/cell))??[]);if(!Number.isFinite(water))continue;coverage.wetSamples++;const road=at(v,pavement);if(!Number.isFinite(road))coverage.missing++;else if(road<=water+.05)coverage.submerged++;if((!Number.isFinite(road)||road<=water+.05)&&coverage.witnesses.length<12)coverage.witnesses.push({point:v,road:Number.isFinite(road)?road:null,water});}}
          const native=window.__holoNative,drawnRoads=[];d.p.scene.traverseVisible(m=>{if(!m.isMesh||!m.geometry.attributes.roadLevel)return;const mesh=native.meshes.get(m),material=mesh?.material;drawnRoads.push({name:m.name,ready:d.world.o.drawReady(m),nativeGeometryIsSource:mesh?.geometry===m.geometry,depthWrite:material?.depthWrite,depthTest:material?.depthTest,depthBias:material?.depthBias,depthBiasSlopeScale:material?.depthBiasSlopeScale});});
          return{center:[cx,cy],checked,submerged,minClearance,coverage,drawnRoads,waters:waters.filter(w=>w.triangles),witnesses};
        }''')
        page.evaluate("()=>window.__drone.p.scene.traverse(m=>{if(m.isMesh&&m.material?.userData?.water)m.visible=false;})")
        page.wait_for_timeout(500);page.screenshot(path=str(out/'bridge-water-hidden.png'))
        result.update(errors=errors,muted=True,chrome=browser.version)
        (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(result,ensure_ascii=False),flush=True)
        assert result['checked']>0 and not errors
        assert result['submerged']==0,'Bridge pavement intersects a visible water surface'
        assert result['coverage']['wetSamples']>0 and not result['coverage']['missing'] and not result['coverage']['submerged'],'Official bridge centreline has missing or submerged pavement'
    finally:browser.close()
