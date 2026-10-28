import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* The 공동현관 of an apartment block, as built in its era — two of each, picked by the block's number:
 *   old  (–1995)     A: a painted concrete slab canopy over a recessed opening, bronze aluminium swing
 *                       doors, terrazzo steps up to a landing, steel handrails, a bulkhead lamp
 *                    B: as most such blocks are now, remodelled: the portal clad in pale granite
 *                       slabs, a slim stainless canopy, aluminium doors, one step and a ramp
 *   mid  (1996–2011) A: a light granite portal on two square columns, sliding glass doors with side
 *                       lights, a ramp and a step, the intercom in a granite pillar
 *                    B: a steel-and-glass canopy on round columns over a granite surround
 *   new  (2012–)     A: a double-height glass lobby in a dark granite frame, a slim cantilever canopy
 *                       with a line of light, a flush threshold, planters, a lit 동 sign stone
 *                    B: a wide beige stone frame, a timber-louvred soffit, bronze glass fins
 * The group's frame: x along the wall, y up, z out of the building (the wall face at z = 0). Every
 * part is merged into one mesh per material (5–9 draws an entrance), uv in metres on the box faces
 * (stone, terrazzo and timber at their real size), edges bevelled so no outline is a hard step. */

export type EntranceEra = "old" | "mid" | "new";

interface Mats {
  paint: THREE.MeshStandardMaterial; brick: THREE.MeshStandardMaterial; graniteL: THREE.MeshStandardMaterial; graniteD: THREE.MeshStandardMaterial;
  beige: THREE.MeshStandardMaterial; terrazzo: THREE.MeshStandardMaterial; bronze: THREE.MeshStandardMaterial; alu: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; lobby: THREE.MeshStandardMaterial; wood: THREE.MeshStandardMaterial;
  light: THREE.MeshBasicMaterial; plant: THREE.MeshStandardMaterial; soil: THREE.MeshStandardMaterial;
}
type Key = keyof Mats;

let shared: { mats: Mats; tex: THREE.Texture[] } | null = null;

const rnd = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** speckled stone: a base with grains light and dark (granite), 1 texture = `m` metres */
function speckle(base: string, grains: [string, number][], seed: number, joints = 0) {
  return canvasTex(256, (g, s) => {
    const r = rnd(seed);
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    // soft clouds
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,255,255"},${0.03 + r() * 0.04})`; g.beginPath(); g.arc(r() * s, r() * s, 10 + r() * 40, 0, 7); g.fill(); }
    for (const [c, n] of grains) { g.fillStyle = c; for (let i = 0; i < n; i++) { const w = 0.6 + r() * 2.2; g.fillRect(r() * s, r() * s, w, w * (0.5 + r())); } }
    if (joints) { g.fillStyle = "rgba(20,18,16,0.55)"; for (let k = 0; k <= joints; k++) { g.fillRect(0, (k * s) / joints - 1, s, 2); } g.fillRect(0, 0, 2, s); g.fillRect(s / 2 - 1, 0, 2, s); }
  });
}

