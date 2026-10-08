import { useEffect, useRef, useState } from "react";
import type { DroneSigns } from "./droneSigns";

/* The drone's radar (드론 mode, top right): where it is, as a GPS shows it — the map round it
 * (VWorld's 2D map, "midnight" style, Web Mercator tiles), turned so the flight points up, north
 * marked on the rim; the signs round it as dots; range rings; the address under it (VWorld's
 * reverse geocoder: 시·도, 시·군·구, 읍·면·동) and the coordinates. +/− or the wheel (a pinch on a
 * phone) zooms from about 150 m to 40 km across; the button beside them makes it larger. */

export type DroneWhere = { lat: number; lon: number; heading: number; kmh: number; agl: number };

const TILE = 256;
const tiles = new Map<string, ImageBitmap | null | Promise<void>>();
const DOT: Record<string, string> = { gov: "#7fb6ff", major: "#e8eef5", apt: "#ffcf5c", hospital: "#ff8a96", school: "#8fe0b0" };

function tileUrl(key: string, z: number, row: number, col: number) {
  return `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key)}/midnight/${z}/${row}/${col}.png`;
}
function getTile(key: string, z: number, x: number, y: number, redraw: () => void): ImageBitmap | null {
  const k = `${z}/${x}/${y}`, hit = tiles.get(k);
  if (hit instanceof ImageBitmap) { tiles.delete(k); tiles.set(k, hit); return hit; }
  if (hit !== undefined) return null;
  tiles.set(k, fetch(tileUrl(key, z, y, x), { mode: "cors", referrerPolicy: "no-referrer" })
    .then(r => (r.ok && (r.headers.get("content-type") ?? "").startsWith("image") ? r.blob() : null))
    .then(b => (b ? createImageBitmap(b) : null))
    .then(bmp => { tiles.set(k, bmp); redraw(); }, () => { tiles.set(k, null); }));
  // (about a hundred tiles kept: ~25 MB at most, decoded)
  if (tiles.size > 100) for (const [old, v] of tiles) { if (tiles.size <= 80) break; if (v instanceof ImageBitmap) v.close(); tiles.delete(old); }
  return null;
}

let addressSeq = 0;
function reverseGeocode(key: string, domain: string, lat: number, lon: number): Promise<string | null> {
  return new Promise(resolve => {
    const cb = `__droneAddr${++addressSeq}`, s = document.createElement("script");
    const done = (v: string | null) => { delete (window as unknown as Record<string, unknown>)[cb]; s.remove(); resolve(v); };
    (window as unknown as Record<string, unknown>)[cb] = (j: { response?: { status?: string; result?: { structure?: Record<string, string> }[] } }) => {
      const st = j?.response?.status === "OK" ? j.response.result?.[0]?.structure : null;
      done(st ? [st.level1, st.level2, st.level3, st.level4L || st.level4A].filter(Boolean).join(" ") : null);
    };
    s.referrerPolicy = "no-referrer";
    s.src = "https://api.vworld.kr/req/address?" + new URLSearchParams({
      service: "address", request: "getAddress", version: "2.0", crs: "epsg:4326", point: `${lon.toFixed(6)},${lat.toFixed(6)}`,
      format: "json", type: "parcel", zipcode: "false", simple: "false", key, domain, callback: cb,
    });
    s.onerror = () => done(null);
    document.head.appendChild(s);
    window.setTimeout(() => done(null), 8000);
  });
}

