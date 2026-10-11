"""Muted Chrome panorama/controls check against the read-only local snapshot."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1]
port=int(sys.argv[1]); label=sys.argv[2]
quick='--quick' in sys.argv
touch='--touch' in sys.argv
out=root/'tmp/drone-performance-20261010'/label
out.mkdir(parents=True,exist_ok=True)
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
    try:
        page=browser.new_page(viewport={'width':390,'height':844} if touch else {'width':1440,'height':1000},has_touch=touch,is_mobile=touch,device_scale_factor=2 if touch else 1)
        # Exercise fresh memory caches without opening or pruning saved browser DBs.
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})")
        page.on('pageerror',lambda e:errors.append(str(e)[:300]))
        page.on('console',lambda m:errors.append(m.text[:300]) if m.type=='error' and any(t in m.text.lower() for t in ['wgsl','shader','pipeline','validation']) else None)
        page.route('**/api/**',lambda r:r.continue_() if r.request.url.startswith((f'http://127.0.0.1:{port}/','http://127.0.0.1:8003/')) else r.abort())
        page.goto(f'http://127.0.0.1:{port}/drone-review/haeundae',wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown',timeout=90000)
        page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.trafficArmedAt",timeout=120000)
        page.wait_for_timeout(5000)
        # Click the user's control rather than activating the feature via debug API.
        button=page.locator('.re-drone-rotate')
        activate=button.tap if touch else button.click
        down=page.locator('[aria-label="하강 (누르고 있기)"]')
        pos=button.bounding_box(); lower=down.bounding_box()
        assert pos['y']>=lower['y']+lower['height'], 'Rotation button is not below altitude controls'
        page.evaluate('''()=>{const f=window.__drone.flight;window.__qaRotateStart={pos:f.pos.toArray(),yaw:f.yaw,tilt:f.tilt};}''')
        activate();assert button.get_attribute('aria-pressed')=='true'
        result=page.evaluate('''async duration=>{
          const f=window.__drone.flight,n=window.__holoNative,begin=performance.now(),frameNo=n.frameNo;
          let win=begin,last=begin,count=0,frames=0,renderWindow=frameNo;const windows=[],renderWindows=[],ratios=new Set(),frameTimes=[];
          await new Promise(resolve=>{const tick=now=>{frameTimes.push(now-last);last=now;frames++;count++;ratios.add(Number(document.querySelector('.re-holo-stage').dataset.pixelRatio));if(now-win>=1000){windows.push(count*1000/(now-win));renderWindows.push((n.frameNo-renderWindow)*1000/(now-win));renderWindow=n.frameNo;win=now;count=0;}if(now-begin>=duration)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
          frameTimes.sort((a,b)=>a-b);const quantile=p=>frameTimes[Math.min(frameTimes.length-1,Math.floor(frameTimes.length*p))];
          return{before:window.__qaRotateStart,after:{pos:f.pos.toArray(),yaw:f.yaw,tilt:f.tilt,active:f.autoRotate},meanFps:frames*1000/(performance.now()-begin),minWindowFps:Math.min(...windows),windows,renderWindows,minRenderWindowFps:Math.min(...renderWindows),p95Ms:quantile(.95),p99Ms:quantile(.99),worstMs:frameTimes.at(-1),renderedFrames:n.frameNo-frameNo,resolution:{ratios:[...ratios],canvas:[n.canvas.width,n.canvas.height],quality:n.quality.name}};
        }''', 4000 if quick else 94000)
        assert result['before']['pos']==result['after']['pos'] and result['before']['tilt']==result['after']['tilt']
        assert result['before']['yaw']>result['after']['yaw'] and result['after']['active']
        if not quick:assert result['before']['yaw']-result['after']['yaw']>6.283
        page.screenshot(path=str(out/'rotation-on.png'))
        activate();assert button.get_attribute('aria-pressed')=='false'
        stopped=page.evaluate('window.__drone.flight.yaw');page.wait_for_timeout(1200)
        assert page.evaluate('window.__drone.flight.yaw')==stopped
        activate();page.keyboard.down('KeyW');page.wait_for_timeout(200);page.keyboard.up('KeyW')
        assert not page.evaluate('window.__drone.flight.autoRotate')
        result['manualTakeover']=True
        # Layout checks reuse the same page; they are outside the frame measurement.
        layouts=[]
        for size in [{'width':390,'height':844},{'width':844,'height':390}]:
            page.set_viewport_size(size);page.wait_for_timeout(500)
            b=button.bounding_box();d=down.bounding_box()
            assert b['y']>=d['y']+d['height'] and b['y']+b['height']<=size['height']
            assert button.evaluate('(b)=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}'), 'Rotation button is covered by another control'
            activate();assert button.get_attribute('aria-pressed')=='true'
            activate();assert button.get_attribute('aria-pressed')=='false'
            layouts.append({'viewport':size,'button':b,'down':d})
            page.screenshot(path=str(out/f"layout-{size['width']}.png"))
        activate();page.evaluate('window.__qaEndedFlight=window.__drone.flight')
        page.keyboard.press('Escape');page.wait_for_timeout(500)
        result['landingClearsRotation']=page.evaluate('!window.__qaEndedFlight.autoRotate')
        assert result['landingClearsRotation']
        result.update(layouts=layouts,errors=errors,muted=True,chrome=browser.version,quick=quick,touch=touch,savedBrowserDatabases=False)
        (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(result,ensure_ascii=False),flush=True)
        assert not errors
    finally: browser.close()
