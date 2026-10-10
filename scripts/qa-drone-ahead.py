"""Muted actual-keyboard flight and visible-direction prefetch, using local snapshots."""
import json
import math
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit, parse_qs
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
port=int(sys.argv[1]);label=sys.argv[2]
out=root/'tmp/drone-performance-20261010'/label;out.mkdir(parents=True,exist_ok=True)
errors=[];photo_requests=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.on('pageerror',lambda e:errors.append(str(e)[:250]))
        def request(req):
            file=parse_qs(urlsplit(req.url).query).get('DataFile',[''])[0]
            if file.lower().endswith(('.jpg','.jpeg','.png')):photo_requests.append(file.rsplit('.',1)[-1])
        page.on('request',request)
        page.route('**/api/**',lambda r:r.continue_() if r.request.url.startswith((f'http://127.0.0.1:{port}/','http://127.0.0.1:8003/')) else r.abort())
        q=urlencode({'complex':'26350:우동:1407:해운대두산위브더제니스','hour':12,'fps':1,'dronedebug':1})
        page.goto(f'http://127.0.0.1:{port}/drone-explore?'+q,wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
        page.evaluate('''()=>{const d=window.__drone;d.flight.place(0,600,d.world.groundAt(0,600),180,-Math.PI/2);d.flight.tilt=-.3;}''')
        def snapshot():
            return page.evaluate('''()=>{const d=window.__drone,w=d.world,n=window.__holoNative;
              const tiles=[...w.tiles.values()].filter(t=>t.towers?.length&&t.cx>d.flight.pos.x&&t.cx<d.flight.pos.x+1000&&Math.abs(t.cy+d.flight.pos.z)<350).map(t=>({key:t.key,metresAhead:t.cx-d.flight.pos.x,state:t.state,targets:t.towers.length/9,applied:t.surveyHidden?.size??0,survey:t.survey,baseReady:!!t.buildingGroup&&w.o.drawReady(t.buildingGroup),detailReady:!!t.surveyGroup&&w.o.drawReady(t.surveyGroup)}));
              const finishes=new Set(),variants=new Set(),layouts=new Set();let ready=0,models=0;
              window.__holoStageAny.current.scene.traverseVisible(o=>{const a=o.geometry?.attributes.facade;if(!a)return;models++;if(w.o.drawReady(o))ready++;for(let i=0;i<a.count;i++){finishes.add(a.getX(i)%8);variants.add(a.getY(i)%8);layouts.add(Math.floor(a.getY(i)/8));}});
              return{pos:d.flight.pos.toArray(),world:w.stats(),tiles,appearance:{finishes:[...finishes].sort(),variants:[...variants].sort(),layouts:[...layouts].sort(),models,ready},stage:{...document.querySelector('.re-holo-stage')?.dataset},resolution:{ratio:Number(document.querySelector('.re-holo-stage')?.dataset.pixelRatio),canvas:[n.canvas.width,n.canvas.height],quality:n.quality.name},heap:performance.memory?.usedJSHeapSize};}''')
        preparation=[]
        for i in range(6):
            page.wait_for_timeout(5000);r=snapshot();preparation.append(r)
            print(json.dumps({'preparationSeconds':(i+1)*5,'ahead':r['tiles'],'appearance':r['appearance']},ensure_ascii=False),flush=True)
        before=snapshot();page.screenshot(path=str(out/'before-flight.png'))
        page.keyboard.down('w')
        flight=[]
        try:
            for i in range(6):
                page.wait_for_timeout(3000);r=snapshot();flight.append(r)
                print(json.dumps({'flightSeconds':(i+1)*3,'pos':r['pos'],'ahead':r['tiles']},ensure_ascii=False),flush=True)
        finally:page.keyboard.up('w')
        page.wait_for_timeout(1000);after=snapshot();page.screenshot(path=str(out/'after-flight.png'))
        cdp=page.context.new_cdp_session(page);cdp.send('HeapProfiler.collectGarbage');retained=snapshot()
        moved=math.dist(before['pos'],after['pos'])
        report={'chrome':browser.version,'muted':True,'preparation':preparation,'before':before,'flight':flight,'after':after,'retained':retained,'movedMetres':moved,'keyReleased':page.evaluate("!window.__drone.flight.keys.has('KeyW')"),'buildingPhotographRequests':len(photo_requests),'errors':errors}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps({'movedMetres':moved,'photoRequests':len(photo_requests),'errors':errors},ensure_ascii=False),flush=True)
        assert moved>10 and report['keyReleased'] and not errors
        assert any(t['applied']>0 and t['detailReady'] for t in before['tiles']), 'No measured building ahead was ready before keyboard flight'
        assert len(photo_requests)==0,'Building photograph downloaded in review route'
    finally:browser.close()