export default function DroneRadar({ vkey, domain, where, signs, origin }: {
  vkey: string; domain: string; where: () => DroneWhere | null; signs: DroneSigns;
  /** the view's centre: signs are in metres east / north of it */
  origin: { lat: number; lon: number };
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(15);
  const [big, setBig] = useState(false);
  const [northUp, setNorthUp] = useState(false);
  const [addr, setAddr] = useState<string>("위치 확인 중…");
  const [pos, setPos] = useState<DroneWhere | null>(null);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const northRef = useRef(northUp); northRef.current = northUp;
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const touches = useRef(new Map<number, [number, number]>());

  // The address: again when the drone has gone 150 m, at most every 2.5 s.
  useEffect(() => {
    let last: DroneWhere | null = null, busy = false, alive = true;
    const t = window.setInterval(() => {
      const w = where();
      if (!w || busy) return;
      const kx = Math.cos((w.lat * Math.PI) / 180) * 111320;
      if (last && Math.hypot((w.lon - last.lon) * kx, (w.lat - last.lat) * 110540) < 150) return;
      busy = true; last = w;
      void reverseGeocode(vkey, domain, w.lat, w.lon).then(a => { busy = false; if (alive && a) setAddr(a); });
    }, 2500);
    return () => { alive = false; window.clearInterval(t); };
  }, [vkey, domain, where]);

  // The map, about 15 times a second (it follows the flight; a full frame rate is not needed).
  useEffect(() => {
    let raf = 0, at = 0, hud = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - at < 66) return;
      at = now;
      const c = cv.current, w = where();
      if (!c || !w) return;
      if (now - hud > 250) { hud = now; setPos(w); }
      const css = c.clientWidth, dpr = Math.min(2, window.devicePixelRatio || 1), S = Math.round(css * dpr);
      if (c.width !== S) { c.width = c.height = S; }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const z = zoomRef.current, n = 2 ** z * TILE;
      // the drone in global pixels at this zoom
      const sin = Math.sin((w.lat * Math.PI) / 180);
      const gx = ((w.lon + 180) / 360) * n, gy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n;
      const R = S / 2, scale = dpr * (big ? 1 : 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "#0b1724"; ctx.fillRect(0, 0, S, S);
      ctx.translate(R, R);
      const turn = northRef.current ? 0 : (-w.heading * Math.PI) / 180;
      ctx.rotate(turn);
      // tiles under the circle (its diagonal: turned, the corners come into view)
      const reach = (R * Math.SQRT2) / scale;
      const tx0 = Math.floor((gx - reach) / TILE), tx1 = Math.floor((gx + reach) / TILE);
      const ty0 = Math.floor((gy - reach) / TILE), ty1 = Math.floor((gy + reach) / TILE);
      const redraw = () => { at = 0; };
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        let img = getTile(vkey, z, tx, ty, redraw);
        let sx = 0, sy = 0, sw = TILE, zz = z;
        // (not in yet: the tile from the zoom below, enlarged)
        if (!img && z > 7) {
          const up = getTile(vkey, z - 1, tx >> 1, ty >> 1, redraw);
          if (up) { img = up; sx = (tx & 1) * 128; sy = (ty & 1) * 128; sw = 128; zz = z - 1; }
        }
        void zz;
        if (img) ctx.drawImage(img, sx, sy, sw, sw, (tx * TILE - gx) * scale, (ty * TILE - gy) * scale, TILE * scale + 0.5, TILE * scale + 0.5);
      }
      // metres per CSS pixel here
      const mpp = (40075016.7 * Math.cos((w.lat * Math.PI) / 180)) / n;
      // the signs round it
      const kx = Math.cos((origin.lat * Math.PI) / 180) * 111320;
      const dxo = (w.lon - origin.lon) * kx, dyo = (w.lat - origin.lat) * 110540;
      for (const s of signs.all()) {
        const px = ((s.x - dxo) / mpp) * scale, py = (-(s.y - dyo) / mpp) * scale;
        if (Math.hypot(px, py) > R * 1.5) continue;
        ctx.fillStyle = DOT[s.kind] ?? "#fff";
        ctx.beginPath(); ctx.arc(px, py, (s.kind === "gov" ? 3.2 : 2.4) * dpr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.rotate(-turn);
      // range rings: a round distance about a third of the radius
      const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      const ring = steps.find(m => (m / mpp) * scale > R * 0.3) ?? steps[steps.length - 1];
      ctx.strokeStyle = "rgba(120,220,255,0.35)"; ctx.lineWidth = dpr;
      for (const k of [1, 2]) { ctx.beginPath(); ctx.arc(0, 0, (ring * k / mpp) * scale, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = "rgba(160,230,255,0.85)"; ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`; ctx.textAlign = "left";
      ctx.fillText(ring >= 1000 ? `${ring / 1000}km` : `${ring}m`, (ring / mpp) * scale * 0.72 + 3 * dpr, -(ring / mpp) * scale * 0.72);
      // the drone: an arrow along its flight
      ctx.rotate(northRef.current ? (w.heading * Math.PI) / 180 : 0);
      ctx.fillStyle = "#ff8a3d"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(0, -11 * dpr); ctx.lineTo(7 * dpr, 8 * dpr); ctx.lineTo(0, 4 * dpr); ctx.lineTo(-7 * dpr, 8 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      // north on the rim
      const na = turn - Math.PI / 2;
      ctx.fillStyle = "#ff5a5a"; ctx.font = `800 ${12 * dpr}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("N", R + Math.cos(na) * (R - 11 * dpr), R + Math.sin(na) * (R - 11 * dpr));
      ctx.strokeStyle = "rgba(120,220,255,0.6)"; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(R, R, R - dpr, 0, Math.PI * 2); ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [vkey, where, signs, origin, big]);

  const zoomBy = (d: number) => setZoom(z => Math.max(7, Math.min(18, z + d)));
  return (
    <div className={`re-drone-radar${big ? " is-big" : ""}`}>
      <canvas ref={cv} aria-label="레이더 지도"
        onWheel={e => { e.stopPropagation(); zoomBy(e.deltaY < 0 ? 1 : -1); }}
        onPointerDown={e => { e.stopPropagation(); touches.current.set(e.pointerId, [e.clientX, e.clientY]); if (touches.current.size === 2) { const [a, b] = [...touches.current.values()]; pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoomRef.current }; } }}
        onPointerMove={e => {
          e.stopPropagation();
          if (!touches.current.has(e.pointerId)) return;
          touches.current.set(e.pointerId, [e.clientX, e.clientY]);
          if (pinch.current && touches.current.size === 2) { const [a, b] = [...touches.current.values()]; const z = Math.round(pinch.current.z + Math.log2(Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.current.d)); setZoom(Math.max(7, Math.min(18, z))); }
        }}
        onPointerUp={e => { touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null; }}
        onPointerCancel={e => { touches.current.delete(e.pointerId); pinch.current = null; }} />
      <div className="re-drone-radar-tools">
        <button type="button" onClick={() => zoomBy(1)} aria-label="레이더 확대" title="확대">+</button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="레이더 축소" title="축소">−</button>
        <button type="button" onClick={() => setNorthUp(v => !v)} aria-pressed={northUp} title={northUp ? "진행 방향을 위로" : "북쪽을 위로"}>{northUp ? "N↑" : "⬆"}</button>
        <button type="button" onClick={() => setBig(v => !v)} aria-pressed={big} title={big ? "레이더 작게" : "레이더 크게"}>{big ? "⤡" : "⤢"}</button>
      </div>
      <div className="re-drone-radar-where">
        <b>📍 {addr}</b>
        {pos && <span>{`N${pos.lat.toFixed(5)} E${pos.lon.toFixed(5)} · 지면 ${Math.round(pos.agl)}m`}</span>}
      </div>
    </div>
  );
}