function makeShared() {
  const tex: THREE.Texture[] = [];
  const T = <X extends THREE.Texture>(t: X, rep: number) => { t.repeat.set(rep, rep); tex.push(t); return t; };
  // (each texture covers 1/rep metres)
  const granL = T(speckle("#b8b2a8", [["#6d6862", 900], ["#ece8e0", 700], ["#3b3836", 260]], 11, 2), 1 / 1.2);
  const granD = T(speckle("#3c3d40", [["#1d1e20", 900], ["#7b7c80", 600], ["#a9a59e", 120]], 23, 2), 1 / 1.2);
  const beige = T(speckle("#cbbfa8", [["#a8987c", 700], ["#e6dccb", 600]], 37, 2), 1 / 1.2);
  const terr = T(speckle("#b9b2a3", [["#5d5850", 1600], ["#e9e4da", 1200], ["#8a6e55", 400], ["#3a4a40", 150]], 51), 1 / 0.6);
  const paint = T(speckle("#d5d0c6", [["#bfb9ae", 500], ["#e4e0d8", 400]], 61), 1 / 2);
  const brick = T(canvasTex(256, (g, s) => {
    const r = rnd(71); g.fillStyle = "#a59d92"; g.fillRect(0, 0, s, s);
    const bh = s / 8, bw = s / 2.7;
    for (let row = 0; row < 8; row++) for (let k = -1; k < 4; k++) {
      const x = k * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
      const v = r(); g.fillStyle = `rgb(${120 + v * 40},${58 + v * 22},${44 + v * 16})`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x + 2, y + bh - 5, bw - 4, 3);
    }
  }), 1 / 0.6);
  const wood = T(canvasTex(256, (g, s) => {
    const r = rnd(81); g.fillStyle = "#8a5a36"; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? "50,28,14" : "190,140,95"},${0.08 + r() * 0.18})`; g.lineWidth = 0.5 + r() * 1.5; const y = r() * s; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + (r() - 0.5) * 6, s * 0.6, y + (r() - 0.5) * 6, s, y); g.stroke(); }
  }), 1 / 1.0);
  // the lobby's back wall seen through the glass: marble, the mailboxes, the lift doors, a bench
  const lobbyTex = canvasTex(512, (g, s) => {
    g.fillStyle = "#e7e0d3"; g.fillRect(0, 0, s, s);
    const r = rnd(91); for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(150,140,125,${0.15 + r() * 0.2})`; g.lineWidth = 1; g.beginPath(); g.moveTo(r() * s, r() * s); g.bezierCurveTo(r() * s, r() * s, r() * s, r() * s, r() * s, r() * s); g.stroke(); }
    g.fillStyle = "rgba(120,110,95,0.4)"; for (let k = 1; k < 4; k++) g.fillRect((k * s) / 4, 0, 1.5, s);
    // the lift doors, stainless, and the call panel
    g.fillStyle = "#9da3a8"; g.fillRect(s * 0.56, s * 0.38, s * 0.2, s * 0.62); g.fillStyle = "#7d8388"; g.fillRect(s * 0.659, s * 0.38, 2, s * 0.62);
    g.fillStyle = "#3a3f44"; g.fillRect(s * 0.53, s * 0.33, s * 0.26, s * 0.05); g.fillStyle = "#ff9a3c"; g.fillRect(s * 0.645, s * 0.345, s * 0.03, s * 0.025);
    // the mailboxes
    g.fillStyle = "#6c7177"; g.fillRect(s * 0.06, s * 0.45, s * 0.36, s * 0.3);
    g.fillStyle = "#8b9095"; for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) g.fillRect(s * 0.065 + i * s * 0.044, s * 0.455 + j * s * 0.058, s * 0.04, s * 0.052);
    // floor and skirting
    g.fillStyle = "#c9bfae"; g.fillRect(0, s * 0.96, s, s * 0.04); g.fillStyle = "#57504a"; g.fillRect(0, s * 0.95, s, 3);
  });
  tex.push(lobbyTex);
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const mats: Mats = {
    paint: std({ map: paint, roughness: 0.88 }),
    brick: std({ map: brick, roughness: 0.9 }),
    graniteL: std({ map: granL, roughness: 0.42 }),
    graniteD: std({ map: granD, roughness: 0.32 }),
    beige: std({ map: beige, roughness: 0.55 }),
    terrazzo: std({ map: terr, roughness: 0.5 }),
    bronze: std({ color: "#4a3b2c", roughness: 0.38, metalness: 0.75 }),
    alu: std({ color: "#25292e", roughness: 0.36, metalness: 0.7 }),
    steel: std({ color: "#c3c7cb", roughness: 0.22, metalness: 1 }),
    glass: std({ color: "#7d939e", roughness: 0.03, metalness: 0.35, transparent: true, opacity: 0.42, depthWrite: false }),
    lobby: std({ map: lobbyTex, roughness: 0.6, emissiveMap: lobbyTex, emissive: "#ffffff", emissiveIntensity: 0.35 }),
    wood: std({ map: wood, roughness: 0.7 }),
    light: new THREE.MeshBasicMaterial({ color: "#fff1d6" }),
    plant: std({ color: "#3f6a34", roughness: 0.85 }),
    soil: std({ color: "#3b2f25", roughness: 1 }),
  };
  for (const m of Object.values(mats)) m.userData.entranceShared = true;
  return { mats, tex };
}

