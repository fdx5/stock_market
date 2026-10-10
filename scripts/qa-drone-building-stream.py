"""Read-only Chrome building streaming check against the isolated local API."""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
label, port = sys.argv[1], int(sys.argv[2])
out = root / 'tmp/drone-performance-20261010' / label
out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    try:
        page = browser.new_page(viewport={'width':1440, 'height':1000})
        page.on('pageerror', lambda e: errors.append(str(e)[:200]))
        page.route('**/api/**', lambda r: r.continue_() if r.request.url.startswith((f'http://127.0.0.1:{port}/', 'http://127.0.0.1:8003/')) else r.abort())
        query = {'complex':'26350:우동:1407:해운대두산위브더제니스','hour':12,'dronedebug':1,'fps':1}
        page.goto(f'http://127.0.0.1:{port}/drone-explore?'+urlencode(query),wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
        records=[]
        for step in range(15):
            record=page.evaluate('''async step=>{
              const d=window.__drone,w=d.world,px=step<3?0:step<10?(step-3)*180:1080,py=600;
              d.flight.place(px,py,w.groundAt(px,py),65,0);d.flight.tilt=-.3;
              await new Promise(r=>setTimeout(r,4000));
              const tiles=[...w.tiles.values(),...(w.viewTiles?.values()??[])].map(t=>({key:t.key,state:t.state,inner:t.inner,
                distance:Math.hypot(Math.max(t.box[0]-px,0,px-t.box[2]),Math.max(t.box[1]-py,0,py-t.box[3])),
                towers:(t.towers?.length??0)/9,survey:t.survey,surveyInfo:t.surveyInfo,replaced:t.surveyHidden?.size??t.surveyInfo?.matched??0,tries:t.surveyTries??0,
                colour:t.colour??'none',colourTries:t.colourTries??0,detailMeshes:t.surveyGroup?.children.length??0,
                baseReady:!t.zup||w.o.drawReady(t.zup),detailReady:!t.surveyGroup||w.o.drawReady(t.surveyGroup)}));
              return {step,px,py,stats:w.stats(),workerStats:w.surveyPool?.stats,resolution:{ratio:document.querySelector('.re-holo-stage')?.dataset.pixelRatio,quality:window.__holoNative.quality.name},tiles:tiles.filter(t=>t.distance<800)};
            }''',step)
            records.append(record)
            print(json.dumps({'step':record['step'],'px':record['px'],'stats':record['stats'],'workerStats':record['workerStats'],
                'near':[t for t in record['tiles'] if t['distance']<350 and t['towers']],'resolution':record['resolution']},ensure_ascii=False),flush=True)
        before=page.evaluate('''()=>{const d=window.__drone;d.flight.place(1080,600,d.world.groundAt(1080,600),300,0);return d.flight.pos.toArray();}''')
        page.keyboard.down('w')
        try:
            page.wait_for_timeout(1000)
            after=page.evaluate('window.__drone.flight.pos.toArray()')
        finally:
            page.keyboard.up('w')
        controls={'movedMetres':sum((a-b)**2 for a,b in zip(after,before))**.5,
                  'released':page.evaluate("!window.__drone.flight.keys.has('KeyW')")}
        assert controls['movedMetres']>.1 and controls['released'], 'Keyboard flight input failed'
        (out/'report.json').write_text(json.dumps({'records':records,'errors':errors,'controls':controls},ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps({'controls':controls,'errors':errors},ensure_ascii=False),flush=True)
        page.screenshot(path=str(out/'final.png'))
    finally:
        browser.close()
