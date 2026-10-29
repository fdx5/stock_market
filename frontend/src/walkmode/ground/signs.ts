import * as THREE from "three";
import type { World } from "../../drivegame/world/World";
import { toLonLat, toFrame, type Origin } from "../../drivegame/world/geo";

/* The shops' own signs: the businesses round the walker (their trading names and kinds, from Kakao
 * Local by our server: /api/realestate/places) each on the street wall of the building it is in —
 * the nearest wall of the footprint at its place — over the ground floor, side by side along that
 * wall, the rest up the floors as window lettering. Each sign its name painted large and sharp on
 * a canvas in its kind's colours (a café's, a clinic's, a bank's…), in a frame; at night lit, with
 * a neon glow round it. Shops and offices' walls only (not on the flats' slabs). Rebuilt when the
 * walker has gone 150 m; at most 90 at a time, the nearest. */

interface Place { name: string; kind: string; category: string | null; lat: number; lon: number; floor?: number | null }
const STYLE: Record<string, { bg: string; fg: string; neon: string }> = {
  food: { bg: "#b3261e", fg: "#fff6e0", neon: "#ff5a3c" }, cafe: { bg: "#2f241c", fg: "#f3e2c4", neon: "#ffb36b" },
  store: { bg: "#0b6e4f", fg: "#ffffff", neon: "#38ffb0" }, pharmacy: { bg: "#ffffff", fg: "#1b8a3a", neon: "#4dff7a" },
  clinic: { bg: "#ffffff", fg: "#1f4fa0", neon: "#5aa0ff" }, academy: { bg: "#ffd23f", fg: "#1a1a1a", neon: "#ffe066" },
  bank: { bg: "#123a73", fg: "#ffffff", neon: "#6fb2ff" }, mart: { bg: "#e8562a", fg: "#ffffff", neon: "#ff8a3d" },
  agent: { bg: "#f2f2f2", fg: "#20304a", neon: "#9fd0ff" }, kids: { bg: "#ff8fb1", fg: "#ffffff", neon: "#ff7ad1" },
  culture: { bg: "#5b2a86", fg: "#ffffff", neon: "#c77dff" }, lodging: { bg: "#3b1f4a", fg: "#ffd1f0", neon: "#ff4fd8" },
  station: { bg: "#1d1d1f", fg: "#ffffff", neon: "#ffffff" }, fuel: { bg: "#d61f26", fg: "#ffffff", neon: "#ff3030" },
};

function inRing(x: number, y: number, r: Float32Array) {
  let hit = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) hit = !hit;
  return hit;
}

/** a soft halo: bright in the middle, fading out to the edges (shared by every sign's glow) */
let halo: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (halo) return halo;
  const c = document.createElement("canvas"); c.width = 256; c.height = 128; const g = c.getContext("2d")!;
  const img = g.createImageData(256, 128);
  for (let j = 0; j < 128; j++) for (let i = 0; i < 256; i++) {
    const dx = Math.max(0, Math.abs(i - 127.5) / 127.5 - 0.62) / 0.38, dy = Math.max(0, Math.abs(j - 63.5) / 63.5 - 0.45) / 0.55, d = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - d, 2.2) * 255, o = (j * 256 + i) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = a;
  }
  g.putImageData(img, 0, 0);
  halo = new THREE.CanvasTexture(c);
  return halo;
}

export class ShopSigns {
  readonly group = new THREE.Group();
  private at: [number, number] | null = null;
  private busy = false;
  private signs: { mesh: THREE.Group; tex: THREE.Texture; mats: THREE.Material[]; geos: THREE.BufferGeometry[]; x: number; y: number }[] = [];
  private night = 0;

  constructor(private world: World, private origin: Origin, private apiBase: string) {}
  setNight(k: number) { this.night = k; for (const s of this.signs) this.light(s); }

