import { frameSlice } from "./frameSlice";
import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { RealEstateRoad } from "../api/client";
import type { Lamp } from "./complexScene";
import { rng } from "./complexScene";
import { FLAT, type Terrain } from "./sceneTerrain";
import { KERB_H } from "./sceneSidewalk";
import { carGeometry, carModelMaterial, CAR_SPECS, loadCarModels } from "./sceneCars";
import { DIMS } from "./vehicleShapes";
import { vehicleShapes } from "./vehicleClient";
import { plateAtlasReady, plateGeometry, plateMaterial, PLATE_COUNT, PLATE_WHITE } from "./scenePlates";
import { cdn } from "../staticCdn";

/* The street: lamps on the surveyed major roads, and traffic driving both ways on
 * them. Cars, vans and box trucks are Kenney's CC0 Car Kit (packed by type into
 * /3d/vehicles.bin), scaled to real dimensions; city buses, cargo and container
 * trucks are modelled here in the same plain style; the service vehicles (119 구급차,
 * 경찰차, 소방 펌프차, 압축 청소차, 레미콘) in rounded panels with real proportions.
 * Everything stands on the terrain (sceneTerrain.ts). Footprint frame (x east, y north) maps to world (x, -z). */

// ---------- Lamps ----------

/** Made in slices (a few dozen lamps each): at once, with the ground, it held a frame ~50 ms. */
export async function buildLamps(lamps: Lamp[], terrain: Terrain = FLAT) {
  const posts: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [], halos: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.08, 0.13, 9, 6).toNonIndexed(); pole.translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(0.1, 0.1, 1.9).toNonIndexed(); arm.translate(0, 8.9, 0.9);
  const head = new THREE.BoxGeometry(0.34, 0.14, 0.7).toNonIndexed(); head.translate(0, 8.82, 1.85);
  const halo = new THREE.SphereGeometry(0.9, 10, 6).toNonIndexed(); halo.translate(0, 8.55, 1.85);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let at0 = performance.now();
  for (const l of lamps) {
    if (performance.now() - at0 > 5) { await frameSlice(); at0 = performance.now(); }
    // Arm (+z of the model) reaches over the road: world direction (dx, 0, -dy).
    q.setFromAxisAngle(up, Math.atan2(l.dx, -l.dy));
    // Lamps stand on the sidewalk (kerb height above the ground).
    m.compose(new THREE.Vector3(l.x, terrain.at(l.x, l.y) + KERB_H, -l.y), q, one);
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
      await frameSlice();
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

let kit: Promise<{ geos: Map<string, THREE.BufferGeometry>; procedural: Map<string, THREE.BufferGeometry>; texture: THREE.Texture }> | null = null;

function loadKit() {
  kit ??= Promise.all([
    vehicleShapes(),
    new THREE.TextureLoader().loadAsync(cdn("/3d/vehicles.png")),
  ]).then(([shapes, texture]) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter; // flat colour swatches
    texture.flipY = false; // glTF uv convention
    return { geos: shapes.kit, procedural: shapes.procedural, texture };
  });
  kit.catch(() => { kit = null; });
  return kit;
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
/** The surveyed centrelines come cut at every junction and width change, often into
 * pieces of a few metres. Where exactly two pieces meet end to end with the same lane
 * count and about the same width, they are one road: join them, repeatedly. */
function stitchRoads(input: RealEstateRoad[]): RealEstateRoad[] {
  let roads = input.map(r => ({ ...r, line: r.line.map(p => [p[0], p[1]] as [number, number]) }));
  const key = ([x, y]: [number, number]) => `${Math.round(x / 1.5)},${Math.round(y / 1.5)}`;
  for (let pass = 0; pass < 50; pass++) {
    const at = new Map<string, { i: number; start: boolean }[]>();
    roads.forEach((r, i) => {
      for (const start of [true, false]) {
        const k = key(start ? r.line[0] : r.line[r.line.length - 1]);
        const l = at.get(k); if (l) l.push({ i, start }); else at.set(k, [{ i, start }]);
      }
    });
    const used = new Set<number>(), next: typeof roads = [];
    for (const ends of at.values()) {
      if (ends.length !== 2) continue;
      const [a, b] = ends;
      if (a.i === b.i || used.has(a.i) || used.has(b.i)) continue;
      const ra = roads[a.i], rb = roads[b.i];
      if (ra.lanes !== rb.lanes || Math.abs(ra.width - rb.width) > 4) continue;
      // Orient a to end at the joint and b to start there.
      const la = a.start ? [...ra.line].reverse() : ra.line, lb = b.start ? rb.line : [...rb.line].reverse();
      next.push({ line: [...la, ...lb.slice(1)], width: Math.max(ra.width, rb.width), lanes: ra.lanes });
      used.add(a.i); used.add(b.i);
    }
    if (!used.size) break;
    roads = [...roads.filter((_, i) => !used.has(i)), ...next];
  }
  return roads;
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
export function stitchedRoads(roads: RealEstateRoad[]) { return stitchRoads(roads.filter(r => r.line.length > 1)); }


export async function buildTraffic(roads: RealEstateRoad[], seed: number, hq: boolean, terrain: Terrain = FLAT) {
  const usable = stitchRoads(roads.filter(r => r.line.length > 1));
  if (!usable.length) return null;
  const { geos, texture, procedural } = await loadKit();
  // (the boxed vehicles' shapes, kept for the session: shared by every complex's traffic)
  const shape = (name: string) => procedural.get(name)!;
  // (the modelled cars where they load; else built from their proportions)
  const models = await loadCarModels().catch(err => { console.info("[3D] car models unavailable:", err); return null; });
  const rnd = rng(seed + 29);
  // Road polylines with cumulative lengths.
  const paths = usable.map(r => {
    const cum = [0];
    for (let i = 1; i < r.line.length; i++) cum.push(cum[i - 1] + Math.hypot(r.line[i][0] - r.line[i - 1][0], r.line[i][1] - r.line[i - 1][1]));
    return { ...r, cum, len: cum[cum.length - 1] };
  }).filter(p => p.len > 0.5); // short pieces stay: they carry the network across
  if (!paths.length) return null;

  const bodyMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.25 });
  // (WebGPU: clear-coated paint, dark glazing, matte tyres from the swatches)
  bodyMat.userData.carPaint = true;
  // WebGL: the same repaint as the WebGPU view (ComplexRenderer CAR_PAINT) — the body takes
  // the paint itself, glass and tyres stay; the kit's swatches read at full resolution.
  // Multiplied over the kit's red body instead, every car came out red-tinted (from afar,
  // with the swatches blended, red outright).
  bodyMat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_fragment>", `
        vec4 carTexel = textureLod(map, vMapUv, 0.0);
        float carL = dot(carTexel.rgb, vec3(0.2126, 0.7152, 0.0722));
        float carGlass = smoothstep(0.08, 0.16, carTexel.b - carTexel.r) * smoothstep(0.45, 0.65, carL);
        float carBody = (1.0 - carGlass) * smoothstep(0.02, 0.07, carL);
        // (three defines USE_INSTANCING_COLOR for the vertex stage only; the fragment stage
        // sees vColor under USE_COLOR)
        #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
        vec3 carPaint = clamp((vColor.rgb - 0.3) / 0.7, 0.0, 1.0) * 0.92;
        #else
        vec3 carPaint = carTexel.rgb;
        #endif
        diffuseColor.rgb = mix(mix(carTexel.rgb, carPaint, carBody), vec3(0.01, 0.012, 0.015), carGlass);`)
      .replace("#include <color_fragment>", "");
  };
  bodyMat.customProgramCacheKey = () => "car-paint";
  const boxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
  const lampMat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: lampMap(), emissiveIntensity: 0, roughness: 0.3 });
  // Passenger cars from their proportions (sceneCars); vans, trucks and the rest from the kit.
  // (far and by default: the cars built from their proportions; near the eye the modelled ones)
  const kit = (name: string) => carGeometry(name) ?? geos.get(name)!;
  const modelMat = models ? carModelMaterial() : null;
  const nearGeo = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  if (models) for (const name of Object.keys(CAR_SPECS)) { const g = models.get(name), f = carGeometry(name); if (g && f) nearGeo.set(f, g); }
  // [geometry, material, weight, speed factor, length, width, lamp height, repaint]
  // model: the modelled mesh near the eye (sceneCars loadCarModels); livery: its paint when
  // the kind has one colour (buses by route, trucks, containers)
  const K = (geo: THREE.BufferGeometry, mat: THREE.Material, weight: number, speed: number, dims: [number, number, number], paint = false, model?: string, livery?: string) =>
    ({ geo, mat, weight, speed, dims, paint, own: false, model, livery });
  // (emergency vehicles keep white plates; the other box-built trucks and buses are commercial)
  const officials = new Set<THREE.BufferGeometry | null>();
  const official = <G,>(g: G) => { officials.add(g as unknown as THREE.BufferGeometry); return g; };
  const d = (n: string): [number, number, number] => CAR_SPECS[n] ? [CAR_SPECS[n].length, CAR_SPECS[n].width, CAR_SPECS[n].height] : DIMS[n];
  // Mix: passenger cars about 70 %; then trucks, buses and containers.
  // (made one kind at a time, the page breathing between: all at once held it ~0.1 s)
  const makers: (() => ReturnType<typeof K>)[] = [
    // (the passenger cars: sceneCars; shares after what Korean roads carry)
    () => K(kit("sedan"), bodyMat, 12, 1, [d("sedan")[0], d("sedan")[1], 0.62], true),
    () => K(kit("sedan-large"), bodyMat, 8, 1, [d("sedan-large")[0], d("sedan-large")[1], 0.64], true),
    () => K(kit("sedan-sports"), bodyMat, 8, 1.06, [d("sedan-sports")[0], d("sedan-sports")[1], 0.58], true),
    () => K(kit("suv"), bodyMat, 10, 1, [d("suv")[0], d("suv")[1], 0.75], true),
    () => K(kit("suv-small"), bodyMat, 8, 1.02, [d("suv-small")[0], d("suv-small")[1], 0.72], true),
    () => K(kit("suv-luxury"), bodyMat, 6, 1, [d("suv-luxury")[0], d("suv-luxury")[1], 0.78], true),
    () => K(kit("hatchback-sports"), bodyMat, 5, 1.02, [d("hatchback-sports")[0], d("hatchback-sports")[1], 0.62], true),
    () => K(kit("kei-box"), bodyMat, 4, 1, [d("kei-box")[0], d("kei-box")[1], 0.66], true),
    () => K(kit("taxi"), bodyMat, 8, 1, [d("taxi")[0], d("taxi")[1], 0.62], true),
    () => K(kit("mpv"), bodyMat, 5, 0.98, [d("mpv")[0], d("mpv")[1], 0.76], true),
    () => K(kit("van"), bodyMat, 3, 0.95, [d("van")[0], d("van")[1], 0.78], true),
    () => K(kit("delivery"), bodyMat, 3, 0.9, [d("delivery")[0], d("delivery")[1], 0.8], true, "boxtruck"),
    () => K(shape("cargo-blue"), boxMat, 4, 0.9, [5.1, 1.75, 0.75], false, "cargo", "#2d5fa8"),
    () => K(shape("cargo-white"), boxMat, 2, 0.9, [5.1, 1.75, 0.75], false, "cargo", "#e9e9e6"),
    () => K(shape("bus-blue"), boxMat, 2.5, 0.8, [11, 2.5, 0.75], false, "bus", "#2a6fc4"),   // 간선 blue
    () => K(shape("bus-green"), boxMat, 2.5, 0.8, [11, 2.5, 0.75], false, "bus", "#3b9a44"),   // 지선 green
    () => K(shape("bus-red"), boxMat, 0.5, 0.85, [11, 2.5, 0.75], false, "bus", "#c8322f"),  // 광역 red
    () => K(shape("container-red"), boxMat, 0.5, 0.8, [16.2, 2.45, 0.85], false, "container", "#b2402f"),
    () => K(shape("container-blue"), boxMat, 1.6, 0.8, [16.2, 2.45, 0.85], false, "container", "#2e5e8c"),
    () => K(shape("container-orange"), boxMat, 0.5, 0.8, [16.2, 2.45, 0.85], false, "container", "#c77a2a"),
    () => K(official(shape("ambulance")), boxMat, 1.1, 1.05, [5.7, 2.02, 0.85]),
    () => K(official(shape("police")), boxMat, 1.3, 1, [4.85, 1.84, 0.62]),
    () => K(official(shape("fire")), boxMat, 0.6, 0.85, [7.5, 2.42, 1.0]),
    () => K(shape("garbage"), boxMat, 1.0, 0.75, [7.0, 2.35, 0.95], false, "garbage", "#3f8f4e"),
    () => K(shape("mixer"), boxMat, 1.2, 0.75, [8.6, 2.39, 1.0], false, "mixer", "#e8e6e0"),
    // (twenty more: construction plant, goods, service, buses, a scooter, a pickup, the yellow school van)
    ...(new URLSearchParams(location.search).get("veh") === "0" ? [] : [
    () => K(shape("dump-orange"), boxMat, 0.9, 0.75, [9.6, 2.5, 1.05]),
    () => K(shape("dump-yellow"), boxMat, 0.6, 0.75, [9.6, 2.5, 1.05]),
    () => K(shape("dump-small"), boxMat, 0.6, 0.85, [6.0, 2.0, 0.8]),
    () => K(shape("excavator"), boxMat, 0.35, 0.55, [9.0, 2.5, 0.9]),
    () => K(shape("lowbed"), boxMat, 0.25, 0.65, [17.4, 2.6, 1.0]),
    () => K(shape("cargo-crane"), boxMat, 0.5, 0.8, [8.6, 2.4, 0.95]),
    () => K(shape("mobile-crane"), boxMat, 0.25, 0.6, [13.2, 2.75, 1.0]),
    () => K(shape("pump"), boxMat, 0.3, 0.7, [12.0, 2.5, 1.0]),
    () => K(shape("wing"), boxMat, 0.9, 0.8, [9.6, 2.5, 1.0]),
    () => K(shape("tanker"), boxMat, 0.35, 0.75, [13.2, 2.48, 1.0]),
    () => K(shape("box-cooled"), boxMat, 1.4, 0.9, [5.3, 1.86, 0.75]),
    () => K(shape("box-dry"), boxMat, 1.4, 0.9, [5.3, 1.86, 0.75]),
    () => K(shape("ladder"), boxMat, 0.5, 0.85, [7.4, 1.8, 0.75]),
    () => K(shape("tow"), boxMat, 0.4, 1, [6.2, 1.95, 0.8]),
    () => K(shape("sweeper"), boxMat, 0.25, 0.5, [6.4, 2.17, 0.9]),
    () => K(shape("bus-village"), boxMat, 1.0, 0.85, [8.9, 2.3, 0.75]),
    () => K(shape("bus-coach"), boxMat, 0.6, 0.9, [12, 2.5, 0.8]),
    () => K(shape("bus-double"), boxMat, 0.35, 0.8, [12, 2.5, 0.75]),
    () => K(shape("scooter"), boxMat, 2.2, 1.05, [1.95, 0.7, 0.8]),
    () => K(kit("pickup"), bodyMat, 2.5, 1, [d("pickup")[0], d("pickup")[1], 0.78], true),
    () => K(kit("van"), bodyMat, 0.9, 0.9, [d("van")[0], d("van")[1], 0.78], false, undefined, "#f2c414"),
    ]),
  ];
  const kinds: ReturnType<typeof K>[] = [];
  let slice = performance.now();
  for (const make of makers) {
    // (a slice a kind or two: some take several ms the first time — 45 kinds now)
    if (performance.now() - slice > 4) { await frameSlice(); slice = performance.now(); }
    const k = make();
    if (k.geo) kinds.push(k);
  }
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
      const now = (deadEnd(r, true) && deadEnd(r, false) && p.len < 60) || ((deadEnd(r, true) || deadEnd(r, false)) && p.len < 30);
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
  const count = Math.min(hq ? 300 : 110, Math.round(laneMetres / 55));
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
  await frameSlice();
  const meshes = kinds.map((k, i) => instanced(k.geo, k.mat, perKind[i], true));
  // Near the eye (NEAR_M) a car is drawn from its modelled mesh: those instances are packed
  // into a second mesh per kind each frame and hidden in the far one.
  const NEAR_M = 55;
  const near = kinds.map((k, i) => {
    const g = nearGeo.get(k.geo) ?? (k.model ? models?.get(k.model) : undefined);
    if (!g || !modelMat) return null;
    const im = instanced(g, modelMat, perKind[i], true);
    im.count = 0;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, perKind[i]) * 3).fill(1), 3);
    return im;
  });
  const white = new THREE.Color("#ffffff");
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0), mm = new THREE.Matrix4(), cc = new THREE.Color(), eyeLocal = new THREE.Vector3();
  // Number plates, front and rear, on the vehicles near enough to read them (PLATE_M):
  // yellow for taxis, delivery vans, trucks and buses, white for the rest.
  const PLATE_M = 40;
  await plateAtlasReady();
  const plateMat = plateMaterial();
  const commercial = kinds.map(k => k.geo === kit("taxi") || k.geo === kit("delivery") || (k.mat === boxMat && !officials.has(k.geo)));
  await frameSlice();
  const plateGeos = kinds.map(k => {
    const spec = Object.entries(CAR_SPECS).find(([n]) => kit(n) === k.geo)?.[1];
    const L = k.dims[0], c = spec?.clearance ?? 0.3;
    // (the modelled trucks' plates: on the bumper, and under the tail lamps — gen-cars.py)
    const TRUCK: Record<string, [number, number, number, number]> = { cargo: [0.6, 0.55, 0.14, 0.05], boxtruck: [0.7, 0.7, 0.14, 0.05],
      bus: [0.45, 0.73, 0.18, 0.05], container: [0.98, 1.03, 0.14, 0.07], garbage: [0.88, 1.08, 0.14, 0.07], mixer: [0.93, 1.03, 0.14, 0.05] };
    const t = k.model ? TRUCK[k.model] : undefined;
    if (t) return plateGeometry(L, t[0], t[1], t[2], t[3]);
    return plateGeometry(L, spec ? c + 0.2 : 0.55, spec ? c + 0.35 : 0.65);
  });
  const plates = kinds.map((_, i) => {
    const im = instanced(plateGeos[i], plateMat, perKind[i], false);
    im.count = 0;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, perKind[i]) * 3), 3);
    return im;
  });
  // (each vehicle its own plate: the white and the yellow ones dealt out shuffled, no repeats
  // until a deck runs out)
  const deck = (lo: number, hi: number) => { const d = Array.from({ length: hi - lo }, (_, i) => lo + i); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };
  const whites = deck(0, PLATE_WHITE), yellows = deck(PLATE_WHITE, PLATE_COUNT);
  let wi = 0, yi = 0;
  const plateOf = cars.map(c => commercial[c.type] ? yellows[yi++ % yellows.length] : whites[wi++ % whites.length]);
  const nearNow = kinds.map(() => new Set<number>());
  const swapNear = (eye?: THREE.Vector3) => {
    if (!eye) return;
    eyeLocal.copy(eye); group.worldToLocal(eyeLocal);
    const packed = near.map(() => 0), platesN = kinds.map(() => 0);
    for (const c of cars) {
      const far = meshes[c.type];
      const pdx = c.x - eyeLocal.x, pdz = -c.y - eyeLocal.z;
      if (pdx * pdx + pdz * pdz < PLATE_M * PLATE_M) {
        far.getMatrixAt(c.slot, mm);
        const k = platesN[c.type]++;
        plates[c.type].setMatrixAt(k, mm);
        plates[c.type].setColorAt(k, cc.setRGB((plateOf[c.id] % 256) / 255, Math.floor(plateOf[c.id] / 256) / 255, 0));
      }
      const im = near[c.type];
      if (!im) continue;
      far.getMatrixAt(c.slot, mm);
      const was = nearNow[c.type].has(c.slot);
      const dx = c.x - eyeLocal.x, dz = -c.y - eyeLocal.z, isNear = dx * dx + dz * dz < NEAR_M * NEAR_M;
      if (isNear) {
        if (!was) nearNow[c.type].add(c.slot);
        const k = packed[c.type]++;
        im.setMatrixAt(k, mm);
        if (kinds[c.type].livery) im.setColorAt(k, cc.set(kinds[c.type].livery!).lerp(white, 0.3));
        else if (far.instanceColor) { far.getColorAt(c.slot, cc); im.setColorAt(k, cc); }
        far.setMatrixAt(c.slot, hidden);
      } else if (was) nearNow[c.type].delete(c.slot);
    }
    plates.forEach((im, i) => { im.count = platesN[i]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
    near.forEach((im, i) => { if (!im) return; im.count = packed[i]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
  };
  await frameSlice();
  const lampGeos = kinds.map(k => lampGeometry(k.dims[0], k.dims[1], k.dims[2]));
  const lamps = kinds.map((_, i) => { const im = instanced(lampGeos[i], lampMat, perKind[i], false); im.visible = false; return im; });
  let lampsOn = false;
  // Body colours for the Kenney cars vary through the per-instance colour.
  // Colours by their share of Korean registrations: white and pearl about a third, greys a
  // fifth, black a sixth, silver, blue; red, beige, brown and green only now and then.
  const paintShares: [string, number][] = [
    ["#f7f7f5", 20], ["#ecebe6", 13], ["#6b6e72", 10], ["#4a4d51", 10], ["#141518", 17], ["#b9bcc0", 8],
    ["#223a5e", 4], ["#3d5f86", 2], ["#7a1c22", 3], ["#c8bca6", 3], ["#5a4336", 2], ["#2f4436", 2], ["#9a9d8f", 2]];
  const paintTotal = paintShares.reduce((t, [, w]) => t + w, 0);
  const paintPick = () => { let r = rnd() * paintTotal; for (const [c, w] of paintShares) { r -= w; if (r <= 0) return c; } return paintShares[0][0]; };
  // (taxis in the city's liveries: orange, white, silver)
  const taxiPaints = ["#e8772a", "#f2f2f0", "#c9ccd0", "#f2f2f0", "#c9ccd0"];
  // (delivery vans: white, silver, the odd blue)
  const vanPaints = ["#f4f4f2", "#f4f4f2", "#c9ccd0", "#2d5fa8"];
  const taxiKind = kinds.findIndex(k => k.geo === kit("taxi")), deliveryKind = kinds.findIndex(k => k.geo === kit("delivery"));
  await frameSlice();
  cars.forEach(c => {
    // (one colour for every car of a kind: the school vans' yellow)
    const fixed = kinds[c.type].mat === bodyMat && !kinds[c.type].paint ? kinds[c.type].livery : undefined;
    if (fixed) { meshes[c.type].setColorAt(c.slot, new THREE.Color(fixed)); return; }
    if (!kinds[c.type].paint) return;
    const colour = c.type === taxiKind ? taxiPaints[Math.floor(rnd() * taxiPaints.length)]
      : c.type === deliveryKind ? vanPaints[Math.floor(rnd() * vanPaints.length)] : paintPick();
    meshes[c.type].setColorAt(c.slot, new THREE.Color(colour).lerp(new THREE.Color("#ffffff"), 0.3));
  });
  meshes.forEach(m => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const qp = new THREE.Quaternion(), across = new THREE.Vector3(1, 0, 0);
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
    // On the terrain, pitched to the slope under its wheelbase.
    const reach = c.length * 0.35;
    const hf = terrain.at(c.x + c.hx * reach, c.y + c.hy * reach), hb = terrain.at(c.x - c.hx * reach, c.y - c.hy * reach);
    q.setFromAxisAngle(up, Math.atan2(c.hx, -c.hy)).multiply(qp.setFromAxisAngle(across, -Math.atan2(hf - hb, 2 * reach)));
    m4.compose(v.set(c.x, (hf + hb) / 2 + 0.02, -c.y), q, one);
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
  // (an intersection a slice: all the heads at once were ~50 ms of a frame)
  for (let ni = 0; ni < clusters.length; ni++) {
    if (!signals[ni]) continue;
    await frameSlice();
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
      const gy = terrain.at(px, py) + KERB_H;
      staticParts.push(colored(poleG, "#6b7076", tm.makeTranslation(px, gy, -py)));
      const armG = new THREE.BoxGeometry(0.1, 0.1, armLen);
      const armAt = new THREE.Matrix4().makeBasis(L.clone().negate().cross(U).negate(), U, L.clone().negate()).setPosition((px + hxW) / 2, gy + 6.45, -(py + hyW) / 2);
      staticParts.push(colored(armG, "#6b7076", armAt)); armG.dispose();
      basis.makeBasis(L, U, H).setPosition(hxW, gy + 6.2, -hyW);
      staticParts.push(colored(housingG, "#16181b", basis));
      staticParts.push(colored(visorG, "#16181b", tm.copy(basis).multiply(new THREE.Matrix4().makeTranslation(0, 0.23, -0.2))));
      for (const x of LAMP_X) staticParts.push(colored(lensG, "#2a2c2f", tm.copy(basis).multiply(new THREE.Matrix4().makeTranslation(x, 0, -0.16))));
      heads.push({ ni, key: `${road}:${e.atStart}`, light: null });
      headMats.push(basis.clone());
    }
  }
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
  group.userData.traffic = { cars, paths, nodes, nodeOf, trimAt, clusters, idle, internal, drawn: roads.length }; // inspection in dev tools

  return {
    group,
    /** eye: the camera's world position (the cars near it get their modelled mesh). */
    update(dt: number, eye?: THREE.Vector3) {
      step(Math.min(0.1, dt));
      swapNear(eye);
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
      near.forEach(m => m?.dispose()); modelMat?.dispose();
      plates.forEach(m => m.dispose()); plateGeos.forEach(g => g.dispose()); plateMat.dispose();
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
