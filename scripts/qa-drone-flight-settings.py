"""Muted Chrome user-control check against the read-only local snapshot (no DB)."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf8')
root = Path(__file__).resolve().parents[1]
port, label = int(sys.argv[1]), sys.argv[2]
out = root / 'tmp/drone-performance-20261010' / label
out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--mute-audio'])
    try:
        page = browser.new_page(viewport={'width':1440,'height':1000})
        page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})")
        page.on('pageerror', lambda e: errors.append(str(e)[:300]))
        page.goto(f'http://127.0.0.1:{port}/drone-review/haeundae', wait_until='domcontentloaded')
        page.wait_for_function('window.__drone && window.__holoNative?.shown', timeout=90000)
        page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.trafficArmedAt", timeout=120000)
        page.wait_for_timeout(3000)
        page.evaluate('''()=>{const f=window.__drone.flight;window.__qaHome={x:f.pos.x,y:-f.pos.z,ground:f.pos.y-f.agl,yaw:f.yaw};}''')
        toggle = page.locator('.re-drone-auto-settings-toggle')
        toggle.click()
        speed = page.get_by_label('오토파일럿 속도', exact=True)
        altitude = page.get_by_label('오토파일럿 목표 고도', exact=True)
        speed.fill('350'); speed.press('Tab')
        assert speed.input_value() == '200'
        altitude.fill('1200'); altitude.press('Tab')
        assert altitude.input_value() == '1000'
        speed.fill('73'); speed.press('Enter')
        assert page.evaluate('Math.round(window.__drone.flight.autoCruiseSpeed*3.6)') == 73
        assert not page.evaluate('window.__drone.flight.keys.size')
        page.mouse.wheel(0,-100)
        assert not page.evaluate('window.__drone.flight.input().climb'), 'Settings wheel also climbed the drone'
        page.locator('.re-drone-auto-settings > button').click()
        page.evaluate('''()=>{const f=window.__drone.flight,h=window.__qaHome;f.place(h.x,h.y,h.ground,999,h.yaw);}''')
        up = page.get_by_label('상승 (누르고 있기)', exact=True)
        b = up.bounding_box(); page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2)
        page.mouse.down(); page.wait_for_timeout(2200); page.mouse.up()
        manual = page.evaluate('window.__drone.flight.agl')
        assert manual > 1005, manual
        page.evaluate('''()=>{const f=window.__drone.flight,h=window.__qaHome;f.place(h.x,h.y,h.ground,1000,h.yaw);}''')
        page.locator('.re-drone-autopilot').click()
        page.wait_for_timeout(1500)
        assert page.evaluate('window.__drone.flight.autopilot')
        assert 999 <= page.evaluate('window.__drone.flight.agl') <= 1000.01
        toggle.click(); altitude.fill('10'); altitude.press('Enter')
        assert page.evaluate('window.__drone.flight.autoCruiseAgl') == 10
        assert page.evaluate('window.__drone.flight.autopilot'), 'Editing settings interrupted autopilot'
        page.locator('.re-drone-auto-settings > button').click()
        page.locator('.re-drone-autopilot').click()
        # Measure the unchanged full-quality renderer during real automatic flight.
        page.evaluate('''()=>{const f=window.__drone.flight,h=window.__qaHome;f.place(h.x,h.y,h.ground,175,h.yaw);f.setAutoAltitude(175);f.setAutoSpeed(73);}''')
        page.locator('.re-drone-autopilot').click()
        page.wait_for_timeout(2000)
        perf = page.evaluate('''async()=>{
          const n=window.__holoNative,start=performance.now();let last=start,win=start,frame=n.frameNo,first=frame;
          const times=[],windows=[],ratios=new Set();
          await new Promise(resolve=>{const tick=t=>{times.push(t-last);last=t;ratios.add(document.querySelector('.re-holo-stage').dataset.pixelRatio);if(t-win>=1000){windows.push((n.frameNo-frame)*1000/(t-win));frame=n.frameNo;win=t;}if(t-start>=6000)resolve();else requestAnimationFrame(tick)};requestAnimationFrame(tick)});
          times.sort((a,b)=>a-b);const q=p=>times[Math.min(times.length-1,Math.floor(times.length*p))];
          return{renderedFrames:n.frameNo-first,minOneSecondFps:Math.min(...windows),windows,p95Ms:q(.95),p99Ms:q(.99),maxMs:times.at(-1),canvas:[n.canvas.width,n.canvas.height],pixelRatios:[...ratios],quality:n.quality.name};
        }''')
        page.locator('.re-drone-autopilot').click()
        layouts=[]
        for size in [{'width':390,'height':844},{'width':844,'height':390}]:
            page.set_viewport_size(size);page.wait_for_timeout(500)
            toggle.click()
            altitude.fill('1000');altitude.press('Enter')
            speed.fill('200');speed.press('Enter')
            for control in [speed,altitude,page.locator('.re-drone-auto-settings > button')]:
                box=control.bounding_box()
                assert box and box['x']>=0 and box['y']>=0 and box['x']+box['width']<=size['width'] and box['y']+box['height']<=size['height'],box
                assert control.evaluate('(e)=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}'), 'Settings control covered'
            page.screenshot(path=str(out/f"settings-{size['width']}.png"))
            layouts.append(size);page.locator('.re-drone-auto-settings > button').click()
        report={'manualAltitudeBeyond1000':manual,'speedCap':200,'automaticAltitudeRange':[10,1000],'layouts':layouts,'performance':perf,'errors':errors,'muted':True,'chrome':browser.version}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(report,ensure_ascii=False),flush=True)
        assert not errors
    except Exception:
        page.screenshot(path=str(out/'failed.png'))
        raise
    finally:
        browser.close()
