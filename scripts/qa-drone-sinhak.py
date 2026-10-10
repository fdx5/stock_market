"""Muted, read-only reproduction of apartments around Seoul Sinhak Elementary."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from urllib.parse import parse_qs,urlsplit

root=Path(__file__).resolve().parents[1]
port=int(sys.argv[1]);label=sys.argv[2]
place=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--place=')),'sinhak')
out=root/'tmp/drone-performance-20261010'/label;out.mkdir(parents=True,exist_ok=True)
errors=[];photos=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.on('pageerror',lambda e:errors.append(str(e)[:250]))
        def request(req):
            name=parse_qs(urlsplit(req.url).query).get('DataFile',[''])[0]
            if name.lower().endswith(('.jpg','.jpeg','.png')):photos.append(True)
        page.on('request',request)
        page.on('console',lambda m:errors.append(m.text[:600]) if m.type=='error' and any(x in m.text.lower() for x in ['wgsl','shader','pipeline','validation']) else None)
        page.add_init_script('''(()=>{
          window.__surveyAudit=[];const Base=window.Worker;
          window.Worker=class extends Base{constructor(url,opts){super(url,opts);
            if(!String(url).includes('droneSurveyWorker'))return;
            const jobs=new Map(),post=this.postMessage.bind(this);
            this.postMessage=(data,...rest)=>{if(data.towers)jobs.set(data.id,{targets:Array.from(data.towers),outlines:data.outlines});post(data,...rest);};
            this.addEventListener('message',e=>{const j=jobs.get(e.data.id);if(!j)return;jobs.delete(e.data.id);
              window.__surveyAudit.push({...j,models:e.data.models,matched:e.data.matched,retry:e.data.retry,hide:Array.from(e.data.hide??[]),tall:e.data.tall,misses:e.data.misses,cache:e.data.cache,ms:e.data.ms});
              if(window.__surveyAudit.length>250)window.__surveyAudit.shift();});
          }};
        })()''')
        page.route('**/api/**',lambda r:r.continue_() if r.request.url.startswith((f'http://127.0.0.1:{port}/','http://127.0.0.1:8003/')) else r.abort())
        review=f'http://127.0.0.1:{port}/drone-review/{place}'
        if place=='seondeok':
            from urllib.parse import urlencode
            review=f'http://127.0.0.1:{port}/drone-explore?'+urlencode({'complex':'11320:쌍문동:263:선덕중학교','hour':'12','fps':'1','dronedebug':'1'})
        page.goto(review,wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
        page.evaluate('''()=>{const d=window.__drone;d.flight.place(0,0,d.world.groundAt(0,0),160,0);d.flight.tilt=-.45;}''')
        records=[]
        def snapshot():
            return page.evaluate('''()=>{const d=window.__drone,w=d.world,n=window.__holoNative,buildings=[],tiles=[],allTall=[];
              const c=d.p.camera,project=(x,y,z)=>c.position.clone().set(x,z,-y).project(c);
              for(const t of [...w.tiles.values(),...w.viewTiles.values()]){
                const a=t.towers;if(!a)continue;
                tiles.push({key:t.key,survey:t.survey,targets:a.length/9,hidden:t.surveyHidden?.size??0,deferred:t.surveyDeferred?.size??0,info:t.surveyInfo,ready:!!t.surveyGroup&&w.o.drawReady(t.surveyGroup)});
                for(let i=0;i<a.length;i+=9){
                  const id=a[i+6]+':'+a[i+4],appearance=t.appearances?.[a[i+7]],outline=t.spanRings?.[a[i+7]],row={tile:t.key,x:a[i],y:a[i+1],height:a[i+2],ground:a[i+3],source:a[i+7],applied:!!t.surveyHidden?.has(id),resolved:!!t.surveyResolved?.has(id),deferred:!!t.surveyDeferred?.has(id),retryAt:t.surveyDeferred?.get(id)?.at,appearance,outline};
                  if((appearance?.floors??Math.round(a[i+2]/3))>=5){
                    const pts=(outline?.length?outline:[[a[i],a[i+1]]]).flatMap(([x,y])=>[project(x,y,a[i+3]),project(x,y,a[i+3]+a[i+2])]);
                    const front=pts.filter(p=>p.z>=-1&&p.z<=1),x0=Math.min(...front.map(p=>p.x)),x1=Math.max(...front.map(p=>p.x)),y0=Math.min(...front.map(p=>p.y)),y1=Math.max(...front.map(p=>p.y));
                    const screen=front.length&&x0<1&&x1>-1&&y0<1&&y1>-1;
                    allTall.push({...row,visible:!!screen,pixelHeight:screen?Math.max(0,Math.min(1,y1)-Math.max(-1,y0))*innerHeight/2:0,distance:Math.hypot(a[i]-d.flight.pos.x,a[i+1]+d.flight.pos.z),state:t.survey});
                  }
                  if(a[i+6]===0&&Math.hypot(a[i],a[i+1])<=750)buildings.push(row);
                }
              }
              const stage={...document.querySelector('.re-holo-stage')?.dataset};
              const initialRegistered=[...w.o.data.buildings,...w.o.data.context].filter(b=>b.floors>=5).map(b=>({name:b.title??b.name,height:b.height,floors:b.floors,x:b.rings[0].reduce((s,p)=>s+p[0],0)/b.rings[0].length,y:b.rings[0].reduce((s,p)=>s+p[1],0)/b.rings[0].length}));
              const roadSampling=[];window.__holoStageAny?.current?.scene.traverse(o=>{if(o.geometry?.userData.roadSampling)roadSampling.push({...o.geometry.userData.roadSampling});});
              return{center:w.o.data.center,pos:d.flight.pos.toArray(),buildings,allTall,tiles,initialRegistered,initialTargets:w.o.nearBuildings?.()?.targets.length??0,world:w.stats(),stage,roadSampling,resolution:{canvas:[n.canvas.width,n.canvas.height],ratio:Number(stage.pixelRatio),quality:n.quality.name}};
            }''')
        for i in range(2 if '--quick' in sys.argv else 6):
            page.wait_for_timeout(10000);s=snapshot();records.append(s)
            visible=[b for b in s['allTall'] if b['visible'] and b['pixelHeight']>=8]
            print(json.dumps({'seconds':(i+1)*10,'world':s['world'],'apartments':len(s['buildings']),'applied':sum(b['applied'] for b in s['buildings']),'visibleTall':len(visible),'visibleApplied':sum(b['applied'] for b in visible)},ensure_ascii=False),flush=True)
        page.screenshot(path=str(out/'overview.png'))
        # Prepare the eastward visible corridor before approaching its apartments.
        page.evaluate('''()=>{const d=window.__drone;d.flight.place(0,0,d.world.groundAt(0,0),90,-Math.PI/2);d.flight.tilt=-.3;}''')
        page.wait_for_timeout(15000);records.append(snapshot());page.screenshot(path=str(out/'before-approach.png'))
        page.keyboard.down('w')
        try:page.wait_for_timeout(5000)
        finally:page.keyboard.up('w')
        page.wait_for_timeout(15000);records.append(snapshot());page.screenshot(path=str(out/'approach.png'))
        result={'records':records,'audit':page.evaluate('window.__surveyAudit'),'errors':errors,'chrome':browser.version,'muted':True,'buildingPhotographs':len(photos)}
        (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        assert not errors and records[-1]['buildings']
        assert len(photos)==0
    except Exception:
        if 'page' in locals():
            page.screenshot(path=str(out/'failure.png'))
            (out/'failure.json').write_text(json.dumps({'errors':errors,'body':page.locator('body').inner_text()[:2000],'renderState':page.evaluate('''()=>({native:!!window.__holoNative,shown:window.__holoNative?.shown,failed:window.__holoNative?.failed,drone:!!window.__drone,stage:{...document.querySelector('.re-holo-stage')?.dataset}})''')},ensure_ascii=False,indent=2),encoding='utf8')
        raise
    finally:browser.close()
