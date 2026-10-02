"""40 s film of a complex's 3D view, frame by frame on a virtual clock (no dropped frames).
env: CID, NAME (caption), W, H, DPR, OUT (mp4 path), FRAMES (dir), SECS (default 40)."""
import os, sys, json, urllib.parse, subprocess, shutil, time
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8")
CID = os.environ["CID"]; NAME = os.environ.get("NAME", "")
W, H, DPR = int(os.environ.get("W", "1920")), int(os.environ.get("H", "1080")), float(os.environ.get("DPR", "1"))
OUT = os.environ["OUT"]; FR = os.environ["FRAMES"]; SECS = float(os.environ.get("SECS", "40")); FPS = 30
BASE = os.environ.get("BASE", "http://127.0.0.1:4177")
shutil.rmtree(FR, ignore_errors=True); os.makedirs(FR)

INIT = r"""
(() => {
  const realNow = performance.now.bind(performance);
  window.__vt = 0; window.__film = false; window.__realNow = realNow;
  performance.now = () => (window.__film ? window.__vt : realNow());
  const css = `
    .re-holo--expanded .re-holo-stage{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483000!important;margin:0!important;border-radius:0!important}
    .re-holo-signs,.re-holo-scene-label,.re-holo-stale,.re-holo-tip{display:none!important}
    #film-cap{position:fixed;z-index:2147483600;left:4.2vmin;bottom:4.6vmin;color:#fff;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;text-shadow:0 2px 12px rgba(0,0,0,.55);pointer-events:none;transition:opacity .6s}
    #film-cap b{display:block;font-size:4.6vmin;font-weight:700;letter-spacing:-.02em}
    #film-cap span{display:block;font-size:2.5vmin;opacity:.92;margin-top:.6vmin}
    @media (max-aspect-ratio: 1/1){#film-cap{top:14vmin;bottom:auto}}
    #film-mark{position:fixed;z-index:2147483600;right:3.6vmin;top:3.4vmin;color:rgba(255,255,255,.85);font:600 2vmin "Malgun Gothic",sans-serif;letter-spacing:.04em;text-shadow:0 1px 8px rgba(0,0,0,.5)}`;
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const c = document.createElement('div'); c.id = 'film-cap'; c.innerHTML = '<b></b><span></span>'; document.body.appendChild(c);
    const m = document.createElement('div'); m.id = 'film-mark'; m.textContent = 'KOSPIMAP · 3D 단지뷰'; document.body.appendChild(m);
  });
})();
"""

SETUP = r"""
(name) => {
  const st = window.__complexStage, d = window.__holoData;
  const c = st.controls; c.enableDamping = false; c.autoRotate = true; c.autoRotateSpeed = 0; c.enabled = false;
  st.intro = null; st.fly = null;
  // complex centre and size (footprint x east / y north -> world x, -z)
  const towers = d.buildings.filter(b => b.floors >= 10);
  const pts = (towers.length ? towers : d.buildings).flatMap(b => b.rings[0]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, span = Math.max(x1 - x0, y1 - y0);
  const top = Math.max(...d.buildings.map(b => b.height)), floor = st.floor ?? 0;
  // the road for the close shot: wide, near the complex, long enough to dolly along
  let best = null;
  for (const r of d.roads || []) for (let i = 0; i + 1 < r.line.length; i++) {
    const [ax, ay] = r.line[i], [bx, by] = r.line[i + 1], len = Math.hypot(bx - ax, by - ay);
    if (len < 40) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dist = Math.hypot(mx - cx, my - cy);
    if (dist < span * 0.45 || dist > span * 0.5 + 220) continue;
    const score = r.width * 3 + Math.min(len, 160) * 0.2 - dist * 0.08;
    if (!best || score > best.score) best = { score, ax, ay, bx, by, len, w: r.width, mx, my };
  }
  // The Han: where the river parcels (천) lie round the complex — the view looks at the complex
  // from over the water, the river in the foreground.
  let wx = 0, wy = 0, wsum = 0;
  for (const p of d.parcels || []) {
    if (p.kind !== '천') continue;
    let a = 0, mx = 0, my = 0;
    for (let i = 0; i < p.ring.length; i++) { const [x1, y1] = p.ring[i], [x2, y2] = p.ring[(i + 1) % p.ring.length]; a += x1 * y2 - x2 * y1; mx += x1; my += y1; }
    a = Math.abs(a) / 2; mx /= p.ring.length; my /= p.ring.length;
    if (a < 2000) continue;
    wx += (mx - cx) * a; wy += (my - cy) * a; wsum += a;
  }
  const riverAng = wsum ? Math.atan2(wy, wx) : -0.9;
  let dRiver = Infinity;
  for (const p of d.parcels || []) if (p.kind === '천') for (const [x, y] of p.ring) {
    const ang = Math.atan2(y - cy, x - cx), dd = Math.hypot(x - cx, y - cy);
    if (Math.abs(Math.atan2(Math.sin(ang - riverAng), Math.cos(ang - riverAng))) < 0.5) dRiver = Math.min(dRiver, dd);
  }
  if (!Number.isFinite(dRiver)) dRiver = span * 0.6 + 60;
  window.__shot = { cx, cy, span, top, floor, road: best, name, riverAng, dRiver, rscale: window.__rscale || 1 };
  // (the film's clock starts where the page's was: a jump back broke the look's easing)
  window.__vt = window.__realNow();
  return { cx, cy, span, top, floor, riverAng: +riverAng.toFixed(2), dRiver: Math.round(dRiver), river: !!wsum };
}
"""

