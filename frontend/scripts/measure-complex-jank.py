"""Input smoothness while the 3D complex view loads on the real-estate map (PC).
Moves the real mouse continuously and records what the page saw: input delay of pointermove
events (Event Timing), long tasks / long animation frames, rAF gaps, and per-phase counts.
Needs `vite build` + `vite preview --port 4173` and the review backend on :8002.
Usage: python frontend/scripts/measure-complex-jank.py [--base http://127.0.0.1:4173] [--throttle 4] [--headless]
"""
import argparse, json, math, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://127.0.0.1:4173')
ap.add_argument('--path', default='/realestate-map?sido=11&sgg=11680&period=3m')
ap.add_argument('--throttle', type=float, default=1)
ap.add_argument('--headless', action='store_true')
ap.add_argument('--webgl', action='store_true')
ap.add_argument('--label', default='run')
ap.add_argument('--detail', action='store_true')
ap.add_argument('--no-3d', action='store_true', help='block both 3D chunks: the page alone')
ap.add_argument('--no-region', action='store_true', help='collapse the region map (isolate the complex view)')
ap.add_argument('--size', default='1600x900', help='viewport WxH')
ap.add_argument('--a11y', action='store_true', help='accessibility on, as screen readers, IMEs and password managers turn it on')
ap.add_argument('--channel', default='chrome', help='chrome | msedge')
ap.add_argument('--no-full', action='store_true', help='control: close the card without opening full screen')
ap.add_argument('--trace', default='', help='browser trace (all processes) of the after-close phase')
ap.add_argument('--card-after', type=int, default=10)
ap.add_argument('--after', type=int, default=15, help='seconds measured after closing full screen')
ap.add_argument('--close-card', action='store_true', help='then close the detail card too')
a = ap.parse_args()

INIT = """
window.__j = {tasks:[], loaf:[], events:[], gaps:[], marks:[]};
window.__mark = n => window.__j.marks.push([n, performance.now()]);
try{ new PerformanceObserver(l=>{for(const e of l.getEntries()) window.__j.tasks.push([e.startTime,e.duration]);}).observe({type:'longtask',buffered:true}); }catch(e){}
try{ new PerformanceObserver(l=>{for(const e of l.getEntries()) window.__j.loaf.push([e.startTime,e.duration,e.blockingDuration||0,(e.scripts||[]).map(x=>[x.invoker||'',(x.sourceURL||'').split('/').pop(),x.sourceFunctionName||'',Math.round(x.duration)]),Math.round(e.renderStart?e.renderStart-e.startTime:0),Math.round(e.styleAndLayoutStart?e.startTime+e.duration-e.styleAndLayoutStart:0)]);}).observe({type:'long-animation-frame',buffered:true}); }catch(e){}
try{ new PerformanceObserver(l=>{for(const e of l.getEntries()) if(e.name==='pointermove'||e.name==='mousemove'||e.name==='pointerdown'||e.name==='click') window.__j.events.push([e.startTime,e.processingStart-e.startTime,e.duration,e.name]);}).observe({type:'event',durationThreshold:16,buffered:true}); }catch(e){}
(()=>{let prev=performance.now();const f=t=>{const d=t-prev;prev=t;if(d>34)window.__j.gaps.push([t,d]);requestAnimationFrame(f);};requestAnimationFrame(f);})();
"""

def summarize(j, t0, t1, label):
    inw = lambda t: t0 <= t < t1
    tasks = [d for s, d in j['tasks'] if inw(s)]
    gaps = [d for s, d in j['gaps'] if inw(s)]
    ev = [e for e in j['events'] if inw(e[0])]
    delays = [e[1] for e in ev]
    loaf = [x[2] for x in j['loaf'] if inw(x[0])]
    r = dict(phase=label, window_s=round((t1 - t0) / 1000, 1),
             longtasks=len(tasks), longtask_total_ms=round(sum(tasks)), longtask_max_ms=round(max(tasks, default=0)),
             frame_gaps_gt34=len(gaps), frame_gap_max_ms=round(max(gaps, default=0)), frame_gap_total_ms=round(sum(gaps)),
             slow_events=len(ev), event_delay_max_ms=round(max(delays, default=0)), event_dur_max_ms=round(max([e[2] for e in ev], default=0)),
             blocking_total_ms=round(sum(loaf)))
    return r