  update(x: number, y: number) {
    if (this.busy || (this.at && Math.hypot(x - this.at[0], y - this.at[1]) < 150)) return;
    if (this.world.readiness(x, y, 200) < 0.95) return;
    this.busy = true; this.at = [x, y];
    const [lon, lat] = toLonLat(this.origin, x, y);
    fetch(`${this.apiBase}/realestate/places?${new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), r: "350" })}`)
      .then(r => (r.ok ? r.json() : { items: [] })).then((d: { items?: Place[] }) => this.build(d.items ?? [], x, y)).catch(() => {}).finally(() => { this.busy = false; });
  }

  private build(items: Place[], x: number, y: number) {
    this.clear();
    // each place on its building's nearest street wall
    const used = new Map<string, [number, number][]>();
    const near = items.map(p => { const [px, py] = toFrame(this.origin, p.lon, p.lat); return { p, px, py, d: Math.hypot(px - x, py - y) }; }).filter(o => o.d < 260).sort((a, b) => a.d - b.d).slice(0, 140);
    for (const { p, px, py } of near) {
      if (this.signs.length >= 90) break;
      // (shops' and offices' walls, and any low building's — a 상가 is often registered with its flats)
      const feet = this.world.footprintsIn(px - 18, py - 18, px + 18, py + 18).filter(f => f.style === 2 || f.style === 3 || f.top - (this.world.heightAt(f.ring[0], f.ring[1]) || 0) < 20);
      if (!feet.length) continue;
      // (the footprint it stands in, else the nearest wall within 15 m)
      let best: { f: typeof feet[number]; k: number; t: number; d: number } | null = null;
      for (const f of feet) {
        const r = f.ring, m = r.length / 2, inside = inRing(px, py, r);
        for (let k = 0; k < m; k++) {
          const ax = r[k * 2], ay = r[k * 2 + 1], bx = r[((k + 1) % m) * 2], by = r[((k + 1) % m) * 2 + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          if (l2 < 9) continue;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)), d = Math.hypot(px - ax - dx * t, py - ay - dy * t) - (inside ? 100 : 0);
          if (!best || d < best.d) best = { f, k, t, d };
        }
      }
      if (!best || best.d > 15) continue;
      const r = best.f.ring, m = r.length / 2, k = best.k;
      let ax = r[k * 2], ay = r[k * 2 + 1], bx = r[((k + 1) % m) * 2], by = r[((k + 1) % m) * 2 + 1];
      let area = 0; for (let i = 0; i < m; i++) area += r[i * 2] * r[((i + 1) % m) * 2 + 1] - r[((i + 1) % m) * 2] * r[i * 2 + 1];
      if (area < 0) [ax, ay, bx, by] = [bx, by, ax, ay];
      const len = Math.hypot(bx - ax, by - ay), tx = (bx - ax) / len, ty = (by - ay) / len, ox = ty, oy = -tx;
      // the sign's size from its name, along the wall from where the place is; side by side, then up a floor
      const name = p.name.replace(/\s+/g, " ").slice(0, 16);
      const w = Math.min(len - 0.6, Math.max(2.2, 0.62 * name.length + 1.0)), h = 0.78;
      // (its registered floor: a shop upstairs has its name in its windows there; side by side per floor)
      // (on its wall, each floor's taken spans kept: as near its place as a free span allows, else a floor up)
      const top = best.f.top;
      let floor = p.floor && p.floor >= 2 ? p.floor - 1 : 0, u = -1;
      for (let tries = 0; tries < 6 && u < 0; tries++, floor++) {
        const key = `${best.f.ring[0].toFixed(1)}:${k}:${floor}`, spans = used.get(key) ?? [];
        const want = Math.min(len - w / 2 - 0.3, Math.max(w / 2 + 0.3, best.t * len));
        for (let off = 0; off <= len; off += 0.25) {
          for (const c of off ? [want - off, want + off] : [want]) {
            if (c < w / 2 + 0.3 || c > len - w / 2 - 0.3) continue;
            if (spans.some(([a, b]) => c - w / 2 - 0.25 < b && c + w / 2 + 0.25 > a)) continue;
            u = c; break;
          }
          if (u >= 0) break;
        }
        if (u >= 0) { spans.push([u - w / 2, u + w / 2]); used.set(key, spans); break; }
      }
      if (u < 0) continue;
      const cx = ax + tx * u + ox * 0.09, cy = ay + ty * u + oy * 0.09, g = this.world.heightAt(cx, cy);
      if (!Number.isFinite(g)) continue;
      // (the ground floor's sign over the awnings, 3.5 m up; window lettering a floor up each)
      const z = g + (floor ? 3.05 + floor * 3.3 : 3.5) + h / 2;
      if (z + h / 2 > top - 0.3) continue;
      // (its face out along the wall's outward normal: three's +z turned to (ox, −oy))
      this.add(name, p.kind, cx, cy, z, w, h, Math.atan2(ox, -oy), floor > 0);
    }
  }

  private add(name: string, kind: string, x: number, y: number, z: number, w: number, h: number, yaw: number, window: boolean) {
    const st = STYLE[kind] ?? STYLE.agent;
    // the face: the name as large as fits, sharp (a 1024-wide canvas for up to ~6 m)
    const c = document.createElement("canvas"); c.width = 1024; c.height = Math.round(1024 * h / w); const g2 = c.getContext("2d")!;
    if (!window) { g2.fillStyle = st.bg; g2.fillRect(0, 0, c.width, c.height); }
    else g2.clearRect(0, 0, c.width, c.height);
    let size = c.height * 0.66;
    g2.font = `800 ${size}px Pretendard, 'Noto Sans KR', 'Malgun Gothic', sans-serif`;
    const tw = g2.measureText(name).width; if (tw > c.width * 0.9) { size *= (c.width * 0.9) / tw; g2.font = `800 ${size}px Pretendard, 'Noto Sans KR', 'Malgun Gothic', sans-serif`; }
    g2.textAlign = "center"; g2.textBaseline = "middle";
    if (window) { g2.lineWidth = size * 0.08; g2.strokeStyle = "rgba(0,0,0,0.35)"; g2.strokeText(name, c.width / 2, c.height * 0.54); }
    g2.fillStyle = window ? st.bg === "#ffffff" ? st.fg : st.bg : st.fg; g2.fillText(name, c.width / 2, c.height * 0.54);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const face = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.12, roughness: 0.45, transparent: window, alphaTest: window ? 0.05 : 0 });
    const frameM = new THREE.MeshStandardMaterial({ color: "#2a2d31", roughness: 0.4, metalness: 0.6 });
    const glowM = new THREE.MeshBasicMaterial({ color: st.neon, map: glowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const gp = new THREE.PlaneGeometry(w, h), gb = new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.12), gg = new THREE.PlaneGeometry(w + 1.4, h + 1.0);
    const root = new THREE.Group();
    const faceMesh = new THREE.Mesh(gp, face); faceMesh.position.z = window ? 0.0 : 0.07; root.add(faceMesh);
    if (!window) { const box = new THREE.Mesh(gb, frameM); root.add(box); }
    const glow = new THREE.Mesh(gg, glowM); glow.position.z = 0.02; glow.renderOrder = 3; root.add(glow);
    root.position.set(x, z, -y); root.rotation.y = yaw;
    root.updateMatrixWorld(true); root.matrixAutoUpdate = false;
    this.group.add(root);
    const s = { mesh: root, tex, mats: [face, frameM, glowM], geos: [gp, gb, gg], x, y };
    this.signs.push(s); this.light(s);
  }
  private light(s: ShopSigns["signs"][number]) {
    const [face, , glow] = s.mats as [THREE.MeshStandardMaterial, THREE.Material, THREE.MeshBasicMaterial];
    face.emissiveIntensity = 0.12 + 1.6 * this.night;
    glow.opacity = 0.6 * this.night;
  }
  private clear() {
    for (const s of this.signs) { s.mesh.removeFromParent(); s.tex.dispose(); s.mats.forEach(m => m.dispose()); s.geos.forEach(g => g.dispose()); }
    this.signs = [];
  }
  get count() { return this.signs.length; }
  dispose() { this.clear(); this.group.removeFromParent(); }
}
