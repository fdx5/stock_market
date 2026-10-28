"""Walk-mode interior frame measurement (walk-mode spec section 12).

Opens /walk?interior=demo in headful Chrome (muted), walks a route through every room of the
generated flat with the keyboard state the page reads (W held, heading set toward each
waypoint), uses the switches, taps, curtains and the TV on the way, and reports frame statistics
for the walk only (not the loading): average fps, the lowest one-second fps, p95/p99 frame time,
the longest frame, with the drawing-buffer size, pixel ratio and renderer.

usage: python scripts/measure-walk.py [--base http://127.0.0.1:5190] [--area 84] [--style modern_white]
       [--size 1600x900] [--cpu 1] [--out docs/walk-mode-measurements-YYYYMMDD.json]
"""
import argparse, asyncio, json, math, time
from playwright.async_api import async_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:5190")
ap.add_argument("--area", default="84")
ap.add_argument("--style", default="modern_white")
ap.add_argument("--hour", default="14")
ap.add_argument("--size", default="1600x900")
ap.add_argument("--cpu", type=float, default=1)
ap.add_argument("--mobile", action="store_true", help="390x844 at DPR 3, touch")
ap.add_argument("--out", default="")
a = ap.parse_args()
W, H = (390, 844) if a.mobile else map(int, a.size.split("x"))

STEP = """(wp) => { const it = window.__walk.interior; if (!it) return -1;
  const dx = wp[0] - it.pos.x, dz = wp[1] - it.pos.y, d = Math.hypot(dx, dz);
  it.yaw = Math.atan2(-dx, -dz); it.pitch = -0.08;
  if (d < 0.35) { it.keys.delete('KeyW'); return d; }
  it.keys.add('KeyW'); return d; }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=False, args=["--mute-audio", "--ignore-gpu-blocklist", f"--window-size={W},{H + 120}"])
        ctx = await b.new_context(viewport={"width": W, "height": H}, device_scale_factor=3 if a.mobile else 1, is_mobile=a.mobile, has_touch=a.mobile)
        pg = await ctx.new_page()
        if a.cpu > 1:
            cdp = await ctx.new_cdp_session(pg); await cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
        t0 = time.time()
        await pg.goto(f"{a.base}/walk?interior=demo&auto=1&area={a.area}&style={a.style}&hour={a.hour}&floor=12")
        while not await pg.evaluate("() => !!(window.__walk && window.__walk.interior && window.__walk.interior.running)"):
            await asyncio.sleep(0.25)
            if time.time() - t0 > 180: raise SystemExit("did not load")
        load_s = time.time() - t0
        await asyncio.sleep(1.0)
        # the route: entrance → hall → every room and back, from the plan itself
        route = await pg.evaluate("""() => { const it = window.__walk.interior, plan = it.o.plan, pts = [];
          const c = r => [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];
          const door = o => o.axis === 'z' ? [o.center, o.at] : [o.at, o.center];
          const order = ['hall', 'bedroom', 'kitchen', 'living', 'master', 'dressroom', 'bathroom'];
          const hall = plan.rooms.find(r => r.type === 'hall'), kit = plan.rooms.find(r => r.type === 'kitchen');
          pts.push(c(hall));
          for (const r of plan.rooms.filter(r => ['bedroom', 'bathroom'].includes(r.type))) {
            const o = plan.openings.find(o => (o.a === r.id && o.b === 'hall') || (o.b === r.id && o.a === 'hall'));
            if (!o) continue; pts.push(door(o), c(r), door(o), c(hall));
          }
          pts.push(c(kit), c(plan.rooms.find(r => r.type === 'living')));
          const m = plan.rooms.find(r => r.type === 'master'), mo = plan.openings.find(o => (o.a === m.id && o.b === 'living'));
          if (mo) pts.push(door(mo), c(m), door(mo));
          pts.push(c(kit));
          return pts; }""")
        await pg.evaluate("() => { const it = window.__walk.interior; it.perf.intervals.length = 0; it.perf.worst = 0; it.perf.long.length = 0; }")
        acts = ["switch-living", "tv", "curtain-3", "tap-10", "aircon", "robot"]
        walked = time.time()
        for i, wp in enumerate(route):
            for _ in range(400):
                d = await pg.evaluate(STEP, wp)
                if d < 0.35: break
                await asyncio.sleep(0.05)
            if i < len(acts):
                await pg.evaluate("(id) => { const it = window.__walk.interior; const x = it.interactables.find(i => i.id.startsWith(id)); if (x) x.act(); }", acts[i])
        await pg.evaluate("() => window.__walk.interior.keys.clear()")
        st = await pg.evaluate("() => window.__walk.interior.stats()")
        gl = await pg.evaluate("() => { const r = window.__walk.renderer; const g = r.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return { renderer: 'three WebGLRenderer (WebGL2)', gpu: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '' } }")
        res = {"when": time.strftime("%Y-%m-%d %H:%M"), "url_area": a.area, "style": a.style, "viewport": [W, H], "mobile": a.mobile, "cpu_throttle": a.cpu,
               "load_to_walk_s": round(load_s, 1), "walk_s": round(time.time() - walked, 1), **gl, **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in st.items()}}
        print(json.dumps(res, ensure_ascii=False, indent=1))
        if a.out:
            json.dump(res, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        await b.close()

asyncio.run(main())
