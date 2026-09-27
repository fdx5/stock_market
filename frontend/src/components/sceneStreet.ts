import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RealEstateRoad } from "../api/client";
import type { Lamp } from "./complexScene";
import { rng } from "./complexScene";

/* The street: lamps on the surveyed major roads, and traffic driving both ways on
 * them. Cars, vans and box trucks are Kenney's CC0 Car Kit (packed by type into
 * /3d/vehicles.bin), scaled to real dimensions; city buses, cargo and container
 * trucks are modelled here in the same plain style. Footprint frame (x east, y north) maps to world (x, -z). */

// ---------- Lamps ----------

export function buildLamps(lamps: Lamp[]) {
  const posts: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [], halos: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.08, 0.13, 9, 6).toNonIndexed(); pole.translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(0.1, 0.1, 1.9).toNonIndexed(); arm.translate(0, 8.9, 0.9);
  const head = new THREE.BoxGeometry(0.34, 0.14, 0.7).toNonIndexed(); head.translate(0, 8.82, 1.85);
  const halo = new THREE.SphereGeometry(0.9, 10, 6).toNonIndexed(); halo.translate(0, 8.55, 1.85);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const l of lamps) {
    // Arm (+z of the model) reaches over the road: world direction (dx, 0, -dy).
    q.setFromAxisAngle(up, Math.atan2(l.dx, -l.dy));
    m.compose(new THREE.Vector3(l.x, 0, -l.y), q, one);
    posts.push(pole.clone().applyMatrix4(m), arm.clone().applyMatrix4(m));
    heads.push(head.clone().applyMatrix4(m));
    halos.push(halo.clone().applyMatrix4(m));
  }
  [pole, arm, head, halo].forEach(g => g.dispose());
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: "#5b6168", roughness: 0.5, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: "#e9e4da", emissive: "#ffd29a", emissiveIntensity: 0, roughness: 0.35 });
  // A soft glow around each head, shown only while the lamps are on.
  const haloMat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffcf93", emissiveIntensity: 0, transparent: true, opacity: 0.28, depthWrite: false, roughness: 1 });
  const disposables: { dispose(): void }[] = [postMat, headMat, haloMat];
  let haloMesh: THREE.Mesh | null = null;
  if (lamps.length) {
    for (const [list, mat, shadow] of [[posts, postMat, true], [heads, headMat, false], [halos, haloMat, false]] as const) {
      const geo = mergeGeometries(list as THREE.BufferGeometry[], false)!;
      (list as THREE.BufferGeometry[]).forEach(g => g.dispose());
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = !!shadow;
      if (mat === haloMat) { mesh.renderOrder = 2; mesh.visible = false; haloMesh = mesh; }
      group.add(mesh);
      disposables.push(geo);
    }
  }
  return {
    group,
    /** 0 by day, ~1.6 at night (Look.lamps). */
    setLevel(level: number) {
      headMat.emissiveIntensity = level * 9;
      haloMat.emissiveIntensity = level * 2.2;
      if (haloMesh) haloMesh.visible = level > 0.25;
    },
    dispose: () => disposables.forEach(d => d.dispose()),
  };
}

// ---------- Traffic ----------

interface Pack { types: { name: string; verts: number; index: number; offset: number; min: number[]; max: number[] }[] }
let kit: Promise<{ geos: Map<string, THREE.BufferGeometry>; texture: THREE.Texture }> | null = null;

/** Real-world length, width, height (m) the Kenney models are scaled to. */
const DIMS: Record<string, [number, number, number]> = {
  sedan: [4.8, 1.85, 1.45], suv: [4.8, 1.92, 1.75], "hatchback-sports": [4.2, 1.8, 1.42], van: [5.1, 1.95, 1.95],
  taxi: [4.8, 1.85, 1.55], delivery: [6.2, 2.0, 2.6], truck: [7.2, 2.3, 2.7],
  "sedan-sports": [4.7, 1.85, 1.35], "suv-luxury": [5.0, 1.98, 1.8],
};

function loadKit() {
  kit ??= Promise.all([
    fetch("/3d/vehicles.json").then(r => { if (!r.ok) throw new Error("vehicles.json " + r.status); return r.json() as Promise<Pack>; }),
    fetch("/3d/vehicles.bin").then(r => { if (!r.ok) throw new Error("vehicles.bin " + r.status); return r.arrayBuffer(); }),
    new THREE.TextureLoader().loadAsync("/3d/vehicles.png"),
  ]).then(([pack, bin, texture]) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter; // flat colour swatches
    texture.flipY = false; // glTF uv convention
    const geos = new Map<string, THREE.BufferGeometry>();
    for (const t of pack.types) {
      let o = t.offset;
      const qp = new Int16Array(bin, o, t.verts * 3); o += t.verts * 6;
      const qn = new Int8Array(bin, o, t.verts * 3); o += t.verts * 3; o += o % 2;
      const qu = new Uint16Array(bin, o, t.verts * 2); o += t.verts * 4;
      const idx = new Uint16Array(bin, o, t.index);
      const [L, W, H] = DIMS[t.name] ?? [4.5, 1.8, 1.5];
      const ext = t.max.map((v, i) => v - t.min[i]);
      // Kenney: x across, y up, z along (front +z). Scale each axis to the real size,
      // wheels on the ground, centred on the car.
      const sx = W / ext[0], sy = H / ext[1], sz = L / ext[2];
      const pos = new Float32Array(t.verts * 3), nor = new Float32Array(t.verts * 3), uv = new Float32Array(t.verts * 2);
      for (let i = 0; i < t.verts; i++) {
        const deq = (k: number) => t.min[k] + ((qp[i * 3 + k] + 32767) / 65534) * ext[k];
        pos[i * 3] = (deq(0) - (t.min[0] + ext[0] / 2)) * sx;
        pos[i * 3 + 1] = (deq(1) - t.min[1]) * sy;
        pos[i * 3 + 2] = (deq(2) - (t.min[2] + ext[2] / 2)) * sz;
        const n = new THREE.Vector3(qn[i * 3] / sx, qn[i * 3 + 1] / sy, qn[i * 3 + 2] / sz).normalize();
        nor.set([n.x, n.y, n.z], i * 3);
        uv[i * 2] = qu[i * 2] / 65535; uv[i * 2 + 1] = qu[i * 2 + 1] / 65535;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
      geos.set(t.name, g.toNonIndexed());
      g.dispose();
    }
    return { geos, texture };
  });
  kit.catch(() => { kit = null; });
  return kit;
}

