import { useEffect, useRef, useState } from "react";
import type { WalkGame } from "./game/WalkGame";
import { CATEGORY, categoryOf } from "./building/categories";
/** what the map marks: public offices, museums, large marts and department stores, hospitals, schools */
const MAJOR = new Set<string>(["public", "museum", "mart", "department", "hospital", "school"]);

/* The street map in the corner while walking: north up, 500 m round the walker — the roads, the
 * buildings (apartment blocks darker), the 공동현관 to go in by, the names (법정동, 단지, named
 * buildings, each block's 동 number, none overlapping), the patches of town already built
 * from the aerial photographs (and the one being built), and the walker with the way they face.
 * The streets and buildings are drawn to a layer again only when the walker has moved on (or every
 * two seconds as the world streams in); the walker's arrow is drawn every frame on top. M hides it;
 * a click toggles 500 m / 250 m. */

const SIZE = 240;

/* The 법정동 round the walk (the real-estate map's boundary files: 시도 → 시군구 → 읍면동), in the
 * walk's frame: each dong's outline and the place its name sits. Read once per start. */
type Ring = number[][];
type Geo = { features: { properties: { code: string; name: string; lx: number; ly: number }; geometry: { type: string; coordinates: Ring[] | Ring[][] } }[] };
export interface MapDong { name: string; x: number; y: number; rings: [number, number][][] }
const polys = (g: Geo["features"][number]["geometry"]) => (g.type === "MultiPolygon" ? (g.coordinates as Ring[][]).map(p => p[0]) : [(g.coordinates as Ring[])[0]]);
const inside = (rings: Ring[], x: number, y: number) => rings.some(r => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
});
/** The register names each block ("은마아파트(31동)", "은마아파트 7동"): one name per complex,
 * placed at the middle of its blocks. */
function complexes(dests: readonly { name: string; x: number; y: number; n: number }[]) {
  const out: { name: string; x: number; y: number; n: number }[] = [];
  for (const d of dests) {
    const name = d.name.replace(/\(.*?\)/g, "").replace(/\s*(제\s*)?[0-9A-Z]{1,4}\s*동$/, "").trim();
    if (name.length < 3 || name === "아파트") continue;
    const same = out.find(o => o.name === name && Math.hypot(o.x - d.x, o.y - d.y) < 700);
    if (same) { const n = same.n + d.n; same.x = (same.x * same.n + d.x * d.n) / n; same.y = (same.y * same.n + d.y * d.n) / n; same.n = n; }
    else out.push({ name, x: d.x, y: d.y, n: d.n });
  }
  return out.sort((a, b) => b.n - a.n);
}
const dongCache = new Map<string, Promise<MapDong[]>>();
function dongsAround(g: WalkGame): Promise<MapDong[]> {
  const o = g.origin, key = `${o.lon.toFixed(4)},${o.lat.toFixed(4)}`;
  let p = dongCache.get(key);
  if (!p) {
    const get = (u: string) => fetch(`/geo/realestate/${u}`).then(r => (r.ok ? (r.json() as Promise<Geo>) : null)).catch(() => null);
    const find = (geo: Geo | null) => geo?.features.find(f => inside(polys(f.geometry), o.lon, o.lat));
    p = (async () => {
      const sido = find(await get("sido.json")); if (!sido) return [];
      const sgg = find(await get(`sgg/${sido.properties.code}.json`)); if (!sgg) return [];
      const emd = await get(`emd/${sgg.properties.code}.json`); if (!emd) return [];
      const fr = (lon: number, lat: number): [number, number] => [(lon - o.lon) * o.kx, (lat - o.lat) * o.ky];
      return emd.features.map(f => {
        const [x, y] = fr(f.properties.lx, f.properties.ly);
        return { name: f.properties.name, x, y, rings: polys(f.geometry).map(r => r.map(([lon, lat]) => fr(lon, lat))) };
      });
    })();
    dongCache.set(key, p);
  }
  return p;
}