with sync_playwright() as p:
    args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] + (['--force-renderer-accessibility'] if a.a11y else [])
    browser = p.chromium.launch(channel=a.channel, headless=a.headless, args=args)
    ctx = browser.new_context(viewport={'width': int(a.size.split('x')[0]), 'height': int(a.size.split('x')[1])})
    page = ctx.new_page()
    if a.webgl: page.add_init_script("Object.defineProperty(navigator, 'gpu', {value: undefined});")
    page.add_init_script(INIT)
    if a.no_region: page.add_init_script("try{localStorage.setItem('re_region_map','closed')}catch(e){}")
    if a.no_3d: page.route(lambda u: ('/assets/ComplexHologram-' in u or '/assets/RegionMap3D-' in u), lambda r: r.fulfill(body='export default ()=>null;export const warmGpu=()=>{};export const prefetchComplex=()=>{};', content_type='application/javascript'))
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    cdp = ctx.new_cdp_session(page)
    if a.throttle > 1: cdp.send('Emulation.setCPUThrottlingRate', {'rate': a.throttle})

    state = {'x': 300.0, 'y': 300.0, 't': 0.0}
    def wiggle(ms):
        """Move the pointer continuously for ms milliseconds (a slow circle across the page)."""
        end = time.time() + ms / 1000
        while time.time() < end:
            state['t'] += 0.08
            x = 800 + 500 * math.cos(state['t']); y = 450 + 280 * math.sin(state['t'] * 1.3)
            page.mouse.move(x, y)
            page.wait_for_timeout(8)

    now = lambda: page.evaluate('performance.now()')
    report = []
    page.goto(a.base + a.path, wait_until='commit')
    t_nav = 0.0
    # Phase 1: entry, until the rail's 3D view has shown (and 4 s after).
    page.wait_for_selector('.kospi-map-tile', timeout=60000)
    wiggle(500)
    shown = None
    t_end = time.time() + 40
    while time.time() < t_end and not a.no_3d:
        wiggle(250)
        try:
            shown = page.evaluate("document.querySelector('.re-holo-stage')?.dataset.shownAt")
        except Exception: shown = None
        if shown: break
    wiggle(4000)
    T1 = now()
    if a.detail: print('TASKS0', [(round(x), round(y)) for x, y in page.evaluate('window.__j')['tasks']])
    report.append(summarize(page.evaluate('window.__j'), 0, T1, 'entry (page load -> 3D shown + 4s)'))
    report[-1]['shownAt_ms'] = shown

    if a.no_3d:
        print(json.dumps({'label': 'no-3d', 'phases': report}, indent=1)); browser.close(); sys.exit(0)
    # Phase 2: click a complex tile (opens the detail card; the rail view switches to it).
    tiles = page.locator('.kospi-map-tile')
    n = tiles.count()
    tgt = tiles.nth(min(3, n - 1))
    tgt.scroll_into_view_if_needed(); page.wait_for_timeout(300)
    box = tgt.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=6)
    T2 = now()
    page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    wiggle(6000)
    T3 = now()
    report.append(summarize(page.evaluate('window.__j'), T2, T3, 'tile click (6s)'))

    # Phase 3: the card's 3D button opens the view full screen.
    btn = page.locator('.re-holo-open').first
    if a.no_full:
        page.keyboard.press('Escape')
        page.locator('.re-holo-stage').scroll_into_view_if_needed()
        for k in range(4):
            t = now(); wiggle(5000)
            report.append(summarize(page.evaluate('window.__j'), t, now(), f'card closed, never full {k*5}-{k*5+5}s'))
            report[-1]['stage'] = page.evaluate("({...(document.querySelector('.re-holo-stage')?.dataset||{})})")
        print(json.dumps({'label': a.label, 'errors': errs[:5], 'phases': report}, ensure_ascii=False, indent=1)); browser.close(); sys.exit(0)
    try: btn.wait_for(timeout=15000)
    except Exception: page.screenshot(path='C:/Users/fdx5/AppData/Local/Temp/claude/I--ai-root-stock-market/7c48c3dc-697d-4a52-921c-c153f256c325/scratchpad/nobtn.png')
    if btn.count():
        T4 = now()
        btn.click()
        wiggle(9000)
        T5 = now()
        report.append(summarize(page.evaluate('window.__j'), T4, T5, 'open full screen 3D (9s)'))
        report[-1]['stage'] = page.evaluate("({...(document.querySelector('.re-holo-stage')?.dataset||{})})")
        # Phase 4: close it (the card is back on top) and keep moving the pointer.
        close = page.locator('.re-holo-wide-close')
        if close.count():
            T6 = now()
            if a.trace: browser.start_tracing(page=page, path=a.trace, categories=['devtools.timeline','toplevel','accessibility','disabled-by-default-devtools.timeline','blink','cc','viz','gpu'])
            close.click()
            for k in range(a.after // 5):
                t = now(); wiggle(5000)
                report.append(summarize(page.evaluate('window.__j'), t, now(), f'after close {k*5}-{k*5+5}s'))
                report[-1]['stage'] = page.evaluate("({...(document.querySelector('.re-holo-stage')?.dataset||{})})")
            print('STATE', page.evaluate("({inert: document.querySelectorAll('[inert]').length, nodes: document.getElementsByTagName('*').length, active: document.activeElement?.className, overflow: document.body.style.overflow})"))
            if a.close_card:
                page.keyboard.press('Escape')
                for k in range(a.card_after // 5):
                    t = now(); wiggle(5000)
                    report.append(summarize(page.evaluate('window.__j'), t, now(), f'card closed {k*5}-{k*5+5}s'))
                    report[-1]['stage'] = page.evaluate("({...(document.querySelector('.re-holo-stage')?.dataset||{})})")
                print('STATE2', page.evaluate("({inert: document.querySelectorAll('[inert]').length, nodes: document.getElementsByTagName('*').length, active: document.activeElement?.className, overflow: document.body.style.overflow, y: scrollY})"))
                print('GAPS2', [(round(x), round(y)) for x, y in page.evaluate('window.__j')['gaps'] if x > T6])
            if a.trace: browser.stop_tracing()
    else:
        report.append({'phase': 'open full screen', 'error': 'no 3D button'})
    if a.detail:
        j = page.evaluate('window.__j')
        print('TASKS', [(round(a), round(b)) for a, b in j['tasks'] if a < T1])
        print('GAPS', [(round(a), round(b)) for a, b in j['gaps'] if a < T1 and b > 60])
        for x in j['loaf']:
            if x[1] > 80 and x[0] < T1: print('LOAF t=%d dur=%d block=%d style/layout=%d scripts=%s' % (x[0], x[1], x[2], x[5], x[3]))
    print(json.dumps({'label': a.label, 'throttle': a.throttle, 'errors': errs[:5], 'phases': report}, ensure_ascii=False, indent=1))
    browser.close()
