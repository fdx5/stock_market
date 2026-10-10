"""Muted roof-colour audit with public, read-only local GIS snapshots."""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit, parse_qs
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8')
port, label = int(sys.argv[1]), sys.argv[2]
place = sys.argv[3] if len(sys.argv) > 3 else 'haeundae'
overview = '--overview' in sys.argv
complexes = {'haeundae':'26350:우동:1407:해운대두산위브더제니스', 'changdong':'11320:창동:333:창동동아청솔','uijeongbu':'41150:의정부동:724:의정부역센트럴자이앤위브캐슬'}
out = root/'tmp/drone-performance-20261010'/label
out.mkdir(parents=True, exist_ok=True)
errors, photo_requests = [], []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--mute-audio'])
    try:
        page = browser.new_page(viewport={'width':1440, 'height':1000})
        page.on('pageerror', lambda e: errors.append(str(e.stack)[:1200]))
        def request(req):
            name=parse_qs(urlsplit(req.url).query).get('DataFile',[''])[0]
            if name.lower().endswith(('.jpg','.jpeg','.png')): photo_requests.append(True)
        page.on('request',request)
        page.on('console', lambda m: errors.append(m.text[:250]) if m.type=='error' and any(x in m.text.lower() for x in ['wgsl','shader','pipeline','validation']) else None)
        page.route('**/api/**', lambda r: r.continue_() if r.request.url.startswith((f'http://127.0.0.1:{port}/','http://127.0.0.1:8003/')) else r.abort())
        query={'complex':complexes[place], 'hour':12, 'fps':1, 'dronedebug':1}
        if overview:
            # The preserved catalog's regional leader opens the overview. A
            # selected-id sheet pauses it and is not the manual-flight path.
            query.pop('complex')
            query.update({'3d':1, 'sido':26 if place=='haeundae' else 41 if place=='uijeongbu' else 11, 'sgg':26350 if place=='haeundae' else 41150 if place=='uijeongbu' else 11320})
        page.goto(f'http://127.0.0.1:{port}/'+('realestate-map' if overview else 'drone-explore')+'?'+urlencode(query), wait_until='domcontentloaded')
        if overview:
            page.wait_for_function('window.__holoNative?.shown && document.querySelector(".re-holo-drone-btn")',timeout=90000)
            page.evaluate('''()=>{const s=window.__holoStageAny.current;window.__qaNearIndices=s.nearBuildings?.objects.filter(o=>o.geometry?.index).map(o=>({o,values:o.geometry.index.array.slice()}))??[];}''')
            page.locator('.re-holo-drone-btn').click()
        page.wait_for_function('window.__drone && window.__holoNative?.shown', timeout=90000)
        page.evaluate("()=>{const d=window.__drone;d.flight.place(0,0,d.world.groundAt(0,0),300,0);d.flight.tilt=-1.05;}")
        page.wait_for_timeout(25000)
        result = page.evaluate('''()=>{
          const d=window.__drone,w=d.world,n=window.__holoNative,rows=[],seen=new Set();
          const srgb=x=>x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055;
          for(const t of [...w.tiles.values(),...w.viewTiles.values()]){
            if(!t.spans)continue;
            for(let i=0;i<t.spans.length;i+=5){
              const styles=['apt','villa','shop','office'];
              const geo=t.styleGeo[styles[t.spans[i]]],index=t.spans[i+3],col=geo?.attributes.color;
              const count=t.spans[i+4],key=geo?.uuid+':'+index;
              if(!col||!count||seen.has(key))continue;seen.add(key);
              const rgb=[col.getX(index),col.getY(index),col.getZ(index)].map(srgb);
              const green=rgb[1]-rgb[0]>.025&&rgb[1]-rgb[2]>.025;
              rows.push({tile:t.key,colourState:t.colour,rgb,green,appearance:!!t.appearances?.[i/5]});
            }
          }
          const stage={...document.querySelector('.re-holo-stage')?.dataset};
          const low=[...w.tiles.values(),...w.viewTiles.values()].flatMap(t=>t.appearances??[]).filter(p=>p?.floors<5),layouts={};
          for(const p of low)layouts[p.layout??0]=(layouts[p.layout??0]??0)+1;
          const gpuLayouts=new Set(),finishes=new Set(),variants=new Set();let facadeMeshes=0,readyMeshes=0,plainVerticalVertices=0,bodyVerticalVertices=0;
          window.__holoStageAny.current.scene.traverseVisible(o=>{const a=o.geometry?.attributes.facade,normal=o.geometry?.attributes.normal;if(!a)return;facadeMeshes++;if(w.o.drawReady(o))readyMeshes++;for(let i=0;i<a.count;i++){gpuLayouts.add(Math.floor(a.getY(i)/8));variants.add(a.getY(i)%8);finishes.add(a.getX(i)%8);if(normal&&Math.abs(normal.getY(i))<.7){if(a.getX(i)>=32)plainVerticalVertices++;else bodyVerticalVertices++;}}});
          const stations=d.signs.all().filter(s=>s.kind==='station').map(({name,x,y,top})=>({name,x,y,top}));
          return {roofs:rows.length,greenRoofs:rows.filter(r=>r.green).length,uniqueRoofColours:new Set(rows.map(r=>r.rgb.map(v=>v.toFixed(3)).join(','))).size,lowRise:{buildings:low.length,layouts},facades:{gpuLayouts:[...gpuLayouts].sort(),finishes:[...finishes].sort(),variants:[...variants].sort(),facadeMeshes,readyMeshes,plainVerticalVertices,bodyVerticalVertices},stations,rows,stage,resolution:{canvas:[n.canvas.width,n.canvas.height],ratio:Number(stage.pixelRatio),quality:n.quality.name},world:w.stats()};
        }''')
        page.screenshot(path=str(out/'roof-overview.png'))
        if result['stations']:
            page.evaluate('''()=>{const d=window.__drone,s=d.signs.all().find(s=>s.kind==='station'),ctx=d.signs.canvas.getContext('2d'),fill=ctx.fillText;window.__qaStationTexts=[];ctx.fillText=function(text,...a){if(text.includes(s.name))window.__qaStationTexts.push(text);return fill.call(this,text,...a);};d.flight.place(s.x,s.y-180,d.world.groundAt(s.x,s.y-180),Math.max(65,s.top+40),0);d.flight.tilt=-.35;}''')
            page.wait_for_timeout(2500)
            result['stationDrawn']=page.evaluate('window.__qaStationTexts.slice(-3)')
            page.screenshot(path=str(out/'station-sign.png'))
            assert result['stationDrawn'], 'Loaded station sign was not drawn on the native overlay'
        if overview:
            page.keyboard.press('Escape')
            page.wait_for_timeout(1500)
            result['overviewRestored']=page.evaluate('''()=>({landed:!window.__holoStageAny.current.drone,checked:window.__qaNearIndices.length,indices:window.__qaNearIndices.every(({o,values})=>values.every((v,i)=>v===o.geometry.index.array[i]))})''')
            assert result['overviewRestored']['landed'] and result['overviewRestored']['indices']
            page.screenshot(path=str(out/'landed-overview.png'))
        result.update({'errors':errors, 'chrome':browser.version, 'muted':True, 'place':place, 'manualTakeoff':overview, 'buildingPhotographRequests':len(photo_requests)})
        (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps({k:v for k,v in result.items() if k not in ['rows','stage']},ensure_ascii=False),flush=True)
        assert not errors and result['roofs']>0
        if '--fixed' in sys.argv:
            assert result['greenRoofs']==0, 'Green roof overwrite returned'
            assert len(photo_requests)==0, 'Building photograph path returned'
    except Exception:
        if 'page' in locals():
            page.screenshot(path=str(out/'failure.png'))
            (out/'failure.json').write_text(json.dumps({'url':page.url,'errors':errors,'body':page.locator('body').inner_text()[:2500]},ensure_ascii=False,indent=2),encoding='utf8')
        raise
    finally:
        browser.close()