/** Plain boxes with vertex colours: body, glazing band, roof, chassis. */
function boxes(parts: [w: number, h: number, l: number, x: number, y: number, z: number, color: string][]) {
  const list = parts.map(([w, h, l, x, y, z, color]) => {
    const g = new THREE.BoxGeometry(w, h, l).toNonIndexed();
    g.translate(x, y, z);
    const c = new THREE.Color(color), n = g.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    return g;
  });
  const out = mergeGeometries(list, false)!;
  list.forEach(g => g.dispose());
  return out;
}
const wheels = (w: number, axles: number[]) =>
  axles.flatMap(z => [-1, 1].map(s => [0.3, 1.0, 1.0, (s * w) / 2 - s * 0.12, 0.5, z, "#1d1f22"] as [number, number, number, number, number, number, string]));

function busGeometry(body: string) {
  // Korean city bus: 11 m, glazing band, white roof, low floor.
  return boxes([
    [2.5, 2.3, 11, 0, 1.5, 0, body], [2.52, 1.0, 10.2, 0, 2.05, -0.1, "#20303c"], [2.52, 1.4, 0.06, 0, 2.0, 5.5, "#20303c"],
    [2.42, 0.25, 10.8, 0, 2.78, 0, "#f1f1ee"], ...wheels(2.5, [3.6, -3.4]),
  ]);
}
function containerGeometry(box: string) {
  // Tractor unit and a 40 ft container on its chassis.
  return boxes([
    [2.45, 2.5, 2.4, 0, 1.95, 6.9, "#e8e6e1"], [2.47, 0.8, 0.06, 0, 2.5, 8.1, "#22303a"], [1.2, 0.3, 14.5, 0, 0.9, 0, "#2b2d30"],
    [2.44, 2.6, 12.2, 0, 2.35, -1.1, box], ...wheels(2.45, [7.2, 5.6, -5.4, -6.6]),
  ]);
}
function cargoGeometry(cab: string) {
  // Korean 1-ton cargo truck: cab-over front, open bed with low drop sides.
  return boxes([
    [1.75, 1.35, 1.6, 0, 1.25, 1.75, cab], [1.77, 0.55, 0.06, 0, 1.55, 2.56, "#22303a"], [1.4, 0.25, 5.0, 0, 0.62, 0, "#2b2d30"],
    [1.8, 0.1, 3.1, 0, 0.8, -0.85, "#8d9196"], [0.06, 0.42, 3.1, -0.87, 1.05, -0.85, "#b9bdc2"], [0.06, 0.42, 3.1, 0.87, 1.05, -0.85, "#b9bdc2"],
    [1.8, 0.42, 0.06, 0, 1.05, -2.4, "#b9bdc2"], ...wheels(1.75, [1.6, -1.6]),
  ]);
}

/** Head and tail lamps for a vehicle of length L, width W at height y: two warm white
 * lamps at the front (+z), two red at the back. uv.x picks white (0) or red (1) from
 * the emissive map, so one material and one draw per vehicle type. */
function lampGeometry(L: number, W: number, y: number) {
  const list: THREE.BufferGeometry[] = [];
  for (const [z, u] of [[L / 2 + 0.03, 0.02], [-L / 2 - 0.03, 0.98]] as const) for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.34, 0.16, 0.06).toNonIndexed();
    g.translate(s * (W / 2 - 0.32), y, z);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, 0.5);
    list.push(g);
  }
  const out = mergeGeometries(list, false)!;
  list.forEach(g => g.dispose());
  return out;
}
let lampTexture: THREE.DataTexture | null = null;
function lampMap() {
  if (lampTexture) return lampTexture;
  // 64 x 1: warm white on the left half, tail-light red on the right (mips stay pure).
  const data = new Uint8Array(64 * 4);
  for (let i = 0; i < 64; i++) data.set(i < 32 ? [255, 236, 200, 255] : [255, 28, 22, 255], i * 4);
  lampTexture = new THREE.DataTexture(data, 64, 1);
  lampTexture.colorSpace = THREE.SRGBColorSpace;
  lampTexture.needsUpdate = true;
  return lampTexture;
}

interface Link { road: number; forward: boolean; s0: number }
type Turn = "straight" | "left" | "right" | "uturn";
/** The drive from the end of one road onto the next: a cubic curve from the stop
 * line in this lane to the entry of the chosen lane, sampled by arc length. */
interface Conn {
  key: string; fromKey: string; toKey: string; link: Link; turn: Turn; lane: number;
  /** Where it leaves this road and joins the next (travel coordinates), its length. */
  endS: number; startS: number; len: number;
  /** Signalled node, its approach key; T-junction mouth (yield to the through road). */
  node: number; approach: string; tJoin: boolean;
  xs: Float32Array; ys: Float32Array; cum: Float32Array;
}
interface Car {
  road: number; forward: boolean; lane: number; s: number; type: number; slot: number;
  /** World position and heading last placed (footprint frame), width, id. */
  x: number; y: number; hx: number; hy: number; width: number; id: number;
  /** Current and cruising speed (m/s); length (m). */
  speed: number; cruise: number; length: number;
  /** The planned drive onto the next road (a turn, straight on, or a U-turn where the
   * surveyed roads end), whether it is on it now and how far along. */
  conn: Conn; inConn: boolean; u: number;
  /** Cleared to cross the stop line (the light and the exit allowed it). */
  go: boolean;
  /** Just out of an intersection: its rear still inside that box. */
  arrive: { node: number; startS: number; approach: string } | null;
  /** What holds it, for inspection. */
  why?: string;
}

/** Traffic both ways on the surveyed roads. Mostly cars (seven kinds); taxis, vans,
 * delivery, box and cargo trucks, city buses in three liveries and container trucks.
 * Right-hand traffic on the registered lanes, car following, signals at intersections;
 * lamps lit at night. */
