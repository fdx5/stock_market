# Real-data check of the 3D complex view: VWorld buildings + roads from the browser,
# SRTM terrain, sidewalks, trees, people, traffic. Needs local Vite on :5173 proxying
# /api/realestate to a backend (REALESTATE_API_TARGET), Edge, network access.
# Usage: python frontend/scripts/test-complex-real.py [complex-id]
import atexit, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
out = root / 'tmp'
out.mkdir(exist_ok=True)
cid = sys.argv[1] if len(sys.argv) > 1 else '11290:길음동:1288:래미안길음센터피스'
harness = ("import React from 'react';\nimport { createRoot } from 'react-dom/client';\n"
           "import ComplexHologram from './components/ComplexHologram';\n"
           f"createRoot(document.getElementById('root')!).render(<div style={{{{maxWidth:1200,margin:'24px auto',height:820,display:'flex'}}}}>"
           f"<ComplexHologram complexId={json.dumps(cid, ensure_ascii=False)} complexName=\"real\" initialTod=\"day\" /></div>);\n")
html = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#e6e9e6"><div id="root"></div><script type="module" src="/src/__real3d.tsx"></script></body></html>\n'
paths = [root / 'frontend/src/__real3d.tsx', root / 'frontend/__real3d.html']
atexit.register(lambda: [p.unlink(missing_ok=True) for p in paths])
paths[0].write_text(harness, encoding='utf-8')
paths[1].write_text(html, encoding='utf-8')

FRAMES = """()=>new Promise(resolve=>{const s=[];let prev=performance.now();function f(now){s.push(now-prev);prev=now;if(s.length<240)requestAnimationFrame(f);else{s.sort((a,b)=>a-b);resolve({median:+s[120].toFixed(1),p95:+s[228].toFixed(1),over33:s.filter(n=>n>33.4).length});}}requestAnimationFrame(f);})"""

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=len(sys.argv) < 3, args=['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'])
    page = browser.new_page(viewport={'width': 1300, 'height': 900})
    import os
    if os.environ.get('WEBGL'):  # the compatibility path: no WebGPU
        page.add_init_script("Object.defineProperty(navigator, 'gpu', {value: undefined});")
        out = out / 'webgl'; out.mkdir(exist_ok=True)
    logs = []
    page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning', 'info') else None)
    page.goto('http://127.0.0.1:5173/__real3d.html')
    page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt", timeout=90000)
    page.wait_for_timeout(6000)
    try: page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.parcels", timeout=20000)
    except Exception: pass
    page.wait_for_timeout(1500)
    st = lambda: page.locator('.re-holo-stage').first.evaluate('(e)=>({...e.dataset})')
    page.wait_for_timeout(3000)
    report = {'state': st(), 'frames': page.evaluate(FRAMES)}
    report['walkers_n'] = page.evaluate("(window.__complexStage.walkers||[]).length")
    report['water'] = page.evaluate("(()=>{let n=0; window.__complexStage.scene.traverse(o=>{ if(o.material?.userData?.water) n++;}); return n;})()")
    report['nav'] = page.locator('.re-holo-modes button[aria-pressed="true"]').inner_text()
    page.screenshot(path=str(out / 'real-day.png'))
    # Street level: down among the people and trees, then up at the sky.
    page.evaluate("""()=>{const s=window.__complexStage; const tr=s.model; s.controls.autoRotate=false;
      const c=s.center.clone(); s.controls.target.set(c.x, s.floor+8, c.z); s.camera.position.set(c.x+120, s.floor+40, c.z+120); s.controls.update();}""")
    page.wait_for_timeout(2500)
    page.screenshot(path=str(out / 'real-street.png'))
    report['street_frames'] = page.evaluate(FRAMES)
    # On a sidewalk: the longest run, eye level a little above the people.
    report['runs'] = page.evaluate("""()=>{const s=window.__complexStage; const runs=s.runs||[]; if(!runs.length) return 0;
      const r=runs.slice().sort((a,b)=>b.cum[b.cum.length-1]-a.cum[a.cum.length-1])[0]; const i=Math.floor(r.cum.length/2);
      const off=r.half+r.width*0.5, x=r.cx[i]+r.nx[i]*r.side*off, y=r.cy[i]+r.ny[i]*r.side*off;
      const j=Math.min(r.cum.length-1,i+10), x2=r.cx[j]+r.nx[j]*r.side*off, y2=r.cy[j]+r.ny[j]*r.side*off;
      const g=s.ground.geometry; s.controls.minDistance=1;
      s.camera.position.set(x-(x2-x)*0.6 + r.nx[i]*r.side*6, 0, -(y-(y2-y)*0.6) - r.ny[i]*r.side*6);
      s.controls.target.set(x2, 0, -y2);
      const ray=new (s.camera.position.constructor)(0,0,0);
      const h=(px,pz)=>{let best=0,bd=1e9;const p=g.attributes.position;for(let k=0;k<p.count;k+=7){const dx=p.getX(k)-px,dz=-p.getY(k)-pz,d=dx*dx+dz*dz;if(d<bd){bd=d;best=p.getZ(k);}}return best;};
      s.camera.position.y=h(s.camera.position.x,s.camera.position.z)+4.5; s.controls.target.y=h(x2,-y2)+1.2; s.controls.update(); return runs.length;}""")
    page.wait_for_timeout(2500)
    page.screenshot(path=str(out / 'real-sidewalk.png'))
    # Close to the people: follow one for a moment, three metres ahead of them.
    for n, idx in enumerate([0, 7, 19]):
        page.evaluate("""(idx)=>{const s=window.__complexStage; s.__follow && cancelAnimationFrame(s.__follow); const ws=s.walkers||[]; const w=ws[idx%ws.length]; if(!w) return;
          const go=()=>{const y=s.floor; const gy=s.ground? 0:0; const px=w.x+w.hx*4.2 + w.hy*2.2, py=w.y+w.hy*4.2 - w.hx*2.2;
            const g=s.ground.geometry.attributes.position; let best=0,bd=1e9; for(let k=0;k<g.count;k+=3){const dx=g.getX(k)-w.x,dy=g.getY(k)-w.y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=g.getZ(k);}}
            s.camera.position.set(px, best+1.9, -py); s.controls.target.set(w.x, best+1.0, -w.y); s.controls.minDistance=0.5; s.controls.update(); s.__follow=requestAnimationFrame(go);}; go();}""", idx)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(out / f'real-people{n}.png'))
    page.evaluate("()=>{const s=window.__complexStage; cancelAnimationFrame(s.__follow);}")
    page.evaluate("""()=>{const s=window.__complexStage; const c=s.center.clone(); s.camera.position.set(c.x+200, s.floor+30, c.z+200);
      s.controls.target.set(c.x-200, s.floor+260, c.z-200); s.controls.update();}""")
    page.wait_for_timeout(2000)
    page.screenshot(path=str(out / 'real-sky.png'))
    page.evaluate("""()=>{const s=window.__complexStage; const c=s.center.clone(); s.controls.target.set(c.x, s.floor, c.z); s.camera.position.set(c.x+30, s.floor+520, c.z+60); s.controls.update();}""")
    page.wait_for_timeout(2000)
    page.screenshot(path=str(out / 'real-top.png'))
    report['state_after'] = st()
    report['logs'] = [l for l in logs if 'Download the React DevTools' not in l][:30]
    print(json.dumps(report, ensure_ascii=False, indent=1))
    browser.close()
