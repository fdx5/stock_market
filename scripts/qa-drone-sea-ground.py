"""Public snapshot review: muted Chrome, no stored browser databases or live API."""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
label, port = sys.argv[1], int(sys.argv[2])
out = root / 'tmp/coast-review-20261010' / label
out.mkdir(parents=True, exist_ok=True)
origin = f'http://127.0.0.1:{port}'
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--mute-audio'])
    try:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})")
        page.on('pageerror', lambda e: errors.append(str(e)[:500]))
        page.on('console',lambda m:errors.append(m.text[:500]) if m.type=='error' and any(t in m.text.lower() for t in ('wgsl','shader','validation')) else None)
        page.route('**/*', lambda r: r.abort() if '/api/' in r.request.url and not r.request.url.startswith((origin+'/', 'http://127.0.0.1:8003/')) else r.continue_())
        place = next((arg for arg in sys.argv[3:] if arg in ('haeundae','mangmi')), 'haeundae')
        url = origin+'/drone-review/haeundae' if place == 'haeundae' else origin+'/drone-explore?'+urlencode({'complex':'26500:망미동:209-4:한성기린','hour':12,'fps':1,'dronedebug':1})
        page.goto(url, wait_until='domcontentloaded')
        page.wait_for_function('window.__drone?.world.region?.field', timeout=90000)
        if '--ready-roads' in sys.argv:
            page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.roadsReadyAt",timeout=180000)
        page.wait_for_timeout(10000)
        views = [('marine-coast',35.1552,129.1458,100,3.14,-.65), ('marine-offshore',35.1519,129.1500,100,0,-.7), ('haeundae-shore',35.1567,129.1618,55,0,-.42), ('gwangan-shore',35.1486,129.1202,50,1.4,-.5)]
        if place == 'mangmi':
            center=page.evaluate('window.__drone.world.o.data.center')
            bridges=page.evaluate('''()=>{const d=window.__drone,c=d.world.o.data.center,seen=new Set();return (d.world.o.data.roads??[]).filter(r=>r.structure==='bridge'&&r.structure_source).filter(r=>{const k=r.link_id??r.id;if(seen.has(k))return false;seen.add(k);return true;}).map(r=>{const l=r.line,p=l[Math.floor(l.length/2)];return {lat:c.lat+p[1]/110540,lon:c.lon+p[0]/(111320*Math.cos(c.lat*Math.PI/180)),link:r.link_id,profile:r.profile_line,line:r.line};}).slice(0,4);}''')
            (out/'bridge-profiles.json').write_text(json.dumps(bridges,indent=2),encoding='utf8')
            print(json.dumps({'bridgeCount':len(bridges),'links':[b['link'] for b in bridges]}),flush=True)
            views=[('mangmi-river',center['lat'],center['lon'],110,.6,-.6)]+[(f'mangmi-bridge-{i+1}',b['lat'],b['lon'],85,0,-1.1) for i,b in enumerate(bridges)]
        if '--one' in sys.argv: views=views[:1]
        if '--river-bridge' in sys.argv and place=='mangmi': views=views[-1:]
        results = []
        for name,lat,lon,h,yaw,tilt in views:
            page.evaluate('''a=>{const d=window.__drone,c=d.world.o.data.center,x=(a.lon-c.lon)*111320*Math.cos(c.lat*Math.PI/180),y=(a.lat-c.lat)*110540;d.flight.place(x,y,d.world.groundAt(x,y),a.h,a.yaw);d.flight.tilt=a.tilt;}''',dict(lat=lat,lon=lon,h=h,yaw=yaw,tilt=tilt))
            page.wait_for_timeout(7000)
            page.screenshot(path=str(out/(name+'.png')))
            result = page.evaluate('''async()=>{
              const d=window.__drone,f=d.world.region.field,meshes=[];
              d.p.scene.traverseVisible(m=>{if(m.isMesh&&m.material?.userData?.groundDetail&&m.material!==d.world.asphalt&&(m===d.p.ground||m===d.backdrop||m.geometry.userData.skirtGrid))meshes.push(m);});
              const ground=meshes.map(m=>{m.updateWorldMatrix(true,false);const p=m.geometry.attributes.position,idx=m.geometry.index,e=m.matrixWorld.elements,world=i=>{const x=p.getX(i),y=p.getY(i),z=p.getZ(i);return [e[0]*x+e[4]*y+e[8]*z+e[12],-(e[2]*x+e[6]*y+e[10]*z+e[14]),e[1]*x+e[5]*y+e[9]*z+e[13]];};let wet=0,above=0;const witnesses=[];
                for(let k=0;k<idx.count;k+=3){const v=[world(idx.getX(k)),world(idx.getX(k+1)),world(idx.getX(k+2))],x=v.reduce((s,a)=>s+a[0],0)/3,y=v.reduce((s,a)=>s+a[1],0)/3,z=v.reduce((s,a)=>s+a[2],0)/3;
                  if(x<f.bounds.x0||x>f.bounds.x1||y<f.bounds.y0||y>f.bounds.y1||!f.wet(x,y))continue;wet++;if(z>f.level(x,y)+.05){above++;if(witnesses.length<5)witnesses.push({x,y,z,shore:f.shore(x,y),level:f.level(x,y)});}}
                return {name:m.name||'near-ground',triangles:idx.count/3,wet,above,witnesses};});
              const structures=(d.world.o.data.roads??[]).filter(r=>r.structure==='bridge').map(r=>{const l=r.profile_line??r.line,a=l[0],b=l.at(-1);return {link:r.link_id,line:r.line,profile:l,ends:[d.p.terrain.at(...a),d.p.terrain.at(...b)],wetEnds:[f.wet(...a),f.wet(...b)],terrainRadius:d.p.terrain.grid?.R};});
              const surfaces=[];d.p.scene.traverse(m=>{if(!m.isMesh||!m.geometry.attributes.roadLevel)return;const p=m.geometry.attributes.position,level=m.geometry.attributes.roadLevel;let wet=0,submerged=0,min=Infinity,max=-Infinity;for(let i=0;i<p.count;i++){if(level.getX(i)<.5||!f.wet(p.getX(i),-p.getZ(i)))continue;wet++;const h=p.getY(i),water=f.level(p.getX(i),-p.getZ(i));if(h<=water+.12)submerged++;min=Math.min(min,h);max=Math.max(max,h);}if(wet)surfaces.push({name:m.name,wet,submerged,min,max});});
              let tidalOverlap=0;d.p.scene.traverseVisible(m=>{if(!m.isMesh||!m.material?.userData?.water||!m.geometry.attributes.aSea)return;const g=m.geometry,p=g.attributes.position,s=g.attributes.aSea,idx=g.index,e=m.matrixWorld.elements;if(!idx)return;for(let k=0;k<idx.count;k+=3){const v=[0,1,2].map(j=>idx.getX(k+j));if(v.some(i=>s.getX(i)>=.5))continue;const x=v.reduce((a,i)=>a+e[0]*p.getX(i)+e[4]*p.getY(i)+e[8]*p.getZ(i)+e[12],0)/3,y=-v.reduce((a,i)=>a+e[2]*p.getX(i)+e[6]*p.getY(i)+e[10]*p.getZ(i)+e[14],0)/3;if(f.wet(x,y))tidalOverlap++;}});
              await new Promise(requestAnimationFrame);
              const n=window.__holoNative,start=performance.now();let last=start,win=start,count=0,renderStart=n?.frameNo??0,winRender=renderStart;const dt=[],fps=[];
              await new Promise(resolve=>{const tick=t=>{dt.push(t-last);last=t;count++;if(t-win>=1000){const r=n?.frameNo??count;fps.push((r-winRender)*1000/(t-win));win=t;winRender=r;}if(t-start<4000)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});dt.sort((a,b)=>a-b);
              return {ground,structures,surfaces,tidalOverlap,datum:{base:d.world.base,elevation:d.p.terrain.elevation,backup:!!d.groundBackup,ended:d.ended,aborted:d.seaStop.signal.aborted,pending:d.coastJobs.pool.pending,jobs:d.coastJobs.pool.stats},world:d.world.stats(),fps:{min1s:Math.min(...fps),average:((n?.frameNo??count)-renderStart)*1000/(last-start),p95Ms:dt[Math.floor(dt.length*.95)],p99Ms:dt[Math.floor(dt.length*.99)],maxPauseMs:dt.at(-1)},resolution:{canvas:[n?.canvas.width,n?.canvas.height],quality:n?.quality.name,pixelRatio:document.querySelector('.re-holo-stage')?.dataset.pixelRatio}};
            }''')
            results.append({'name':name,**result})
            print(json.dumps({'name':name,**{k:v for k,v in result.items() if k not in ('ground','structures')},'ground':{'meshes':len(result['ground']),'wetTriangles':sum(m['wet'] for m in result['ground']),'above':sum(m['above'] for m in result['ground'])}},ensure_ascii=False),flush=True)
        report = {'chrome':browser.version,'savedBrowserDatabases':False,'results':results,'errors':errors}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        assert not errors, errors
        assert all(m['above']==0 for r in results for m in r['ground']), 'Terrain remains above confirmed open water; inspect report witnesses.'
        assert all(r['tidalOverlap']==0 for r in results), 'Duplicate tidal river water still covers the sea.'
        if '--ready-roads' in sys.argv and place=='mangmi':
            assert any(r['surfaces'] for r in results), 'No prepared bridge pavement was tested.'
            assert all(s['submerged']==0 for r in results for s in r['surfaces']), 'Prepared bridge pavement remains under water.'
    finally:
        browser.close()
