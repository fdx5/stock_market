"""Serial, read-only Chrome check of first-entry paint and rendered frame timing."""
import json, sys, time
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

base, label = sys.argv[1:3]
out = Path(__file__).resolve().parents[2] / 'tmp/first-lanes-qa'
out.mkdir(parents=True, exist_ok=True)
cid = sys.argv[3] if len(sys.argv) > 3 else '11290:길음동:1288:래미안길음센터피스'
mobile = '--mobile' in sys.argv
result = {'base': base, 'complex': cid, 'mobileSimulation': mobile, 'errors': []}
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=False, args=['--mute-audio', '--window-position=0,0'])
    opts = {'viewport': {'width': 1200, 'height': 800}}
    if mobile:
        opts.update(viewport={'width': 932, 'height': 704}, device_scale_factor=2.625, is_mobile=True, has_touch=True,
                    user_agent='Mozilla/5.0 (Linux; Android 16; SM-F976N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36')
    ctx = browser.new_context(**opts)
    ctx.route('**/api/**', lambda route: route.continue_() if route.request.method == 'GET' and not any(x in route.request.url.lower() for x in ['activity', 'visitor', 'track', 'pulse', 'heartbeat', 'analytics', 'beacon', 'page-view']) else route.fulfill(status=200, content_type='application/json', body='{}'))
    ctx.route('**/*youtube*', lambda route: route.abort())
    page = ctx.new_page()
    page.on('pageerror', lambda err: result['errors'].append(str(err)[:300]))
    page.add_init_script("""(()=>{window.__paintFrames=[];let prev=0;const tick=t=>{const n=window.__holoNative?.frameNo??0;if(n>prev){window.__paintFrames.push(t);prev=n;}requestAnimationFrame(tick);};requestAnimationFrame(tick);})();""")
    started = time.monotonic()
    page.goto(base + '/drone-explore?' + urlencode({'complex': cid, 'hour': 12, 'dronedebug': 1}), wait_until='domcontentloaded')
    for _ in range(105):
        page.wait_for_timeout(1000)
        state = page.evaluate("""()=>{const d=document.querySelector('.re-holo-stage')?.dataset??{},s=window.__holoStageAny?.current;let paint=0,ready=0;s?.scene.traverseVisible(o=>{if(o.name==='road markings'){paint++;if(s.drawReady(o))ready++;}});return {seconds:Math.round(performance.now())/1000,shown:d.shownAt,asphalt:d.roadsFirstAt,paint:d.roadsReadyAt,laps:d.roadsLay,paintGroups:paint,readyPaintGroups:ready};}""")
        if _ % 5 == 0 or state.get('paint'):
            print(json.dumps(state), flush=True)
        if state.get('paint') and state['readyPaintGroups']:
            break
    result['entry'] = state
    result['entrySeconds'] = round(time.monotonic() - started, 2)
    page.wait_for_timeout(3000)
    result['render'] = page.evaluate("""()=>{const n=window.__holoNative,d=document.querySelector('.re-holo-stage')?.dataset??{},s=window.__holoStageAny?.current;let vertices=0,groups=0;s?.scene.traverseVisible(o=>{if(o.name==='road markings'){groups++;for(const c of o.children)vertices+=c.geometry?.getAttribute('position')?.count??0;}});return {canvas:n?[n.canvas.width,n.canvas.height]:null,quality:n?.quality?.name,renderer:d.renderer,ratio:d.pixelRatio,groups,vertices};}""")
    page.screenshot(path=str(out / (label + '-entry.png')))
    if page.evaluate('!!window.__drone?.flight'):
        page.evaluate("""()=>{window.__paintFrames=[];window.__drone.flight.setAutoSpeed(12);window.__drone.flight.setAutopilot(true);}""")
        page.wait_for_timeout(12000)
        result['flight'] = page.evaluate("""()=>{const f=window.__paintFrames,g=f.slice(1).map((t,i)=>t-f[i]).sort((a,b)=>a-b),w=[];let left=0;for(let i=0;i<f.length;i++){while(f[left]<f[i]-1000)left++;if(f[i]>=f[0]+1000)w.push(i-left+1);}const n=window.__holoNative;return {frames:f.length,mean:(f.length-1)*1000/(f.at(-1)-f[0]),minOneSecond:Math.min(...w),p95:g[Math.floor(g.length*.95)],p99:g[Math.floor(g.length*.99)],max:g.at(-1),canvas:[n.canvas.width,n.canvas.height],quality:n.quality.name};}""")
        page.screenshot(path=str(out / (label + '-flight.png')))
    browser.close()
(out / (label + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=True), flush=True)
if not result['entry'].get('paint') or not result['render']['vertices'] or result['errors']:
    sys.exit(1)
