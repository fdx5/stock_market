"""Road/terrain loading must overlap; uses local Vite, mocked providers and Edge."""
import atexit
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
paths = [root/'frontend/src/__loading3d.tsx', root/'frontend/__loading3d.html']
assert not any(p.exists() for p in paths)
atexit.register(lambda:[p.unlink(missing_ok=True) for p in paths])
paths[0].write_text('''import React from 'react';
import {createRoot} from 'react-dom/client';
import ComplexHologram from './components/ComplexHologram';
createRoot(document.getElementById('root')!).render(<div style={{height:700,display:'flex'}}><ComplexHologram complexId="loading-test" initialTod="day" /></div>);
''',encoding='utf-8')
paths[1].write_text('<html><body><div id="root"></div><script type="module" src="/src/__loading3d.tsx"></script></body></html>',encoding='utf-8')
fixture=dict(id='loading-test',name='Loading fixture',found=True,source='vworld',center=dict(lat=37,lon=127),
             vworld_key='mock',vworld=True,site=[],context=[],parcels=[],built=2020,
             buildings=[dict(rings=[[[0,0],[30,0],[30,20],[0,20]]],height=60,base=0,floors=20,height_source='measured',name='101동',use='공동주택')])
roads='''export async function vworldRoads() {window.__roadsStart=performance.now();await new Promise(r=>setTimeout(r,500));window.__roadsEnd=performance.now();return [];}
export async function vworldBuildings(){return null} export async function vworldParcels(){return null}'''
terrain='''export const FLAT={at:()=>0,base:()=>0,relief:0,elevation:null,source:null};
export function preconnectTerrain(){} export function prefetchTerrain(){}
export async function loadTerrain(){window.__terrainStart=performance.now();await new Promise(r=>setTimeout(r,350));window.__terrainEnd=performance.now();return {...FLAT,source:'test terrain'}}'''

with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport=dict(width=1200,height=850))
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('http://127.0.0.1:5173/api/**',lambda r:r.fulfill(json=fixture))
    page.route('**/src/components/vworldBuildings.ts*',lambda r:r.fulfill(body=roads,content_type='application/javascript'))
    page.route('**/src/components/sceneTerrain.ts*',lambda r:r.fulfill(body=terrain,content_type='application/javascript'))
    page.goto('http://127.0.0.1:5173/__loading3d.html')
    page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.fetchMs",timeout=30000)
    report=page.evaluate('''()=>({roads:[__roadsStart,__roadsEnd],terrain:[__terrainStart,__terrainEnd],state:{...document.querySelector('.re-holo-stage').dataset}})''')
    assert abs(report['roads'][0]-report['terrain'][0])<100,report
    assert report['terrain'][0]<report['roads'][1],report
    assert report['roads'][0]<report['terrain'][1],report
    assert not errors,errors
    print(json.dumps(report),flush=True)
    browser.close()