export async function buildTraffic(roads: RealEstateRoad[], seed: number, hq: boolean) {
  const usable = roads.filter(r => r.line.length > 1);
  if (!usable.length) return null;
  const { geos, texture } = await loadKit();
  const rnd = rng(seed + 29);
  // Road polylines with cumulative lengths.
  const paths = usable.map(r => {
    const cum = [0];
    for (let i = 1; i < r.line.length; i++) cum.push(cum[i - 1] + Math.hypot(r.line[i][0] - r.line[i - 1][0], r.line[i][1] - r.line[i - 1][1]));
    return { ...r, cum, len: cum[cum.length - 1] };
  }).filter(p => p.len > 10);
  if (!paths.length) return null;

  const bodyMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.25 });
  const boxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
  const lampMat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: lampMap(), emissiveIntensity: 0, roughness: 0.3 });
  const kit = (name: string) => geos.get(name)!;
  // [geometry, material, weight, speed factor, length, width, lamp height, repaint]
  const K = (geo: THREE.BufferGeometry, mat: THREE.Material, weight: number, speed: number, dims: [number, number, number], paint = false) =>
    ({ geo, mat, weight, speed, dims, paint, own: mat === boxMat });
  const d = (n: string) => DIMS[n];
  // Mix: passenger cars about 70 %; then trucks, buses and containers.
  const kinds = [
    K(kit("sedan"), bodyMat, 17, 1, [d("sedan")[0], d("sedan")[1], 0.62], true),
    K(kit("sedan-sports"), bodyMat, 6, 1.08, [d("sedan-sports")[0], d("sedan-sports")[1], 0.55], true),
    K(kit("suv"), bodyMat, 12, 1, [d("suv")[0], d("suv")[1], 0.75], true),
    K(kit("suv-luxury"), bodyMat, 6, 1, [d("suv-luxury")[0], d("suv-luxury")[1], 0.75], true),
    K(kit("hatchback-sports"), bodyMat, 7, 1.04, [d("hatchback-sports")[0], d("hatchback-sports")[1], 0.6], true),
    K(kit("taxi"), bodyMat, 10, 1, [d("taxi")[0], d("taxi")[1], 0.62]),
    K(kit("van"), bodyMat, 5, 0.95, [d("van")[0], d("van")[1], 0.75], true),
    K(kit("delivery"), bodyMat, 4, 0.9, [d("delivery")[0], d("delivery")[1], 0.8]),
    K(kit("truck"), bodyMat, 4, 0.85, [d("truck")[0], d("truck")[1], 0.85]),
    K(cargoGeometry("#2d5fa8"), boxMat, 4, 0.9, [5.1, 1.75, 0.75]),
    K(cargoGeometry("#e9e9e6"), boxMat, 2, 0.9, [5.1, 1.75, 0.75]),
    K(busGeometry("#2a6fc4"), boxMat, 2.5, 0.8, [11, 2.5, 0.75]),   // 간선 blue
    K(busGeometry("#3b9a44"), boxMat, 2.5, 0.8, [11, 2.5, 0.75]),   // 지선 green
    K(busGeometry("#c8322f"), boxMat, 1.5, 0.85, [11, 2.5, 0.75]),  // 광역 red
    K(containerGeometry("#b2402f"), boxMat, 1.4, 0.8, [16.2, 2.45, 0.85]),
    K(containerGeometry("#2e5e8c"), boxMat, 1.4, 0.8, [16.2, 2.45, 0.85]),
    K(containerGeometry("#c77a2a"), boxMat, 1.2, 0.8, [16.2, 2.45, 0.85]),
  ].filter(k => k.geo);
  const totalW = kinds.reduce((s, k) => s + k.weight, 0);
  const pickKind = () => { let r = rnd() * totalW; for (let i = 0; i < kinds.length; i++) { r -= kinds[i].weight; if (r <= 0) return i; } return 0; };

  // ---- The network: nodes where road ends meet, T-junctions, signals ----
  // Lanes per direction: the registered count split both ways, but only as many as
  // fit at 3 m or wider (some registered counts exceed what the width allows).
  const lanesOf = (road: number) => { const p = paths[road]; return Math.max(1, Math.min(Math.floor(Math.max(2, p.lanes) / 2), Math.floor(p.width / 2 / 3))); };
  const laneWidth = (road: number) => Math.max(3, paths[road].width / 2 / lanesOf(road));
  /** Point at centreline distance d along a road, and the forward unit direction there. */
  const at = (p: (typeof paths)[number], d: number) => {
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < d) i++;
    const [ax, ay] = p.line[i - 1], [bx, by] = p.line[i];
    const seg = p.cum[i] - p.cum[i - 1] || 1, t = Math.min(1, Math.max(0, (d - p.cum[i - 1]) / seg));
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, ux: (bx - ax) / seg, uy: (by - ay) / seg };
  };
  /** Unit heading of travel at the end a vehicle is driving towards. */
  const headingIn = (road: number, forward: boolean) => {
    const p = paths[road], a = at(p, forward ? p.len : 0);
    return forward ? [a.ux, a.uy] : [-a.ux, -a.uy];
  };
  // Nodes: road ends within 6 m of each other. `${road}:${atStart}` names a road end.
  const nodes: { x: number; y: number; ends: { road: number; atStart: boolean }[] }[] = [];
  const nodeOf = new Map<string, number>();
  paths.forEach((p, road) => {
    for (const atStart of [true, false]) {
      const [x, y] = atStart ? p.line[0] : p.line[p.line.length - 1];
      let n = nodes.findIndex(o => Math.hypot(o.x - x, o.y - y) < 6);
      if (n < 0) { n = nodes.length; nodes.push({ x, y, ends: [] }); }
      nodes[n].ends.push({ road, atStart });
      nodeOf.set(`${road}:${atStart}`, n);
    }
  });
  // Intersections. Surveyed centrelines split one real intersection into several nodes
  // (split carriageways, offset road ends) joined by short stubs. Nodes where three or
  // more road ends meet, within 35 m of each other or joined by a stub under 40 m, form
  // one intersection; the stubs are inside it and carry no queue. Traffic enters from
  // the roads outside (approaches) and leaves by the others (exits).
  const junction = nodes.map(n => n.ends.length >= 3);
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  nodes.forEach((a, i) => nodes.forEach((b, j) => {
    if (j > i && junction[i] && junction[j] && Math.hypot(a.x - b.x, a.y - b.y) < 35) parent[find(i)] = find(j);
  }));
  paths.forEach((p, r) => {
    const a = nodeOf.get(`${r}:true`)!, b = nodeOf.get(`${r}:false`)!;
    if (junction[a] && junction[b] && p.len < 40) parent[find(a)] = find(b);
  });
  const clusterIds = new Map<number, number>();
  const clusterOf = nodes.map((_, i) => {
    if (!junction[i]) return -1;
    const root = find(i);
    if (!clusterIds.has(root)) clusterIds.set(root, clusterIds.size);
    return clusterIds.get(root)!;
  });
  const clusters = [...clusterIds.keys()].map(() => ({ nodes: [] as number[], x: 0, y: 0, r: 0 }));
  clusterOf.forEach((c, i) => { if (c >= 0) clusters[c].nodes.push(i); });
  for (const c of clusters) {
    c.x = c.nodes.reduce((s, i) => s + nodes[i].x, 0) / c.nodes.length;
    c.y = c.nodes.reduce((s, i) => s + nodes[i].y, 0) / c.nodes.length;
    c.r = Math.max(0, ...c.nodes.map(i => Math.hypot(nodes[i].x - c.x, nodes[i].y - c.y)));
  }
  const endCluster = (road: number, atStart: boolean) => clusterOf[nodeOf.get(`${road}:${atStart}`)!];
  const internal = paths.map((_, r) => { const a = endCluster(r, true); return a >= 0 && a === endCluster(r, false); });
  /** Road ends outside roads have at an intersection: [road, atStart]. */
  const clusterEnds = clusters.map((c, ci) => c.nodes.flatMap(ni => nodes[ni].ends.filter(e => !internal[e.road])).filter(e => endCluster(e.road, e.atStart) === ci));

  /** Ways on from the end of `road` in direction `forward`, with how straight each is. */
  const linkCache = new Map<string, { link: Link; dot: number }[]>();
  const linksFrom = (road: number, forward: boolean) => {
    const key = `${road}:${forward}`;
    if (linkCache.has(key)) return linkCache.get(key)!;
    const [hx, hy] = headingIn(road, forward);
    const out: { link: Link; dot: number }[] = [];
    const ni = nodeOf.get(`${road}:${!forward}`)!, node = nodes[ni], ci = clusterOf[ni];
    // At an intersection: straight across to any other road leaving it.
    const candidates = ci >= 0 && !internal[road] ? clusterEnds[ci] : node.ends;
    for (const e of candidates) {
      if (e.road === road || internal[e.road]) continue;
      const p = paths[e.road], a = at(p, e.atStart ? 0 : p.len);
      const ux = e.atStart ? a.ux : -a.ux, uy = e.atStart ? a.uy : -a.uy;
      out.push({ link: { road: e.road, forward: e.atStart, s0: 0 }, dot: ux * hx + uy * hy });
    }
    if (node.ends.length === 1) {
      // A T-junction: this road ends part way along another.
      const { x: ex, y: ey } = at(paths[road], forward ? paths[road].len : 0);
      for (let r = 0; r < paths.length; r++) {
        if (r === road || internal[r]) continue;
        const p = paths[r];
        for (let i = 1; i < p.line.length; i++) {
          const [ax, ay] = p.line[i - 1], [bx, by] = p.line[i], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
          const t = Math.max(0, Math.min(1, ((ex - ax) * dx + (ey - ay) * dy) / (l * l)));
          if (Math.hypot(ax + dx * t - ex, ay + dy * t - ey) > 5) continue;
          const d = p.cum[i - 1] + t * l, ux = dx / l, uy = dy / l;
          if (d < p.len - 3) out.push({ link: { road: r, forward: true, s0: d }, dot: ux * hx + uy * hy });
          if (d > 3) out.push({ link: { road: r, forward: false, s0: p.len - d }, dot: -(ux * hx + uy * hy) });
          break;
        }
      }
    }
    const usable = out.filter(o => o.dot > -0.35); // no reversing into the road just left
    linkCache.set(key, usable);
    return usable;
  };
  const laneKey = (road: number, forward: boolean, lane: number) => `${road}|${forward}|${Math.min(lane, lanesOf(road) - 1)}`;
  /** Point and travel heading at distance s (travel coordinates) in a lane. */
  const lanePt = (road: number, forward: boolean, s: number, lane: number) => {
    const p = paths[road], pt = at(p, forward ? s : p.len - s);
    const hx = forward ? pt.ux : -pt.ux, hy = forward ? pt.uy : -pt.uy;
    // Right-hand traffic: lanes to the right of the direction of travel.
    const off = (Math.min(lane, lanesOf(road) - 1) + 0.5) * laneWidth(road);
    return { x: pt.x + hy * off, y: pt.y - hx * off, hx, hy };
  };
  const turnOf = (road: number, forward: boolean, link: Link): Turn => {
    if (link.road === road && link.forward !== forward) return "uturn";
    const [hx, hy] = headingIn(road, forward);
    const o = lanePt(link.road, link.forward, link.s0, 0);
    const dot = hx * o.hx + hy * o.hy, cross = hx * o.hy - hy * o.hx;
    return dot > 0.7 ? "straight" : cross > 0 ? "left" : "right";
  };
  // Roads with nowhere to go at either end (fragments at the edge of the data), short
  // dead-end stubs, and the stubs inside intersections carry no traffic of their own.
  // (Repeated: a road whose only ways on lead into idle roads is a dead end too.)
  const idle = paths.map((_, r) => internal[r]);
  for (let pass = 0; pass < 6; pass++) {
    const deadEnd = (road: number, forward: boolean) => linksFrom(road, forward).every(o => idle[o.link.road]);
    let changed = false;
    paths.forEach((p, r) => {
      const now = (deadEnd(r, true) && deadEnd(r, false)) || ((deadEnd(r, true) || deadEnd(r, false)) && p.len < 60);
      if (now && !idle[r]) { idle[r] = true; changed = true; }
    });
    if (!changed) break;
  }
  /** Mostly straight on, sometimes a turn, from the lane that allows it (1차로 좌회전,
   * 끝 차로 우회전); where the surveyed roads end, a U-turn. */
  const choose = (road: number, forward: boolean, lane: number): Link => {
    let opts = linksFrom(road, forward).filter(o => !idle[o.link.road]);
    if (!opts.length) return { road, forward: !forward, s0: 0 };
    const n = lanesOf(road);
    if (n > 1) {
      const ok = opts.filter(o => {
        const t = turnOf(road, forward, o.link);
        return t === "straight" || (t === "left" && lane === 0) || (t === "right" && lane === n - 1);
      });
      if (ok.length) opts = ok;
    }
    const w = opts.map(o => Math.exp(3 * o.dot)), total = w.reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i].link; }
    return opts[0].link;
  };

  // Where traffic stops on each approach (nothing is painted): walking back out of the
  // intersection, the first point where both edges of the road are 2 m clear of the
  // asphalt of every road crossing it there — the stubs inside included; roads running
  // parallel (the continuation, the other carriageway) don't count. The same distance
  // is where traffic leaving by that road rejoins its lane.
  const CLEAR = 2;
  const distToRoad = (x: number, y: number, o: (typeof paths)[number]) => {
    let best = Infinity;
    for (let i = 1; i < o.line.length; i++) {
      const [ax, ay] = o.line[i - 1], [bx, by] = o.line[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
    }
    return best;
  };
  const trimAt = new Map<string, number>();
  clusters.forEach((c, ci) => {
    for (const e of clusterEnds[ci]) {
      const p = paths[e.road], [hx, hy] = headingIn(e.road, !e.atStart);
      const crossing = paths.filter((o, r) => {
        if (r === e.road || distToRoad(c.x, c.y, o) > c.r + 25) return false;
        let dir = [0, 0], dmin = Infinity;
        for (let i = 1; i < o.line.length; i++) {
          const [ax, ay] = o.line[i - 1], [bx, by] = o.line[i], d = Math.hypot((ax + bx) / 2 - c.x, (ay + by) / 2 - c.y);
          if (d < dmin) { dmin = d; const l = Math.hypot(bx - ax, by - ay) || 1; dir = [(bx - ax) / l, (by - ay) / l]; }
        }
        return Math.abs(dir[0] * hx + dir[1] * hy) < 0.85;
      });
      // Leave room to queue: half the block when another intersection is at its far end,
      // else all but 12 m (a queue can't reach back onto the road before).
      const far = endCluster(e.road, !e.atStart);
      const limit = far >= 0 ? p.len * 0.45 : Math.max(3, p.len - 12);
      let d = 3;
      for (; d < limit; d += 0.5) {
        const pt = at(p, e.atStart ? d : p.len - d), rx = hy, ry = -hx, w = p.width / 2;
        if (crossing.every(o => [-w, 0, w].every(k => distToRoad(pt.x + rx * k, pt.y + ry * k, o) > o.width / 2 + CLEAR))) break;
      }
      trimAt.set(`${e.road}:${e.atStart}`, Math.min(d, limit));
    }
  });
  const trim = (road: number, atStart: boolean) => trimAt.get(`${road}:${atStart}`) ?? 1.5;
  // Korean 방향별 신호: each approach direction in turn (clockwise) gets green with the
  // left arrow, then yellow, then all-red, while every other direction is red. Roads
  // arriving from about the same direction share a phase: at most four phases.
  const G = 9, Y = 3, AR = 2, P = G + Y + AR;
  const signals = clusters.map((_, ci) => {
    const ends = clusterEnds[ci];
    if (ends.length < 3) return null;
    const ang = (e: { road: number; atStart: boolean }) => { const [hx, hy] = headingIn(e.road, !e.atStart); return Math.atan2(hy, hx); };
    const groups: { a: number; keys: string[] }[] = [];
    for (const e of [...ends].sort((a, b) => ang(b) - ang(a))) {
      const a = ang(e), g = groups.find(o => Math.abs(Math.atan2(Math.sin(a - o.a), Math.cos(a - o.a))) < 0.7);
      if (g) g.keys.push(`${e.road}:${e.atStart}`); else groups.push({ a, keys: [`${e.road}:${e.atStart}`] });
    }
    while (groups.length > 4) { const g = groups.pop()!; groups[groups.length - 1].keys.push(...g.keys); }
    const phase = new Map<string, number>();
    groups.forEach((g, i) => g.keys.forEach(k => phase.set(k, i)));
    return { phase, phases: groups.length, offset: rnd() * P * groups.length };
  });
  let clock = 0;
  type Light = "green" | "yellow" | "red";
  /** The light shown to traffic arriving at road end `key` (`${road}:${atStart}`). */
  const lightAt = (ci: number, key: string): Light => {
    const sg = signals[ci];
    if (!sg) return "green";
    const t = (clock + sg.offset) % (P * sg.phases), i = Math.floor(t / P), w = t - i * P;
    if (sg.phase.get(key) !== i) return "red";
    return w < G ? "green" : w < G + Y ? "yellow" : "red";
  };

  const connCache = new Map<string, Conn>();
  const connector = (road: number, forward: boolean, lane: number, link: Link): Conn => {
    const turn = turnOf(road, forward, link);
    const nl = lanesOf(link.road);
    const nextLane = turn === "left" || turn === "uturn" ? 0 : turn === "right" ? nl - 1 : Math.min(lane, nl - 1);
    const key = `${road}|${forward}|${lane}>${link.road}|${link.forward}|${link.s0.toFixed(1)}|${nextLane}`;
    const hit = connCache.get(key);
    if (hit) return hit;
    const ci = endCluster(road, !forward), sig = ci >= 0 && signals[ci] !== null, tJoin = link.s0 > 0;
    const endTrim = ci >= 0 ? trim(road, !forward) : tJoin ? paths[link.road].width / 2 + 1.5 : turn === "uturn" ? 2 : 1.5;
    const startTrim = ci >= 0 ? trim(link.road, link.forward) : tJoin ? paths[road].width / 2 + 1.5 : turn === "uturn" ? 2 : 1.5;
    const endS = paths[road].len - endTrim, startS = Math.min(paths[link.road].len - 1, link.s0 + startTrim);
    const a = lanePt(road, forward, endS, lane), b = lanePt(link.road, link.forward, startS, nextLane);
    const dist = Math.hypot(b.x - a.x, b.y - a.y), k = turn === "uturn" ? Math.max(3.5, dist) : Math.max(1, dist * 0.42);
    const p1 = [a.x + a.hx * k, a.y + a.hy * k], p2 = [b.x - b.hx * k, b.y - b.hy * k];
    const N = 24, xs = new Float32Array(N + 1), ys = new Float32Array(N + 1), cum = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      xs[i] = u * u * u * a.x + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * b.x;
      ys[i] = u * u * u * a.y + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * b.y;
      if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    const conn: Conn = { key, fromKey: laneKey(road, forward, lane), toKey: laneKey(link.road, link.forward, nextLane), link, turn, lane: nextLane,
      endS, startS, len: Math.max(0.5, cum[N]), node: sig ? ci : -1, approach: `${road}:${!forward}`, tJoin, xs, ys, cum };
    connCache.set(key, conn);
    return conn;
  };
  /** Where a road's own start leaves off (travel coordinates): past its start intersection. */
  const startOf = (road: number, forward: boolean) => trim(road, forward);

  // About one vehicle per 55 m of lane, capped; spaced so none overlap.
  const laneMetres = paths.reduce((s, p) => s + p.len * Math.max(2, p.lanes), 0);
  const count = Math.min(hq ? 220 : 90, Math.round(laneMetres / 55));
  const cars: Car[] = [];
  const perKind = kinds.map(() => 0);
  for (let tries = 0; cars.length < count && tries < count * 10; tries++) {
    const road = Math.floor(rnd() * paths.length), forward = rnd() < 0.5, lane = Math.floor(rnd() * lanesOf(road));
    if (idle[road]) continue;
    const type = pickKind(), length = kinds[type].dims[0];
    const conn = connector(road, forward, lane, choose(road, forward, lane));
    const s0 = startOf(road, forward), span = conn.endS - s0 - length - 2;
    if (span < 2) continue;
    const s = s0 + length / 2 + rnd() * span;
    if (cars.some(o => !o.inConn && o.road === road && o.forward === forward && o.lane === lane && Math.abs(o.s - s) < (o.length + length) / 2 + 6)) continue;
    const cruise = (7 + rnd() * 5) * kinds[type].speed;
    cars.push({ road, forward, lane, s, type, slot: perKind[type]++, x: 0, y: 0, hx: 1, hy: 0, width: kinds[type].dims[1], id: cars.length,
      speed: cruise, cruise, length, conn, inConn: false, u: 0, go: false, arrive: null });
  }
  const group = new THREE.Group();
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    im.count = n;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = shadow;
    im.frustumCulled = false;
    group.add(im);
    return im;
  };
  const meshes = kinds.map((k, i) => instanced(k.geo, k.mat, perKind[i], true));
  const lampGeos = kinds.map(k => lampGeometry(k.dims[0], k.dims[1], k.dims[2]));
  const lamps = kinds.map((_, i) => { const im = instanced(lampGeos[i], lampMat, perKind[i], false); im.visible = false; return im; });
  let lampsOn = false;
  // Body colours for the Kenney cars vary through the per-instance colour.
  const paints = ["#ffffff", "#f4f4f4", "#1c1d20", "#9aa0a6", "#c9ccd0", "#3a4a63", "#7d1f22", "#e6e2d8", "#2f3a2f"];
  cars.forEach(c => { if (kinds[c.type].paint) meshes[c.type].setColorAt(c.slot, new THREE.Color(paints[Math.floor(rnd() * paints.length)]).lerp(new THREE.Color("#ffffff"), 0.3)); });
  meshes.forEach(m => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const place = (c: Car) => {
    if (c.inConn) {
      const cn = c.conn, u = Math.min(c.u, cn.len);
      let i = 1;
      while (i < cn.cum.length - 1 && cn.cum[i] < u) i++;
      const seg = cn.cum[i] - cn.cum[i - 1] || 1, t = (u - cn.cum[i - 1]) / seg;
      const dx = cn.xs[i] - cn.xs[i - 1], dy = cn.ys[i] - cn.ys[i - 1], l = Math.hypot(dx, dy) || 1;
      c.x = cn.xs[i - 1] + dx * t; c.y = cn.ys[i - 1] + dy * t; c.hx = dx / l; c.hy = dy / l;
    } else {
      const pt = lanePt(c.road, c.forward, c.s, c.lane);
      c.x = pt.x; c.y = pt.y; c.hx = pt.hx; c.hy = pt.hy;
    }
    q.setFromAxisAngle(up, Math.atan2(c.hx, -c.hy));
    m4.compose(v.set(c.x, 0.02, -c.y), q, one);
    meshes[c.type].setMatrixAt(c.slot, m4);
    if (lampsOn) lamps[c.type].setMatrixAt(c.slot, m4);
  };

  const inCorridor = (a: Car, b: Car, reach: number) => {
    const dx = b.x - a.x, dy = b.y - a.y, along = dx * a.hx + dy * a.hy;
    if (along <= 0 || along > reach) return -1;
    return Math.abs(dx * a.hy - dy * a.hx) < (a.width + b.width) / 2 + 0.5 ? along : -1;
  };

  /** Per frame: road cars by lane (sorted by s), cars on each connector (by u),
   * connector cars heading into each lane, and who occupies each intersection box. */
  const lanes = new Map<string, Car[]>(), onConn = new Map<string, Car[]>(), intoLane = new Map<string, Car[]>();
  const boxes = new Map<number, Car[]>();
  const push = <K,>(m: Map<K, Car[]>, k: K, c: Car) => { const l = m.get(k); if (l) l.push(c); else m.set(k, [c]); };
  const connCars: Car[] = [];

  /** Space free on a target lane past where a connector joins it. */
  const exitSpace = (cn: Conn, self: Car) => {
    let space = Infinity;
    for (const o of lanes.get(cn.toKey) ?? []) if (o.s >= cn.startS - o.length) { space = o.s - o.length / 2 - cn.startS; break; }
    for (const o of intoLane.get(cn.toKey) ?? []) if (o !== self) space -= o.length + 2;
    return space;
  };
  /** May this vehicle cross its stop line now? */
  const admit = (c: Car, toStop: number) => {
    const cn = c.conn;
    if (cn.node >= 0) {
      const light = lightAt(cn.node, cn.approach), inBox = boxes.get(cn.node) ?? [];
      if (light === "red") {
        // 적신호 우회전: stop first, then only into an empty box.
        if (!(cn.turn === "right" && c.speed < 0.6 && toStop < 1.5 && inBox.every(o => o === c))) { c.why = "red"; return false; }
      } else if (light === "yellow" && toStop > (c.speed * c.speed) / 10 + 1) { c.why = "yellow"; return false; }
      // One direction in the box at a time (stragglers from the last phase clear first).
      const ph = (k: string | undefined) => (k === undefined ? -1 : signals[cn.node]!.phase.get(k));
      if (inBox.some(o => o !== c && ph(o.inConn ? o.conn.approach : o.arrive?.approach) !== ph(cn.approach))) { c.why = "box"; return false; }
    } else if (cn.tJoin) {
      // A side road joins mid-block: wait for a gap in the through traffic, both ways.
      const p = paths[cn.link.road], j = cn.link.forward ? cn.link.s0 : p.len - cn.link.s0;
      for (const [k, list] of lanes) {
        if (!k.startsWith(`${cn.link.road}|`)) continue;
        for (const o of list) {
          const pos = o.forward ? o.s : p.len - o.s, toward = o.forward ? j - pos : pos - j;
          if (toward > -8 && toward < 22) { c.why = "tjoin"; return false; }
        }
      }
    }
    // 꼬리물기 금지: enter only with room to leave the box on the other side.
    if (exitSpace(cn, c) > c.length + 3) return true;
    c.why = "exit";
    return false;
  };

  const plan = (c: Car) => { c.conn = connector(c.road, c.forward, c.lane, choose(c.road, c.forward, c.lane)); c.go = false; };

  /** Car following on each lane and through each junction; stopping at stop lines for
   * red, for a full exit and for crossing traffic. No vehicle closes to less than half a
   * metre of the one ahead, and paths through an intersection never cross (one
   * approach at a time), so nothing overlaps and nothing locks up. */
  const step = (dt: number) => {
    clock += dt;
    lanes.clear(); onConn.clear(); intoLane.clear(); boxes.clear(); connCars.length = 0;
    for (const c of cars) {
      if (c.inConn) {
        push(onConn, c.conn.key, c); push(intoLane, c.conn.toKey, c); connCars.push(c);
        if (c.conn.node >= 0) push(boxes, c.conn.node, c);
      } else {
        push(lanes, laneKey(c.road, c.forward, c.lane), c);
        // In a box: cleared across its stop line, or rear not yet out of the last one.
        if (c.conn.node >= 0 && c.go) { c.arrive = null; push(boxes, c.conn.node, c); }
        // (Half a metre of slack: one stopped in a queue right at the edge must not hold
        // the box for every other direction.)
        else if (c.arrive && c.s - c.length / 2 < c.arrive.startS - 0.5) push(boxes, c.arrive.node, c);
        else c.arrive = null;
      }
    }
    lanes.forEach(l => l.sort((a, b) => a.s - b.s));
    onConn.forEach(l => l.sort((a, b) => a.u - b.u));
    for (const c of cars) {
      const cn = c.conn;
      let room = Infinity;
      c.why = "";
      const gap = (o: Car, d: number) => d - (o.length + c.length) / 2;
      const firstOnTarget = () => { for (const o of lanes.get(cn.toKey) ?? []) if (o.s >= cn.startS - o.length) return o; return null; };
      if (c.inConn) {
        const list = onConn.get(cn.key)!, ahead = list[list.indexOf(c) + 1];
        if (ahead) room = gap(ahead, ahead.u - c.u);
        else { const f = firstOnTarget(); if (f) room = gap(f, cn.len - c.u + f.s - cn.startS); }
      } else {
        const list = lanes.get(laneKey(c.road, c.forward, c.lane))!, ahead = list[list.indexOf(c) + 1];
        if (ahead) room = gap(ahead, ahead.s - c.s);
        else {
          const inC = onConn.get(cn.key);
          if (inC?.length) room = gap(inC[0], cn.endS - c.s + inC[0].u);
          else { const f = firstOnTarget(); if (f) room = gap(f, cn.endS - c.s + cn.len + f.s - cn.startS); }
        }
        // Until cleared, the stop line holds (a vehicle already past it on a short road
        // simply waits there). Cleared once its front reaches the line with the way open.
        const toStop = cn.endS - 0.5 - (c.s + c.length / 2);
        if (!c.go) {
          if (toStop < 60 && !admit(c, Math.max(0, toStop))) room = Math.min(room, Math.max(0, toStop));
          else if (toStop < 1.5) c.go = true;
        }
        // Give way to anything already turning across this lane.
        // (Not those merging into this very lane behind it: they follow this vehicle.)
        const reach = Math.max(9, c.speed * 1.6 + c.length), own = laneKey(c.road, c.forward, c.lane);
        for (const o of connCars) {
          if (o.conn.toKey === own) continue;
          const al = inCorridor(c, o, reach);
          if (al >= 0) room = Math.min(room, gap(o, al));
        }
      }
      const want = c.cruise * Math.min(1, Math.max(0, (room - 2) / 16)) * (c.inConn && cn.turn !== "straight" ? 0.6 : 1);
      c.speed = Math.max(0, c.speed + Math.max(-8 * dt, Math.min(2.5 * dt, want - c.speed)));
      const adv = Math.min(c.speed * dt, Math.max(0, room - 0.5));
      if (c.inConn) {
        c.u += adv;
        if (c.u >= cn.len) {
          const over = c.u - cn.len;
          c.road = cn.link.road; c.forward = cn.link.forward; c.lane = cn.lane; c.s = cn.startS + over;
          c.inConn = false; c.u = 0;
          c.arrive = cn.node >= 0 ? { node: cn.node, startS: cn.startS, approach: cn.approach } : null;
          plan(c);
        }
      } else {
        c.s += adv;
        if (c.s >= cn.endS && c.go) { c.inConn = true; c.u = c.s - cn.endS; }
      }
      place(c);
    }
  };
  cars.forEach(place);
  meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; });

  // ---- Signal heads: Korean 4-colour horizontal (적·황·좌회전 화살표·녹), one per
  // approach on a pole at the right kerb of the stop line, arm over the lanes. ----
  const heads: { ni: number; key: string; light: Light | null }[] = [];
  const headMats: THREE.Matrix4[] = [];
  const staticParts: THREE.BufferGeometry[] = [];
  const colored = (g: THREE.BufferGeometry, color: string, m: THREE.Matrix4) => {
    const out = g.clone().applyMatrix4(m).toNonIndexed();
    const c = new THREE.Color(color), n = out.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.deleteAttribute("uv");
    return out;
  };
  const poleG = new THREE.CylinderGeometry(0.1, 0.14, 6.6, 8); poleG.translate(0, 3.3, 0);
  const housingG = new THREE.BoxGeometry(1.5, 0.42, 0.3);
  const visorG = new THREE.BoxGeometry(1.5, 0.05, 0.22);
  const lensG = new THREE.CylinderGeometry(0.14, 0.14, 0.04, 18); lensG.rotateX(Math.PI / 2);
  const arrowShape = new THREE.Shape();
  // Pointing along +x (the driver's left), in the lamp's face.
  arrowShape.moveTo(0.13, 0); arrowShape.lineTo(0.02, 0.09); arrowShape.lineTo(0.02, 0.035); arrowShape.lineTo(-0.12, 0.035);
  arrowShape.lineTo(-0.12, -0.035); arrowShape.lineTo(0.02, -0.035); arrowShape.lineTo(0.02, -0.09); arrowShape.closePath();
  const arrowG = new THREE.ExtrudeGeometry(arrowShape, { depth: 0.02, bevelEnabled: false });
  const LAMP_X = [0.54, 0.18, -0.18, -0.54]; // red, yellow, arrow, green: red on the driver's left
  const basis = new THREE.Matrix4(), tm = new THREE.Matrix4();
  clusters.forEach((_, ni) => {
    if (!signals[ni]) return;
    for (const e of clusterEnds[ni]) {
      const road = e.road, forward = !e.atStart, p = paths[road];
      const [hx, hy] = headingIn(road, forward);
      // The pole stands 1.5 m behind the stop point, never out in the intersection.
      const tr = Math.min(trim(road, e.atStart) + 1.5, p.len * 0.5), stop = at(p, e.atStart ? tr : p.len - tr);
      const rx = hy, ry = -hx; // right of travel
      const px = stop.x + rx * (p.width / 2 + 0.9), py = stop.y + ry * (p.width / 2 + 0.9);
      const armLen = Math.min(p.width / 2 + 0.9, Math.max(2.5, p.width * 0.35));
      const hxW = px - rx * armLen, hyW = py - ry * armLen; // head over the lanes
      // Basis: X = driver's left, Y = up, Z = travel direction (the face looks back at traffic).
      const L = new THREE.Vector3(-hy, 0, -hx), U = new THREE.Vector3(0, 1, 0), H = new THREE.Vector3(hx, 0, -hy);
      staticParts.push(colored(poleG, "#6b7076", tm.makeTranslation(px, 0, -py)));
      const armG = new THREE.BoxGeometry(0.1, 0.1, armLen);
      const armAt = new THREE.Matrix4().makeBasis(L.clone().negate().cross(U).negate(), U, L.clone().negate()).setPosition((px + hxW) / 2, 6.45, -(py + hyW) / 2);
      staticParts.push(colored(armG, "#6b7076", armAt)); armG.dispose();
      basis.makeBasis(L, U, H).setPosition(hxW, 6.2, -hyW);
      staticParts.push(colored(housingG, "#16181b", basis));
      staticParts.push(colored(visorG, "#16181b", tm.copy(basis).multiply(new THREE.Matrix4().makeTranslation(0, 0.23, -0.2))));
      for (const x of LAMP_X) staticParts.push(colored(lensG, "#2a2c2f", tm.copy(basis).multiply(new THREE.Matrix4().makeTranslation(x, 0, -0.16))));
      heads.push({ ni, key: `${road}:${e.atStart}`, light: null });
      headMats.push(basis.clone());
    }
  });
  const signalMeshes: THREE.Mesh[] = [];
  const litMeshes: THREE.InstancedMesh[] = [];
  const signalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  const litMats = ["#ff2a1a", "#ffb400", "#19e07a", "#19e07a"].map(c => new THREE.MeshStandardMaterial({ color: "#000000", emissive: c, emissiveIntensity: 4, roughness: 0.4 }));
  if (heads.length) {
    const merged = mergeGeometries(staticParts, false)!;
    staticParts.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, signalMat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    signalMeshes.push(mesh);
    const disc = lensG.clone();
    const shapes = [disc, disc, arrowG, disc];
    for (let k = 0; k < 4; k++) {
      const im = new THREE.InstancedMesh(shapes[k], litMats[k], heads.length);
      im.frustumCulled = false;
      group.add(im);
      litMeshes.push(im);
    }
  }
  const off = new THREE.Matrix4().makeScale(0, 0, 0);
  const lampOffset = LAMP_X.map((x, k) => new THREE.Matrix4().makeTranslation(x, 0, k === 2 ? -0.2 : -0.185));
  /** Light each head for its approach: green with the left arrow, yellow, or red. */
  const showSignals = () => {
    let dirty = false;
    heads.forEach((h, i) => {
      const light = lightAt(h.ni, h.key);
      if (light === h.light) return;
      h.light = light; dirty = true;
      const on = [light === "red", light === "yellow", light === "green", light === "green"];
      for (let k = 0; k < 4; k++) litMeshes[k].setMatrixAt(i, on[k] ? tm.copy(headMats[i]).multiply(lampOffset[k]) : off);
    });
    if (dirty) litMeshes.forEach(m => { m.instanceMatrix.needsUpdate = true; });
  };
  showSignals();
  group.userData.traffic = { cars, paths, nodes, nodeOf, trimAt, clusters }; // inspection in dev tools

  return {
    group,
    update(dt: number) {
      step(Math.min(0.1, dt));
      showSignals();
      meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; });
      if (lampsOn) lamps.forEach(m => { m.instanceMatrix.needsUpdate = true; });
    },
    /** Head and tail lamps from dusk (Look.lamps: 0 by day). */
    setLamps(level: number) {
      const on = level > 0.25;
      lampMat.emissiveIntensity = level * 5;
      if (on === lampsOn) return;
      lampsOn = on;
      lamps.forEach(m => { m.visible = on; });
      if (on) { cars.forEach(place); lamps.forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
    },
    dispose() {
      [...meshes, ...lamps].forEach(m => m.dispose());
      kinds.forEach(k => { if (k.own) k.geo.dispose(); });
      lampGeos.forEach(g => g.dispose());
      [poleG, housingG, visorG, lensG, arrowG].forEach(g => g.dispose());
      signalMeshes.forEach(m => m.geometry.dispose());
      litMeshes.forEach(m => { if (m.geometry !== arrowG) m.geometry.dispose(); m.dispose(); });
      [signalMat, ...litMats].forEach(m => m.dispose());
      bodyMat.dispose(); boxMat.dispose(); lampMat.dispose();
    },
  };
}
