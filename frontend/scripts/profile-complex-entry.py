"""CPU profile of the map page's entry: which functions hold the main thread in tasks over 40 ms.
Needs `vite build --minify false --outDir dist-prof` + `vite preview --outDir dist-prof --port 4174`."""
import json, sys, time, collections
from playwright.sync_api import sync_playwright
base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4174'
path = sys.argv[2] if len(sys.argv) > 2 else '/realestate-map?sido=11&sgg=11680&period=3m'
with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=False, args=['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900}); page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 200}); cdp.send('Profiler.start')
    page.goto(base + path, wait_until='commit')
    page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt", timeout=60000)
    page.wait_for_timeout(5000)
    prof = cdp.send('Profiler.stop')['profile']
    b.close()
nodes = {n['id']: n for n in prof['nodes']}
parent = {}
for n in prof['nodes']:
    for c in n.get('children', []): parent[c] = n['id']
# self time per node in 100 ms buckets is too coarse; report by function self time, split "before/after shown".
t = prof['startTime']; tot = collections.Counter(); byfile = collections.Counter()
for sid, dt in zip(prof['samples'], prof['timeDeltas']):
    n = nodes[sid]; cf = n['callFrame']
    name = cf['functionName'] or '(anon)'
    if name in ('(idle)', '(program)'): continue
    key = f"{name} {cf['url'].split('/')[-1]}:{cf['lineNumber']+1}"
    tot[key] += dt / 1000
    byfile[cf['url'].split('/')[-1]] += dt / 1000
# Owner: the nearest calling frame outside the three.js chunk (who asked for the work).
owner = collections.Counter(); ownerfn = collections.Counter()
for sid, dt in zip(prof['samples'], prof['timeDeltas']):
    n = nodes[sid]
    if n['callFrame']['functionName'] in ('(idle)', '(program)', '(root)'): continue
    cur = n; found = None
    while cur is not None:
        cf = cur['callFrame']; f = cf['url'].split('/')[-1]
        if f and not f.startswith('OrbitControls'): found = (f.split('-')[0], f"{cf['functionName'] or '(anon)'}:{cf['lineNumber']+1}"); break
        cur = nodes.get(parent.get(cur['id']))
    owner[found[0] if found else '(native)'] += dt / 1000
    if found: ownerfn[found[0] + ' ' + found[1]] += dt / 1000
# Busy spans: contiguous non-idle samples (a task the input could not interrupt), with what filled them.
spans = []; cur = None; tt = 0.0
for sid, dt in zip(prof['samples'], prof['timeDeltas']):
    tt += dt / 1000
    n = nodes[sid]; nm = n['callFrame']['functionName']
    idle = nm in ('(idle)',)
    if idle:
        if cur: spans.append(cur); cur = None
        continue
    if not cur: cur = {'t0': tt - dt / 1000, 'ms': 0.0, 'fn': collections.Counter(), 'own': collections.Counter()}
    cur['ms'] += dt / 1000
    cf = n['callFrame']; cur['fn'][f"{nm or '(anon)'} {cf['url'].split('/')[-1].split('-')[0]}:{cf['lineNumber']+1}"] += dt / 1000
    c2 = n; found = '(native)'
    while c2 is not None:
        f = c2['callFrame']['url'].split('/')[-1]
        if f and not f.startswith('OrbitControls'): found = f.split('-')[0] + ':' + (c2['callFrame']['functionName'] or '(anon)'); break
        c2 = nodes.get(parent.get(c2['id']))
    cur['own'][found] += dt / 1000
if cur: spans.append(cur)
# Inclusive time per function name (all samples below it), for the scene builders.
selfms = collections.Counter()
for sid, dt in zip(prof['samples'], prof['timeDeltas']): selfms[sid] += dt / 1000
incl = collections.Counter()
for nid in list(selfms):
    seen = set(); cur = nid
    while cur is not None:
        cf = nodes[cur]['callFrame']; key = f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1].split('-')[0]}:{cf['lineNumber']+1}"
        if key not in seen: incl[key] += selfms[nid]; seen.add(key)
        cur = parent.get(cur)
print('=== inclusive ms (ComplexHologram/Renderer/Region functions)')
for k, v in incl.most_common(200):
    if any(x in k for x in ('ComplexHologram', 'ComplexRenderer', 'RegionMap3D')) and v > 25: print(f'{v:8.0f}  {k}')
print('=== busy spans > 50 ms (t is ms since profile start)')
for sp in spans:
    if sp['ms'] > 50:
        print(f"t={sp['t0']:.0f} {sp['ms']:.0f}ms owner={sp['own'].most_common(2)} top={[(k, round(v)) for k, v in sp['fn'].most_common(3)]}")
print('=== by owner (nearest non-three caller, ms)'); [print(f'{v:8.0f}  {k}') for k, v in owner.most_common(10)]
print('=== by owner fn'); [print(f'{v:8.0f}  {k}') for k, v in ownerfn.most_common(25)]
print('=== by file (ms)'); [print(f'{v:8.0f}  {k}') for k, v in byfile.most_common(12)]
print('=== top self time (ms)'); [print(f'{v:8.0f}  {k}') for k, v in tot.most_common(45)]