STEP = r"""
async ([t, dtMs]) => {
  const st = window.__complexStage, S = window.__shot, cam = st.camera, c = st.controls;
  const smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const lerp = (a, b, k) => a + (b - a) * k;
  // all from the river side: the camera over the water (or its far bank), the complex beyond it
  // (out over the water: the Han fills the foreground)
  const K = S.rscale || 1;
  const Rw = K * Math.max(S.dRiver + 480, S.span * 0.9 + 300), Hw = S.floor + K * Math.max(S.top * 1.75, 190);
  const Rc = K * Math.max(S.dRiver + 150, S.span * 0.5 + 180), Hc = S.floor + S.top * 0.55;
  const tgtY = S.floor + S.top * 0.34;
  const at = (ang, r, h) => ({ p: [S.cx + Math.cos(ang) * r, h, -(S.cy + Math.sin(ang) * r)], q: [S.cx, tgtY, -S.cy] });
  const A0 = S.riverAng;
  const blend = (u, v, k) => ({ p: u.p.map((x, i) => lerp(x, v.p[i], k)), q: u.q.map((x, i) => lerp(x, v.q[i], k)) });
  // 0-10 s: the wide river view, sweeping along the bank
  // (one smooth sweep along the river, ±0.6 rad either side of looking straight across it)
  // (from 21 s on the turn carries on past the river side, round the complex)
  const sweep = u => A0 + 0.6 * Math.sin(u * 0.09 - 1.0);
  const wideAng = t < 21 ? sweep(t) : sweep(21) + 0.6 * 0.09 * Math.cos(21 * 0.09 - 1.0) * (t - 21) + 0.0035 * (t - 21) ** 2;
  let shot = at(wideAng, Rw, Hw);
  let cap = [S.name, ''], hour = 10.5, rain = 0, snow = 0;
  if (t >= 9 && t < 21) {
    // 10-21 s: down to the riverside, nearer, the towers rising over the bank
    const wide = at(wideAng, Rw, Hw);
    const close = at(A0 + 0.45 - 0.07 * (t - 9), Rc, Hc);
    close.q = [S.cx, S.floor + S.top * 0.3, -S.cy];
    shot = blend(wide, close, smooth((t - 9) / 2) * (1 - smooth((t - 19.2) / 1.8)));
  }
  if (t >= 21 && t < 32) {
    hour = lerp(5.0, 21.5, smooth((t - 21) / 11));
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    const phase = hour < 7 ? '새벽' : hour < 16.5 ? '낮' : hour < 19.3 ? '일몰' : '저녁';
    cap = [S.name, `타임랩스 · ${phase} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`];
  }
  if (t >= 32) {
    hour = 14;
    rain = t >= 32.6 && t < 35.6 ? 1 : 0; snow = t >= 36 && t < 39 ? 1 : 0;
    cap = [S.name, t < 35.8 ? '날씨 · 비' : t < 39.1 ? '날씨 · 눈' : '날씨 · 맑음'];
  }
  cam.position.set(...shot.p); c.target.set(...shot.q); cam.lookAt(c.target);
  const a = st.atmos;
  if (Math.abs(a.hour - hour) > 1e-4) { a.hour = hour; a.dirty = true; }
  a.wantRain = rain; a.wantSnow = snow;
  const capEl = document.getElementById('film-cap');
  if (capEl) { capEl.children[0].textContent = cap[0]; capEl.children[1].textContent = cap[1]; capEl.children[1].style.display = cap[1] ? '' : 'none'; }
  window.__film = true; window.__vt += dtMs;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}
"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=["--enable-unsafe-webgpu", f"--window-size={W + 40},{H + 160}"])
    ctx = br.new_context(viewport={"width": W, "height": H}, device_scale_factor=DPR)
    page = ctx.new_page(); page.add_init_script(INIT)
    page.goto(f"{BASE}/realestate-map?sido=11&sgg={CID[:5]}&period=3m&complex={urllib.parse.quote(CID)}&3d=1&pr=2&hour=10.5&weather=clear")
    page.wait_for_function("window.__complexStage && document.querySelector('.re-holo--expanded .re-holo-stage')?.dataset.shownAt", timeout=180000)
    page.wait_for_function("window.__holoData", timeout=60000)
    page.wait_for_timeout(int(os.environ.get("LOAD", "45000")))   # everything in: ring, land use, trees, traffic
    page.evaluate(f"window.__rscale = {float(os.environ.get('RSCALE', '1'))}")
    info = page.evaluate(SETUP, NAME); print("setup", info, flush=True)
    # a few warm steps on the new camera (TAA history)
    for _ in range(20): page.evaluate(STEP, [0, 1000 / 60])
    n = int(SECS * FPS); t0 = time.time()
    sample = [float(x) for x in os.environ.get("SAMPLE", "").split(",") if x]
    for f in range(n):
        t = f / FPS
        page.evaluate(STEP, [t, 1000 / 60]); page.evaluate(STEP, [t + 1 / 60, 1000 / 60])
        if sample:
            if any(abs(t - x) < 0.5 / FPS for x in sample): page.screenshot(path=os.path.join(FR, f"s{t:05.1f}.jpg"), type="jpeg", quality=90)
            continue
        page.screenshot(path=os.path.join(FR, f"f{f:05d}.jpg"), type="jpeg", quality=93)
        if f % 150 == 0: print(f"frame {f}/{n}  {time.time() - t0:.0f}s", flush=True)
    br.close()
    if sample: sys.exit(0)
ff = os.environ.get("FFMPEG") or r"I:\ai_root\stock_market\backend\.venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
subprocess.run([ff, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(FR, "f%05d.jpg"),
                "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], check=True)
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
