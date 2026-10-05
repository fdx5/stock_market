"""The render pipelines the 3D view makes on a real load, recorded as public/3d/pipelines.json
(compiled ahead on the map page: components/tidewater/pipelineWarm.js).

Run against a production build of the current shaders (vite preview, real data), after a change
to any material or shader; an out-of-date manifest only misses:

    python scripts/capture-pipelines.py --base http://127.0.0.1:4173
"""
import argparse, asyncio, gzip, hashlib, json, sys
from pathlib import Path
from urllib.parse import urlencode
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding="utf-8")
ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:4173")
ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "public" / "3d" / "pipelines.json"))
# two complexes unlike each other (hillside towers and a riverside one): their union covers ~90% of a third
ap.add_argument("--complex", action="append", default=None)
args = ap.parse_args()
COMPLEXES = args.complex or ["11290:길음동:1288:래미안길음센터피스", "11650:반포동:1:래미안원베일리"]

RECORD = r"""
(() => {
  const P = GPUDevice.prototype, ids = new WeakMap(); let next = 0;
  const rec = window.__pipeRec = { modules: {}, bgls: {}, layouts: {}, pipelines: [] };
  const idOf = o => { if (!ids.has(o)) ids.set(o, ++next); return ids.get(o); };
  const wrap = (name, f) => { const o = P[name]; P[name] = function (d) { const r = o.call(this, d); try { f(d, r); } catch {} return r; }; };
  wrap('createShaderModule', (d, m) => { rec.modules[idOf(m)] = d.code; });
  wrap('createBindGroupLayout', (d, l) => { const { label, ...rest } = d; rec.bgls[idOf(l)] = JSON.parse(JSON.stringify(rest)); });
  wrap('createPipelineLayout', (d, l) => { rec.layouts[idOf(l)] = d.bindGroupLayouts.map(b => b ? idOf(b) : null); });
  const stage = s => s && JSON.parse(JSON.stringify({ ...s, module: idOf(s.module) }));
  for (const n of ['createRenderPipeline', 'createRenderPipelineAsync']) wrap(n, d => rec.pipelines.push({
    layout: d.layout === 'auto' ? 'auto' : idOf(d.layout), vertex: stage(d.vertex), fragment: stage(d.fragment),
    primitive: d.primitive, depthStencil: d.depthStencil, multisample: d.multisample }));
})();
"""

def h(v): return hashlib.sha1((v if isinstance(v, str) else json.dumps(v, sort_keys=True)).encode()).hexdigest()[:12]

async def main():
    man, seen = {"modules": {}, "bgls": {}, "layouts": {}, "pipelines": []}, set()
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True, args=["--enable-unsafe-webgpu"])
        for cid in COMPLEXES:
            page = await browser.new_page(viewport={"width": 1600, "height": 900})
            await page.add_init_script(RECORD)
            sgg, dong = cid.split(":")[:2]
            await page.goto(f"{args.base}/realestate-map?{urlencode({'sido': sgg[:2], 'sgg': sgg, 'dong': dong, 'complex': cid, '3d': '1'})}")
            await page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt", timeout=180000)
            await page.wait_for_timeout(15000)  # (traffic, water, plants: pipelines made after the first frame)
            rec = await page.evaluate("window.__pipeRec")
            await page.close()
            mods = {k: h(code) for k, code in rec["modules"].items()}
            for k, code in rec["modules"].items(): man["modules"][mods[k]] = code
            groups = {k: h(b) for k, b in rec["bgls"].items()}
            for k, b in rec["bgls"].items(): man["bgls"][groups[k]] = b
            lays = {k: h([groups.get(str(g)) for g in l]) for k, l in rec["layouts"].items()}
            for k, l in rec["layouts"].items(): man["layouts"][lays[k]] = [groups.get(str(g)) for g in l]
            added = 0
            for q in rec["pipelines"]:
                q = {k: v for k, v in q.items() if v is not None}
                q["layout"] = "auto" if q["layout"] == "auto" else lays[str(q["layout"])]
                for st in ("vertex", "fragment"):
                    if st in q: q[st] = {**q[st], "module": mods[str(q[st]["module"])]}
                key = h(q)
                if key in seen: continue
                seen.add(key); man["pipelines"].append(q); added += 1
            print(f"{cid}: {len(rec['pipelines'])} pipelines, {added} new")
        await browser.close()
    raw = json.dumps(man, separators=(",", ":"))
    Path(args.out).write_text(raw, encoding="utf-8")
    print(f"{args.out}: {len(man['pipelines'])} pipelines, {len(man['modules'])} modules, {len(raw)} bytes ({len(gzip.compress(raw.encode()))} gzipped)")

asyncio.run(main())
