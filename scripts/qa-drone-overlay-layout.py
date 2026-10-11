"""Muted Chrome overlay layout review with a public, read-only local API snapshot."""
import json
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit
import requests
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf8')
root = Path(__file__).resolve().parents[1]
label, base = sys.argv[1], sys.argv[2]
before = '--before' in sys.argv
out = root / 'tmp/drone-overlay-layout' / label
out.mkdir(parents=True, exist_ok=True)
session = requests.Session()
session.trust_env = False
errors, layouts = [], []

inspect = '''()=>{
  const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
  const radar=document.querySelector('.re-drone-radar'),canvas=radar.querySelector('canvas'),tools=radar.querySelector('.re-drone-radar-tools');
  const r=box(canvas),t=box(tools),auto=document.querySelector('.re-drone-autopilot'),a=box(auto),s=getComputedStyle(auto);
  const text=e=>{const range=document.createRange();range.selectNodeContents(e);return[...range.getClientRects()].filter(b=>b.width&&b.height).map(b=>({x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom}));};
  const textLines=[...auto.children].flatMap(text);
  const buttons=[...tools.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width).map(b=>{
    const v=box(b),lines=text(b),cs=getComputedStyle(b);return{text:b.textContent,box:v,lines,align:cs.textAlign,display:cs.display,
      centerError:lines.map(l=>Math.abs(l.x+l.w/2-v.x-v.w/2)),covered:!b.contains(document.elementFromPoint(v.x+v.w/2,v.y+v.h/2))};
  });
  return{viewport:[innerWidth,innerHeight],touch:!!document.querySelector('.re-holo--drone-touch'),big:radar.classList.contains('is-big'),
    radar:r,tools:t,toolbarCenterError:Math.abs(t.x+t.w/2-r.x-r.w/2),buttons,
    autopilot:{box:a,text:auto.textContent,lines:textLines,gridColumns:s.gridTemplateColumns,padding:s.padding,align:s.textAlign,
      leftInset:Math.min(...textLines.map(l=>l.x-a.x)),
      fits:textLines.every(l=>l.x>=a.x-1&&l.right<=a.right+1&&l.y>=a.y-1&&l.bottom<=a.bottom+1)}};
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--mute-audio'])
    try:
        for touch in [False, True]:
            context = browser.new_context(viewport={'width': 390 if touch else 1440, 'height': 844 if touch else 1000},
                has_touch=touch, is_mobile=touch, device_scale_factor=2 if touch else 1)
            page = context.new_page()
            page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});navigator.sendBeacon=()=>false")
            def api(route):
                u = urlsplit(route.request.url)
                if route.request.method in ('GET', 'HEAD'):
                    r = session.get('http://127.0.0.1:8003' + u.path + ('?' + u.query if u.query else ''), timeout=20)
                    route.fulfill(status=r.status_code, body=r.content, content_type='application/json')
                elif u.path == '/api/realestate/nearby':
                    route.fulfill(json={'items': []})
                else:
                    route.abort()
            page.route('**/api/**', api)
            page.on('pageerror', lambda e: errors.append(str(e)[:300]))
            q = urlencode({'complex': '26350:우동:1407:해운대두산위브더제니스', 'hour': 12, 'fps': 1, 'dronedebug': 1})
            page.goto(base + '/drone-explore?' + q, wait_until='domcontentloaded')
            page.wait_for_function('window.__drone && window.__holoNative?.shown', timeout=90000)
            for width, height in ([(390,844),(844,390)] if touch else [(1440,1000),(390,844),(844,390)]):
                page.set_viewport_size({'width': width, 'height': height})
                page.wait_for_timeout(350)
                # Freeze the public simulation while exercising all displayed
                # messages. This changes only this fresh browser's memory.
                page.evaluate('''()=>{const d=window.__drone;if(!window.__qaOverlayTick){window.__qaOverlayTick=d.tick;d.tick=()=>{};}}''')
                for status in ['off', 'cruise', 'altitude', 'obstacle']:
                    page.evaluate('''s=>{const d=window.__drone,f=d.flight;f.autopilot=s!=='off';f.autopilotStatus=s==='off'?'cruise':s;f.autoCruiseAgl=1000;f.autoCruiseSpeed=200/3.6;
                      d.p.onHud({heading:f.heading,kmh:f.kmh,agl:f.agl,autopilot:f.autopilot,autopilotStatus:f.autopilotStatus,radius:d.world.reach,
                        ready:0,tiles:0,limited:false,ahead:9999,unready:0,unreadyFront:0});}''', status)
                    page.wait_for_timeout(200)
                    for big in [False, True]:
                        expand = page.locator('.re-drone-radar-tools button').last
                        if (expand.get_attribute('aria-pressed') == 'true') != big:
                            if before:
                                # Record the old layout even where its footer
                                # hides a control; only the new build must be clickable.
                                expand.dispatch_event('click')
                            else:
                                expand.click()
                        result = page.evaluate(inspect)
                        result.update(status=status, inputTouch=touch)
                        layouts.append(result)
                        if not before:
                            assert result['toolbarCenterError'] < 1.1, result
                            assert result['autopilot']['fits'], result
                            assert result['autopilot']['leftInset'] >= 10, result
                            for button in result['buttons']:
                                assert not button['covered'], result
                                assert all(v < 1.1 for v in button['centerError']), result
                            if not big:
                                for control in page.locator('.re-drone-auto-settings-toggle, .re-drone-alt-buttons button').all():
                                    assert control.evaluate('(e)=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}'), 'Flight/settings control covered or outside viewport'
                        if status == 'obstacle':
                            page.screenshot(path=str(out / f"layout-{touch}-{width}-{big}.png"))
                # Clicking the controls still changes their own feature state.
                auto = page.locator('.re-drone-autopilot')
                if not before:
                    auto.click(); assert auto.get_attribute('aria-pressed') == 'false'
                    auto.click(); assert auto.get_attribute('aria-pressed') == 'true'
                    page.get_by_label('레이더 확대', exact=True).click()
                    page.get_by_label('레이더 축소', exact=True).click()
                    page.locator('.re-drone-radar-tools button').last.click()
            context.close()
        report = {'layouts': layouts, 'chrome': browser.version, 'muted': True, 'errors': errors, 'base': base}
        (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps({'layouts':len(layouts),'maxToolbarCenterError':max(v['toolbarCenterError'] for v in layouts),
            'textOverflowCases':sum(not v['autopilot']['fits'] for v in layouts), 'errors':errors}, ensure_ascii=False), flush=True)
        assert not errors
    except Exception:
        page.screenshot(path=str(out / 'failure.png'))
        (out / 'partial-report.json').write_text(json.dumps(layouts, ensure_ascii=False, indent=2), encoding='utf8')
        raise
    finally:
        browser.close()