/** uv in metres by the face's direction (box projection): stone and timber at their real size */
function metricUV(geo: THREE.BufferGeometry) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) { uv[i * 2] = p.getZ(i); uv[i * 2 + 1] = p.getY(i); }
    else if (ay >= az) { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getZ(i); }
    else { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getY(i); }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export function eraOf(built: number | null | undefined, floors: number): EntranceEra {
  if (built && built > 1900) return built <= 1995 ? "old" : built <= 2011 ? "mid" : "new";
  return floors >= 25 ? "new" : floors >= 16 ? "mid" : "old";
}

/** One entrance, merged by material; `sign` the 동 number's plate texture. */
export function buildEntrance(era: EntranceEra, variant: number, sign: THREE.Texture, night: number) {
  shared ??= makeShared();
  const M = shared.mats;
  M.lobby.emissiveIntensity = 0.3 + night * 1.4;
  const parts = new Map<Key, THREE.BufferGeometry[]>();
  const put = (k: Key, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) => {
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    if (g.index) g = g.toNonIndexed();
    // (the lobby's picture once across its wall; everything else in metres)
    if (k !== "lobby") metricUV(g);
    (parts.get(k) ?? parts.set(k, []).get(k)!).push(g);
  };
  // a box, bevelled (r: the bevel, m)
  const box = (k: Key, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.012) =>
    put(k, r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)) : new THREE.BoxGeometry(w, h, d), x, y, z);
  const cyl = (k: Key, rad: number, h: number, x: number, y: number, z: number, seg = 16) => put(k, new THREE.CylinderGeometry(rad, rad, h, seg), x, y, z);
  const rail = (k: Key, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rad = 0.022) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0), g = new THREE.CylinderGeometry(rad, rad, len, 10);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize()));
    put(k, g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  };
  /** a glazed opening w × h, its sill at y0: frame, leaves' stiles, mid rail, glass, lobby behind */
  let opening = { hw: 1.4, top: 2.8, depth: 2.4 };
  const glazing = (frame: Key, w: number, h: number, y0: number, z: number, leaves: number, midRail: number | null, depth = 2.4) => {
    const f = 0.06;
    opening = { hw: w / 2 + 0.2, top: y0 + h + 0.3, depth: depth - z };
    box(frame, w + f * 2, f, 0.12, 0, y0 + h + f / 2, z); box(frame, w + f * 2, f, 0.12, 0, y0 - f / 2 + 0.02, z);
    box(frame, f, h, 0.12, -w / 2 - f / 2, y0 + h / 2, z); box(frame, f, h, 0.12, w / 2 + f / 2, y0 + h / 2, z);
    for (let i = 1; i < leaves; i++) box(frame, 0.045, h, 0.09, -w / 2 + (w * i) / leaves, y0 + h / 2, z);
    if (midRail !== null) box(frame, w, 0.05, 0.09, 0, y0 + midRail, z);
    put("glass", new THREE.PlaneGeometry(w, h), 0, y0 + h / 2, z);
    // the lobby: its floor, its back wall (the picture), its ceiling a little lit
    box("terrazzo", w + 0.4, 0.04, depth, 0, y0 - 0.02, z - depth / 2, 0);
    put("lobby", new THREE.PlaneGeometry(w + 0.4, h + 0.3), 0, y0 + (h + 0.3) / 2, z - depth);
    box("paint", w + 0.4, 0.04, depth, 0, y0 + h + 0.3, z - depth / 2, 0);
    box("paint", 0.04, h + 0.3, depth, -w / 2 - 0.2, y0 + (h + 0.3) / 2, z - depth / 2, 0);
    box("paint", 0.04, h + 0.3, depth, w / 2 + 0.2, y0 + (h + 0.3) / 2, z - depth / 2, 0);
  };
  /** a cladding frame round the opening (ow × oh from the ground): its sides and its head */
  const surround = (k: Key, W: number, H: number, ow: number, oh: number, z: number, d = 0.1) => {
    const side = (W - ow) / 2;
    box(k, side, H, d, -(ow + side) / 2, H / 2, z, 0.005); box(k, side, H, d, (ow + side) / 2, H / 2, z, 0.005);
    box(k, ow, H - oh, d, 0, oh + (H - oh) / 2, z, 0.005);
  };
  const pulls = (y0: number, z: number) => { for (const x of [-0.09, 0.09]) { cyl("steel", 0.016, 0.85, x, y0 + 1.05, z + 0.09, 10); for (const y of [0.7, 1.4]) rail("steel", x, y0 + y, z + 0.06, x, y0 + y, z + 0.09, 0.01); } };
  let signAt: [number, number, number, number, number] = [0, 3, 1, 0.9, 0.28];   // x, y, z, w, h

  if (era === "old") {
    const L = 0.3;                                         // the landing's height
    if (variant === 0) {
      // the recessed opening in a painted surround, the doors set back
      box("paint", 0.32, 2.75, 0.3, -1.36, 1.375 + L, 0.15); box("paint", 0.32, 2.75, 0.3, 1.36, 1.375 + L, 0.15);
      box("paint", 3.04, 0.4, 0.3, 0, 2.95 + L, 0.15);
      glazing("bronze", 2.3, 2.3, L + 0.05, -0.25, 2, 1.0);
      pulls(L, -0.25);
      // the slab canopy, painted, with a drip edge
      box("paint", 3.4, 0.18, 1.55, 0, 3.32 + L, 0.78, 0.03);
      box("paint", 3.4, 0.08, 0.06, 0, 3.2 + L, 1.53, 0.01);
      // terrazzo landing and two steps, steel handrails
      box("terrazzo", 3.0, L, 0.95, 0, L / 2, 0.47); box("terrazzo", 3.0, 0.2, 0.3, 0, 0.1, 1.1); box("terrazzo", 3.0, 0.1, 0.3, 0, 0.05, 1.4);
      for (const s of [-1, 1]) { const x = s * 1.42; rail("steel", x, 0.95 + L, 0.1, x, 0.95, 1.5); cyl("steel", 0.02, 0.95, x, 0.48, 1.5, 10); cyl("steel", 0.02, 0.95, x, 0.48 + L, 0.4, 10); }
      // the bulkhead lamp over the door
      box("steel", 0.36, 0.12, 0.1, 0, 3.0 + L, 0.06, 0.03); box("light", 0.3, 0.06, 0.02, 0, 2.96 + L, 0.11, 0);
      signAt = [0, 3.32 + L, 1.56, 0.82, 0.18];
    } else {
      // remodelled: a pale granite-clad portal, a slim stainless canopy on two tie rods
      box("graniteL", 0.5, 3.0, 0.4, -1.45, 1.5, 0.2); box("graniteL", 0.5, 3.0, 0.4, 1.45, 1.5, 0.2); box("graniteL", 3.4, 0.45, 0.4, 0, 3.2, 0.2);
      glazing("alu", 2.3, 2.4, 0.15, -0.05, 2, 1.05);
      pulls(0.12, -0.05);
      box("steel", 3.6, 0.08, 1.3, 0, 3.5, 0.65, 0.01);
      box("light", 2.8, 0.01, 0.04, 0, 3.455, 1.2, 0);
      for (const sx of [-1.4, 1.4]) rail("steel", sx, 4.1, 0.05, sx, 3.54, 1.25, 0.012);
      box("terrazzo", 2.9, 0.15, 0.8, 0, 0.075, 0.4);
      // the ramp: a sloped slab and its rail
      const ramp = new THREE.BoxGeometry(1.2, 0.08, 1.9); ramp.rotateX(0.075); put("paint", ramp, 2.4, 0.07, 1.0);
      rail("steel", 3.0, 0.95, 0.1, 3.0, 0.85, 1.95); cyl("steel", 0.02, 0.9, 3.0, 0.45, 1.95, 10);
      signAt = [0, 3.2, 0.405, 0.82, 0.24];
    }
  } else if (era === "mid") {
    if (variant === 0) {
      // granite surround, two square granite columns carrying the canopy
      surround("graniteL", 4.8, 3.6, 4.2, 2.92, 0.05);
      glazing("alu", 3.8, 2.5, 0.12, 0.12, 4, 2.2);
      pulls(0.12, 0.12);
      for (const s of [-1, 1]) box("graniteL", 0.5, 3.35, 0.5, s * 2.1, 1.675, 1.75, 0.02);
      box("graniteL", 4.9, 0.36, 2.25, 0, 3.53, 1.05, 0.03);
      box("paint", 4.6, 0.02, 2.0, 0, 3.34, 1.05, 0);
      for (const x of [-1.2, 0, 1.2]) for (const z of [0.6, 1.5]) put("light", new THREE.CircleGeometry(0.075, 18).rotateX(Math.PI / 2), x, 3.325, z);
      box("graniteL", 4.9, 0.1, 2.3, 0, 0.05, 1.05, 0.01);
      // the intercom pillar
      box("graniteL", 0.32, 1.3, 0.24, 2.85, 0.65, 1.3, 0.02); box("alu", 0.2, 0.3, 0.02, 2.85, 1.12, 1.43, 0); box("light", 0.12, 0.08, 0.01, 2.85, 1.18, 1.445, 0);
      signAt = [0, 3.53, 2.185, 0.95, 0.26];
    } else {
      // round steel columns, a steel-framed glass canopy, granite round the doors
      surround("graniteD", 4.2, 3.2, 3.6, 2.85, 0.05);
      glazing("alu", 3.2, 2.45, 0.1, 0.12, 4, null);
      pulls(0.1, 0.12);
      for (const s of [-1, 1]) cyl("steel", 0.11, 3.2, s * 1.95, 1.6, 2.1, 20);
      box("alu", 4.6, 0.14, 0.14, 0, 3.27, 2.15, 0.02); box("alu", 4.6, 0.14, 0.14, 0, 3.27, 0.12, 0.02);
      for (const x of [-2.2, -1.1, 0, 1.1, 2.2]) box("alu", 0.08, 0.1, 2.05, x, 3.28, 1.13, 0.01);
      box("glass", 4.5, 0.02, 2.0, 0, 3.36, 1.13, 0);
      box("graniteD", 4.4, 0.08, 2.4, 0, 0.04, 1.1, 0.01);
      box("graniteD", 0.32, 1.3, 0.24, 2.5, 0.65, 1.4, 0.02); box("light", 0.13, 0.2, 0.01, 2.5, 1.1, 1.525, 0);
      signAt = [0, 2.95, 0.11, 0.9, 0.26];
    }
  } else {
    if (variant === 0) {
      // the double-height glass lobby in a dark granite frame
      const H = 5.6, W = 4.6;
      for (const s of [-1, 1]) box("graniteD", 0.5, H + 0.6, 1.8, s * (W / 2 + 0.25), (H + 0.6) / 2, 0.9, 0.02);
      box("graniteD", W + 1.0, 0.6, 1.8, 0, H + 0.3, 0.9, 0.02);
      glazing("alu", W, H - 0.05, 0.05, 0.3, 5, 2.75, 3.4);
      pulls(0.05, 0.3);
      // the cantilever canopy within the frame: a thin edge, timber soffit, a line of light
      box("alu", W, 0.12, 1.5, 0, 3.0, 1.05, 0.02);
      for (let x = -W / 2 + 0.15; x < W / 2; x += 0.22) box("wood", 0.08, 0.06, 1.4, x, 2.91, 1.05, 0.008);
      box("light", W - 0.3, 0.025, 0.04, 0, 2.94, 1.76, 0);
      // flush threshold of dark granite; planters to either side
      box("graniteD", W + 1.0, 0.03, 2.6, 0, 0.015, 1.1, 0);
      for (const s of [-1, 1]) {
        const x = s * (W / 2 + 1.35);
        box("graniteD", 1.6, 0.55, 1.0, x, 0.275, 1.2, 0.03); box("soil", 1.45, 0.05, 0.85, x, 0.53, 1.2, 0);
        for (let i = 0; i < 5; i++) put("plant", new THREE.IcosahedronGeometry(0.22 + (i % 2) * 0.06, 1), x - 0.55 + i * 0.27, 0.68 + (i % 2) * 0.05, 1.2 + ((i * 37) % 3 - 1) * 0.15);
      }
      // the 동 sign stone, lit from within
      box("graniteD", 0.7, 1.7, 0.3, W / 2 + 2.6, 0.85, 2.3, 0.02);
      signAt = [W / 2 + 2.6, 1.3, 2.455, 0.6, 0.19];
    } else {
      // a wide beige stone frame, timber louvred soffit, bronze fins on the glass
      const H = 4.2, W = 5.2;
      for (const s of [-1, 1]) box("beige", 0.6, H + 0.5, 2.2, s * (W / 2 + 0.3), (H + 0.5) / 2, 1.1, 0.02);
      box("beige", W + 1.2, 0.5, 2.2, 0, H + 0.25, 1.1, 0.02);
      for (let x = -W / 2 + 0.1; x < W / 2; x += 0.16) box("wood", 0.07, 0.12, 2.1, x, H - 0.06, 1.1, 0.008);
      for (const x of [-1.6, -0.8, 0.8, 1.6]) box("bronze", 0.06, H - 0.1, 0.35, x * (W / 4.2), (H - 0.1) / 2, 0.45, 0.01);
      glazing("bronze", W - 0.1, H - 0.1, 0.05, 0.25, 4, 2.6, 3.0);
      pulls(0.05, 0.25);
      box("light", W - 0.2, 0.02, 0.04, 0, H - 0.14, 2.1, 0);
      box("beige", W + 1.2, 0.03, 2.6, 0, 0.015, 1.2, 0);
      // a low stone sign wall with the number
      box("beige", 1.8, 0.75, 0.35, -(W / 2 + 1.8), 0.375, 1.8, 0.02);
      signAt = [-(W / 2 + 1.8), 0.47, 1.98, 0.9, 0.28];
    }
  }

  // how far the entrance's parts reach along the wall (the beds begin beyond)
  let extent = 0;
  for (const list of parts.values()) for (const g of list) { g.computeBoundingBox(); const b = g.boundingBox!; if (b.max.z > -0.2) extent = Math.max(extent, -b.min.x, b.max.x); }
  const group = new THREE.Group();
  const disposable: THREE.BufferGeometry[] = [];
  for (const [k, list] of parts) {
    const geo = mergeGeometries(list, false); list.forEach(g => g.dispose());
    if (!geo) continue;
    disposable.push(geo);
    const mesh = new THREE.Mesh(geo, M[k]);
    mesh.castShadow = k !== "glass" && k !== "light" && k !== "lobby";
    mesh.receiveShadow = k !== "light";
    if (k === "glass") mesh.renderOrder = 2;
    group.add(mesh);
  }
  // the 동 number plate
  const [sx, sy, sz, sw, sh] = signAt;
  const signMat = new THREE.MeshBasicMaterial({ map: sign });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), signMat); plate.position.set(sx, sy, sz); group.add(plate);
  return { group, opening, extent, dispose() { disposable.forEach(g => g.dispose()); plate.geometry.dispose(); signMat.dispose(); sign.dispose(); } };
}

export function disposeEntranceShared() {
  if (!shared) return;
  Object.values(shared.mats).forEach(m => m.dispose()); shared.tex.forEach(t => t.dispose()); shared = null;
}