export default function OutdoorMap({ game }: { game: () => WalkGame | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState(true), [near, setNear] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.code === "KeyM" && !e.repeat) setShown(s => !s); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => {
    if (!shown) return;
    const c = cv.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), px = SIZE * dpr;
    c.width = c.height = px;
    const ctx = c.getContext("2d")!;
    const layer = document.createElement("canvas"); layer.width = layer.height = px;
    const lg = layer.getContext("2d")!;
    const R = near ? 250 : 500, k = px / (2 * R);
    let at = { x: NaN, y: NaN }, drawnAt = 0, raf = 0, dongs: MapDong[] = [], asked = false;
    const draw = (g: WalkGame) => {
      const W = g.world, ox = g.pos.x, oy = g.pos.y;
      const X = (x: number) => (x - ox) * k + px / 2, Y = (y: number) => px / 2 - (y - oy) * k;
      lg.clearRect(0, 0, px, px);
      lg.fillStyle = "#0b141b"; lg.fillRect(0, 0, px, px);
      // the patches built from the aerial photographs
      for (const r of g.ground?.regions() ?? []) {
        lg.fillStyle = r.state === "ready" ? "rgba(70,140,90,0.16)" : "rgba(94,240,255,0.08)";
        lg.fillRect(X(r.rect[0]), Y(r.rect[3]), (r.rect[2] - r.rect[0]) * k, (r.rect[3] - r.rect[1]) * k);
        if (r.state === "building") { lg.strokeStyle = "rgba(94,240,255,0.5)"; lg.setLineDash([4 * dpr, 4 * dpr]); lg.strokeRect(X(r.rect[0]), Y(r.rect[3]), (r.rect[2] - r.rect[0]) * k, (r.rect[3] - r.rect[1]) * k); lg.setLineDash([]); }
      }
      // roads (x y height triples), by width
      lg.lineCap = "round"; lg.lineJoin = "round";
      for (const rd of W.roads.values()) {
        const p = rd.pts; if (p.length < 6) continue;
        let inside = false; for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i] - ox) < R * 1.2 && Math.abs(p[i + 1] - oy) < R * 1.2) { inside = true; break; }
        if (!inside) continue;
        lg.strokeStyle = rd.major ? "#5d6b75" : "#3d4850"; lg.lineWidth = Math.max(1.2 * dpr, rd.w * k);
        lg.beginPath(); lg.moveTo(X(p[0]), Y(p[1])); for (let i = 3; i < p.length; i += 3) lg.lineTo(X(p[i]), Y(p[i + 1])); lg.stroke();
      }
      // buildings: taller ones darker teal (apartment blocks)
      for (const f of W.footprintsIn(ox - R, oy - R, ox + R, oy + R)) {
        const r = f.ring; if (r.length < 6) continue;
        const h = f.top - W.h0;
        lg.fillStyle = h > 30 ? "#2a6a73" : h > 12 ? "#2c4f57" : "#2a3a40";
        lg.beginPath(); lg.moveTo(X(r[0]), Y(r[1])); for (let i = 2; i < r.length; i += 2) lg.lineTo(X(r[i]), Y(r[i + 1])); lg.closePath(); lg.fill();
      }
      // the 법정동 boundaries (faint, dashed)
      lg.strokeStyle = "rgba(232,246,255,0.22)"; lg.lineWidth = dpr; lg.setLineDash([5 * dpr, 4 * dpr]);
      for (const d of dongs) for (const r of d.rings) { lg.beginPath(); r.forEach(([x, y], i) => (i ? lg.lineTo(X(x), Y(y)) : lg.moveTo(X(x), Y(y)))); lg.stroke(); }
      lg.setLineDash([]);
      // the 공동현관
      // (a door mark: an amber tab on the wall, its notch facing out — every 동's way in)
      // (only the major places' doors: every 동's tab and every shop's dot made the map unreadable)
      for (const e of g.entrances) {
        if (!(e.kind === "building" && MAJOR.has(e.category ?? ""))) continue;
        const x = X(e.x), y = Y(e.y); if (x < -8 || y < -8 || x > px + 8 || y > px + 8) continue;
        const s = (near ? 3.6 : 2.8) * dpr;
        lg.save(); lg.translate(x, y); lg.rotate(-e.heading);
        lg.fillStyle = "#ffc857"; lg.strokeStyle = "rgba(6,12,17,0.9)"; lg.lineWidth = 1.2 * dpr;
        lg.beginPath(); lg.moveTo(-s, -s); lg.lineTo(s * 0.6, -s); lg.lineTo(s * 1.5, 0); lg.lineTo(s * 0.6, s); lg.lineTo(-s, s); lg.closePath(); lg.fill(); lg.stroke();
        lg.restore();
      }
      // the names, most important first; a name that would overlap one already placed is left out
      const placed: number[][] = [];
      const label = (text: string, x: number, y: number, size: number, weight: number, fill: string, dot = false) => {
        if (x < -40 * dpr || y < 0 || x > px + 40 * dpr || y > px) return;
        lg.font = `${weight} ${size * dpr}px "Pretendard", "Noto Sans KR", sans-serif`;
        const w = lg.measureText(text).width, h = size * dpr, ty = dot ? y - 4 * dpr : y;
        const box = [x - w / 2 - 2 * dpr, ty - h, x + w / 2 + 2 * dpr, ty + 3 * dpr];
        if (box[0] < 0 || box[2] > px || box[1] < 0 || box[3] > px) return;
        if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
        placed.push(box);
        if (dot) { lg.fillStyle = fill; lg.beginPath(); lg.arc(x, y, 1.8 * dpr, 0, 7); lg.fill(); }
        lg.lineWidth = 3 * dpr; lg.strokeStyle = "rgba(6,12,17,0.85)"; lg.lineJoin = "round";
        lg.strokeText(text, x, ty); lg.fillStyle = fill; lg.fillText(text, x, ty);
      };
      lg.textAlign = "center"; lg.textBaseline = "alphabetic";
      const big = !near ? 1 : 1.12;
      for (const d of dongs) if (Math.abs(d.x - ox) < R && Math.abs(d.y - oy) < R) label(d.name, X(d.x), Y(d.y), 13 * big, 700, "rgba(255,214,120,0.92)");
      // (complex and villa names left off: only the 법정동 and the major places are named)
      void complexes;
      for (const l of [...g.landmarks].sort((a, b) => b.area - a.area)) if (MAJOR.has(categoryOf(l.name)) && Math.abs(l.x - ox) < R && Math.abs(l.y - oy) < R) label(l.name, X(l.x), Y(l.y), 9.5 * big, 500, "#c8d6e0", true);
      for (const e of [...g.entrances].sort((a,b)=>Math.hypot(a.x-ox,a.y-oy)-Math.hypot(b.x-ox,b.y-oy))) {
        const cat=e.kind==="building"?CATEGORY[e.category??"office"]:null;
        if(!cat||!MAJOR.has(e.category??""))continue;
        if(Math.abs(e.x-ox)>R||Math.abs(e.y-oy)>R)continue;
        lg.fillStyle=cat?.color??"#7ff5ff";lg.fillRect(X(e.x)-2*dpr,Y(e.y)-2*dpr,4*dpr,4*dpr);
        label(cat?`${cat.label} ↪ ${e.name}`:e.dong.replace(/동$/,""),X(e.x),Y(e.y)-5*dpr,near?10:9,700,cat?.color??"#7ff5ff");
      }
      at = { x: ox, y: oy }; drawnAt = performance.now();
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = game(); if (!g?.world) return;
      if (!asked) { asked = true; void dongsAround(g).then(d => { dongs = d; drawnAt = 0; }); }
      // (the layer again when the walker has gone 30 m, or every 2 s as tiles and patches arrive)
      if (!(Math.hypot(g.pos.x - at.x, g.pos.y - at.y) < 30 * (near ? 0.5 : 1)) || performance.now() - drawnAt > 2000) draw(g);
      ctx.clearRect(0, 0, px, px);
      // the layer, shifted by how far the walker has gone since it was drawn
      ctx.drawImage(layer, (at.x - g.pos.x) * k, (g.pos.y - at.y) * k);
      // a range ring and the walker's arrow (the frame's heading: x east, y north)
      ctx.strokeStyle = "rgba(94,240,255,0.18)"; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.arc(px / 2, px / 2, (R / 2) * k, 0, 7); ctx.stroke();
      const h = g.heading;
      ctx.save(); ctx.translate(px / 2, px / 2); ctx.rotate(-h + Math.PI / 2);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 34 * dpr); grad.addColorStop(0, "rgba(94,240,255,0.35)"); grad.addColorStop(1, "rgba(94,240,255,0)");
      ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 34 * dpr, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#5ef0ff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(0, -9 * dpr); ctx.lineTo(6 * dpr, 7 * dpr); ctx.lineTo(0, 3 * dpr); ctx.lineTo(-6 * dpr, 7 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      // the nearest 동 entrance: a dashed guide to it and its name and distance
      {
        let best: (typeof g.entrances)[number] | null = null, bd = R;
        for (const e of g.entrances) { const d = Math.hypot(e.x - g.pos.x, e.y - g.pos.y); if (d < bd) { bd = d; best = e; } }
        if (best && bd > 4) {
          const ex = px / 2 + (best.x - g.pos.x) * k, ey = px / 2 - (best.y - g.pos.y) * k;
          ctx.strokeStyle = "rgba(255,200,87,0.85)"; ctx.lineWidth = 1.6 * dpr; ctx.setLineDash([4 * dpr, 3 * dpr]);
          ctx.beginPath(); ctx.moveTo(px / 2, px / 2); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = "#ffc857"; ctx.beginPath(); ctx.arc(ex, ey, 4 * dpr, 0, 7); ctx.fill();
          const text = `${best.kind==="building"?`${CATEGORY[best.category??"office"].label} 입장`:`${best.dong} 입구`} ${Math.round(bd)}m`;
          ctx.font = `700 ${10.5 * dpr}px "Pretendard", "Noto Sans KR", sans-serif`; ctx.textAlign = "center";
          const tx = Math.min(px - 40 * dpr, Math.max(40 * dpr, ex)), ty = Math.min(px - 6 * dpr, Math.max(16 * dpr, ey - 8 * dpr));
          ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "rgba(6,12,17,0.9)"; ctx.strokeText(text, tx, ty); ctx.fillText(text, tx, ty);
        }
      }
      // north
      ctx.fillStyle = "rgba(232,246,255,0.75)"; ctx.font = `${10 * dpr}px sans-serif`; ctx.textAlign = "center"; ctx.fillText("N", px / 2, 12 * dpr);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, near, game]);
  if (!shown) return <button className="wk-map-show wk-btn" onClick={() => setShown(true)}>지도 <kbd>M</kbd></button>;
  return (
    <div className="wk-omap" onClick={() => setNear(n => !n)} title="클릭: 500 m / 250 m · M: 숨기기">
      <canvas ref={cv} style={{ width: SIZE, height: SIZE }} />
      <div className="wk-map-cap">↪ 상가·병원·공공기관·지하철 입장 · {near ? 250 : 500}m <kbd>M</kbd></div>
    </div>
  );
}
