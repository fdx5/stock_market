import * as THREE from "three";
import { Batcher, boxUV, mergeMeshChildren, rectMinusHoles, RoundedBoxGeometry } from "./geom";
import type { Palette } from "./materials";
import { middleDoorBars, variantOf } from "./variants";
import type { FloorPlan, Opening, Room } from "./plan/types";

/* The shell of a flat from its plan: each room's own four wall faces (set in by half a wall from the
 * plan's centre lines), floor and ceiling, holes cut for the openings with their reveals, sills and
 * thresholds; door and window joinery; the walls as segments for walking into. */

export const HALF_WALL = 0.075;
const EXT_DEPTH = 0.2;   // the outer wall beyond the inner half (a window's reveal is that deep)

export type Seg = [number, number, number, number];
type SideName = "n" | "s" | "w" | "e";
interface Side { name: SideName; line: number; axis: "x" | "z"; lo: number; hi: number; inward: THREE.Vector3; along: THREE.Vector3; at(a: number, y: number, d: number): THREE.Vector3 }

export interface DoorRig {
  opening: Opening; kind: "swing" | "slide" | "front";
  pivot: THREE.Object3D; leaf: THREE.Object3D;
  /** 0 shut … 1 open, and where it is heading */
  t: number; want: number;
  closedYaw: number; openYaw: number;
  /** the leaf's span (for the walking collision): hinge point and length */
  hinge: [number, number]; length: number;
  slideFrom?: THREE.Vector3; slideTo?: THREE.Vector3; fixedSeg?: Seg;
  label: string; zone: number;
}
export interface WindowInfo { opening: Opening; room: Room; zone: number; center: THREE.Vector3; inward: THREE.Vector3; along: THREE.Vector3; width: number; height: number; bottom: number }
export interface CeilingLight { room: Room; zone: number; kind: "panel" | "coffer" | "bath" | "down" | "linear"; pos: THREE.Vector3; w: number; h: number }

export interface Shell {
  zones: Map<string, number>;
  segments: Seg[];
  doors: DoorRig[];
  windows: WindowInfo[];
  ceilingLights: CeilingLight[];
  /** emissive meshes of each zone's lamps (dimmed with their switch) */
  lampMeshes: Map<number, THREE.MeshPhysicalMaterial[]>;
  floorAt(x: number, z: number): number;
  roomAt(x: number, z: number): Room | null;
  H: number;
}

function sidesOf(r: Room): Side[] {
  const [x0, z0, x1, z1] = r.rect, X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  return [
    { name: "n", line: z0, axis: "z", lo: x0, hi: x1, inward: Z.clone(), along: X.clone(), at: (a, y, d) => new THREE.Vector3(a, y, z0 + d) },
    { name: "s", line: z1, axis: "z", lo: x0, hi: x1, inward: Z.clone().negate(), along: X.clone(), at: (a, y, d) => new THREE.Vector3(a, y, z1 - d) },
    { name: "w", line: x0, axis: "x", lo: z0, hi: z1, inward: X.clone(), along: Z.clone(), at: (a, y, d) => new THREE.Vector3(x0 + d, y, a) },
    { name: "e", line: x1, axis: "x", lo: z0, hi: z1, inward: X.clone().negate(), along: Z.clone(), at: (a, y, d) => new THREE.Vector3(x1 - d, y, a) },
  ];
}

/** a quad with its corners ordered to face `n` */
function quadAuto(B: Batcher, m: THREE.Material, zone: number, p: THREE.Vector3[], n: THREE.Vector3, uv: [number, number][]) {
  const c = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[3], p[0]));
  if (c.dot(n) < 0) { B.quad(m, zone, [p[0], p[3], p[2], p[1]], n, [uv[0], uv[3], uv[2], uv[1]]); return; }
  B.quad(m, zone, p, n, uv);
}

const isDoorish = (o: Opening) => o.type === "door" || o.type === "front_door" || o.type === "glass_door" || o.type === "open";

export function buildShell(plan: FloorPlan, P: Palette, B: Batcher, dynamic: THREE.Group): Shell {
  /** the 중문's frosted glass, when its style has it */
  let frosted: THREE.MeshBasicMaterial | null = null;
  const H = plan.ceilingHeightM, e = HALF_WALL;
  const zones = new Map<string, number>();
  for (const r of plan.rooms) if (!zones.has(r.zone)) zones.set(r.zone, zones.size + 1);
  const zoneOf = (r: Room) => zones.get(r.zone)!;
  const byId = new Map(plan.rooms.map(r => [r.id, r]));
  const segments: Seg[] = [], doors: DoorRig[] = [], windows: WindowInfo[] = [], ceilingLights: CeilingLight[] = [];
  const lampMeshes = new Map<number, THREE.MeshPhysicalMaterial[]>();
  // each zone's lamps their own material (a switch dims only its room's)
  const lampMats = new Map<string, THREE.MeshPhysicalMaterial>();
  // (one material for every room's lamps: the shader dims each by its vertices' zone — lightZones.ts)
  const lampMat = (_zone: number, base: THREE.MeshPhysicalMaterial) => base;
  void lampMats;
  const wet = (r: Room) => r.type === "bathroom" || r.type === "ensuite" || r.type === "restroom";
  // (a building's public floors — its lobby, corridors, waiting areas, galleries, its shops — in the
  // stone of the main floor; its work rooms in the rooms' floor)
  const PUBLIC = new Set<string>(["lobby", "corridor", "liftHall", "waiting", "service", "gallery", "shop", "cafe", "pharmacy"]);
  const floorMat = (r: Room) => wet(r) || r.type === "utility" ? P.floorWet : r.type === "entrance" ? P.floorEntry
    : r.type === "living" || r.type === "kitchen" || r.type === "hall" || PUBLIC.has(r.type) ? P.floorMain : P.floorRoom;
  // the living room's 아트월: its side wall without openings (the TV goes there)
  const living = plan.rooms.find(r => r.type === "living");
  const accentSide = living ? sidesOf(living).filter(s => s.axis === "x").find(s => !plan.openings.some(o => (o.a === living.id || o.b === living.id) && o.axis === "x" && Math.abs(o.at - s.line) < 1e-6))?.name : undefined;
  // (a building's lift hall in stone round its lift doors, its lobby's side walls likewise)
  const wallMat = (r: Room, s: Side) => wet(r) ? P.wallWet : r === living && s.name === accentSide ? P.wallAccent
    : (r.type === "liftHall" && s.name === "s") || (r.type === "lobby" && (s.name === "w" || s.name === "e")) || featureWall(r, s) ? P.wallAccent : P.wall;
  // (a building's rooms: some with one wall in the feature finish — which, by the room)
  function featureWall(r: Room, s: Side) {
    if (!plan.facility || !["office", "meeting", "cafe", "shop", "classroom", "consult", "waiting", "guest", "openOffice", "staffroom"].includes(r.type)) return false;
    const h = [...`${plan.complexId}|${plan.floor}|${r.id}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0;
    return h % 3 !== 0 && ["n", "s", "w", "e"][h % 4] === s.name;
  }
  const facility = !!plan.facility;
  /** a zone of several rooms: its one light (from its lead room), or none from the others */
  let lightOnce: { x: number; z: number; w: number; h: number } | null | undefined;
  const pushLight = (l: CeilingLight) => {
    if (lightOnce === undefined) { ceilingLights.push(l); return; }
    if (lightOnce) { ceilingLights.push({ ...l, kind: "panel", pos: new THREE.Vector3(lightOnce.x, H - 0.05, lightOnce.z), w: Math.max(0.5, lightOnce.w), h: Math.max(0.5, lightOnce.h) }); lightOnce = null; }
  };

  for (const r of plan.rooms) {
    const zone = zoneOf(r), fy = -(r.floorDrop ?? 0);
    const [x0, z0, x1, z1] = r.rect;
    for (const s of sidesOf(r)) {
      const ops = plan.openings.filter(o => (o.a === r.id || o.b === r.id) && o.axis === s.axis && Math.abs(o.at - s.line) < 1e-6);
      const lo = s.lo + e, hi = s.hi - e;
      const holes: [number, number, number, number][] = [];
      const mat = wallMat(r, s);
      for (const o of ops) {
        const a0 = Math.max(lo, o.center - o.width / 2), a1 = Math.min(hi, o.center + o.width / 2);
        if (a1 - a0 < 0.05) continue;
        const bottom = o.type === "open" ? Math.max(fy, 0) : o.sill, top = Math.min(H, o.sill + o.height);
        const bot = o.type === "open" || o.type === "glass_door" ? (r.floorDrop ? 0 : fy) : bottom;
        holes.push([a0, a1, bot, top >= H - 0.01 ? H + 1 : top]);
        // reveals: drawn once, from the opening's first room
        if (o.a !== r.id) continue;
        const out = o.b === "out";
        const dIn = e, dOut = out ? -(e + EXT_DEPTH) : -e;
        const revealMat = isDoorish(o) && o.type !== "open" ? P.doorFrame : mat;
        const yTop = Math.min(H, top), yBot = bot;
        // jambs (facing into the hole)
        for (const [a, sign] of [[a0, 1], [a1, -1]] as [number, number][]) {
          const n = s.along.clone().multiplyScalar(sign);
          quadAuto(B, revealMat, zone, [s.at(a, yBot, dIn), s.at(a, yBot, dOut), s.at(a, yTop, dOut), s.at(a, yTop, dIn)], n, [[dIn, yBot], [dOut, yBot], [dOut, yTop], [dIn, yTop]]);
        }
        if (top < H - 0.01) quadAuto(B, revealMat, zone, [s.at(a0, top, dIn), s.at(a1, top, dIn), s.at(a1, top, dOut), s.at(a0, top, dOut)], new THREE.Vector3(0, -1, 0), [[a0, dIn], [a1, dIn], [a1, dOut], [a0, dOut]]);
        // sill / threshold
        const sillMat = out ? P.sill : (byId.get(o.b)?.type === "bathroom" || byId.get(o.b)?.type === "ensuite" || wet(r) || o.type === "glass_door") ? P.threshold : floorMat(r);
        const sy = out ? o.sill : Math.max(bot, 0) > 0 ? bot : 0;
        if (out && o.sill > 0.05) {
          // a marble sill a little proud of the wall
          const g = boxUV(new THREE.BoxGeometry(a1 - a0 + 0.06, 0.025, e - dOut + 0.04));
          const c = s.at((a0 + a1) / 2, o.sill - 0.0125, (dIn + dOut) / 2 + 0.02);
          B.add(sillMat, zone, g, new THREE.Matrix4().makeRotationY(s.axis === "x" ? Math.PI / 2 : 0).setPosition(c));
          g.dispose();
        } else quadAuto(B, sillMat, zone, [s.at(a0, sy, dIn), s.at(a1, sy, dIn), s.at(a1, sy, dOut), s.at(a0, sy, dOut)], new THREE.Vector3(0, 1, 0), [[a0, dIn], [a1, dIn], [a1, dOut], [a0, dOut]]);
        joinery(o, s, r, a0, a1, bot, top, zone);
      }
      // the wall face
      for (const [a0, a1, y0, y1] of rectMinusHoles(lo, hi, fy, H, holes)) {
        quadAuto(B, mat, zone, [s.at(a0, y0, e), s.at(a1, y0, e), s.at(a1, y1, e), s.at(a0, y1, e)], s.inward, [[a0, y0], [a1, y0], [a1, y1], [a0, y1]]);
      }
      // 걸레받이 along the floor (not across doorways), none on tiled walls
      if (!wet(r)) {
        const gaps = holes.filter(h => h[2] <= fy + 0.05).map(h => [h[0], h[1]] as [number, number]).sort((p, q) => p[0] - q[0]);
        let a = lo;
        const runs: [number, number][] = [];
        for (const [g0, g1] of gaps) { if (g0 > a) runs.push([a, g0]); a = Math.max(a, g1); }
        if (hi > a) runs.push([a, hi]);
        for (const [b0, b1] of runs) {
          if (b1 - b0 < 0.02) continue;
          const t = 0.012, h = 0.07;
          quadAuto(B, P.trim, zone, [s.at(b0, fy, e + t), s.at(b1, fy, e + t), s.at(b1, fy + h, e + t), s.at(b0, fy + h, e + t)], s.inward, [[b0, 0], [b1, 0], [b1, h], [b0, h]]);
          quadAuto(B, P.trim, zone, [s.at(b0, fy + h, e + t), s.at(b1, fy + h, e + t), s.at(b1, fy + h, e), s.at(b0, fy + h, e)], new THREE.Vector3(0, 1, 0), [[b0, 0], [b1, 0], [b1, t], [b0, t]]);
        }
      }
      // collision: the face's solid runs at walking height (doorways passable; doors added live)
      const pass = ops.filter(o => isDoorish(o) && o.type !== "front_door").map(o => [Math.max(lo, o.center - o.width / 2), Math.min(hi, o.center + o.width / 2)] as [number, number]).sort((p, q) => p[0] - q[0]);
      let a = lo - 0.0;
      const solid: [number, number][] = [];
      for (const [g0, g1] of pass) { if (g0 > a) solid.push([a, g0]); a = Math.max(a, g1); }
      if (hi > a) solid.push([a, hi]);
      for (const [b0, b1] of solid) { const p = s.at(b0, 0, e), q = s.at(b1, 0, e); segments.push([p.x, p.z, q.x, q.z]); }
    }
    // floor
    quadAuto(B, floorMat(r), zone, [new THREE.Vector3(x0 + e, fy, z0 + e), new THREE.Vector3(x1 - e, fy, z0 + e), new THREE.Vector3(x1 - e, fy, z1 - e), new THREE.Vector3(x0 + e, fy, z1 - e)], new THREE.Vector3(0, 1, 0),
      [[x0 + e, -(z0 + e)], [x1 - e, -(z0 + e)], [x1 - e, -(z1 - e)], [x0 + e, -(z1 - e)]]);
    ceiling(r, zone);
  }

  // ---------------------------------------------------------------- ceilings and their lamps
  function ceiling(r: Room, zone: number) {
    const [x0, z0, x1, z1] = r.rect, X0 = x0 + e, X1 = x1 - e, Z0 = z0 + e, Z1 = z1 - e, W = X1 - X0, D = Z1 - Z0;
    const down = new THREE.Vector3(0, -1, 0), cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const ceilQuads = (holes: [number, number, number, number][], y: number) => {
      for (const [a0, a1, b0, b1] of rectMinusHoles(X0, X1, Z0, Z1, holes))
        quadAuto(B, P.ceiling, zone, [new THREE.Vector3(a0, y, b0), new THREE.Vector3(a1, y, b0), new THREE.Vector3(a1, y, b1), new THREE.Vector3(a0, y, b1)], down, [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]);
    };
    if (r.type === "living" && W > 2.6 && D > 2.6) {
      // 우물천장: a recess with hidden cove light round its lip, and 매입등 round the room
      const m = 0.5, R0 = X0 + m, R1 = X1 - m, S0 = Z0 + m, S1 = Z1 - m, up = 0.14;
      ceilQuads([[R0, R1, S0, S1]], H);
      quadAuto(B, P.ceiling, zone, [new THREE.Vector3(R0, H + up, S0), new THREE.Vector3(R1, H + up, S0), new THREE.Vector3(R1, H + up, S1), new THREE.Vector3(R0, H + up, S1)], down, [[R0, S0], [R1, S0], [R1, S1], [R0, S1]]);
      const sides: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
        [new THREE.Vector3(R0, 0, S0), new THREE.Vector3(R1, 0, S0), new THREE.Vector3(0, 0, 1)], [new THREE.Vector3(R1, 0, S1), new THREE.Vector3(R0, 0, S1), new THREE.Vector3(0, 0, -1)],
        [new THREE.Vector3(R0, 0, S1), new THREE.Vector3(R0, 0, S0), new THREE.Vector3(1, 0, 0)], [new THREE.Vector3(R1, 0, S0), new THREE.Vector3(R1, 0, S1), new THREE.Vector3(-1, 0, 0)],
      ];
      for (const [p, q, n] of sides) {
        const P0 = p.clone().setY(H), P1 = q.clone().setY(H), P2 = q.clone().setY(H + up), P3 = p.clone().setY(H + up);
        quadAuto(B, P.ceiling, zone, [P0, P1, P2, P3], n, [[0, H], [1, H], [1, H + up], [0, H + up]]);
        // the LED strip: a thin bright band at the top of the recess wall
        const Q0 = p.clone().setY(H + up - 0.03).addScaledVector(n, 0.002), Q1 = q.clone().setY(H + up - 0.03).addScaledVector(n, 0.002);
        quadAuto(B, lampMat(zone, P.ledWarm), zone, [Q0, Q1, Q1.clone().setY(H + up - 0.005), Q0.clone().setY(H + up - 0.005)], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      ceilingLights.push({ room: r, zone, kind: "coffer", pos: new THREE.Vector3(cx, H + up - 0.02, cz), w: R1 - R0, h: S1 - S0 });
      // 매입등 (downlights) along the long sides
      const n = Math.max(2, Math.round(W / 1.3));
      for (const zz of [Z0 + 0.28, Z1 - 0.28]) for (let i = 0; i < n; i++) downlight(X0 + (W / n) * (i + 0.5), zz, zone);
      return;
    }
    ceilQuads([], H);
    // (a drawn floor's many rooms: one lamp's light a zone — the scene's area lights are few — over
    // the whole of the zone, from its biggest room)
    const zoneRooms = facility ? plan.rooms.filter(q => q.zone === r.zone) : [r];
    const big = zoneRooms.length > 1;
    if (big) {
      const ar = (q: Room) => (q.rect[2] - q.rect[0]) * (q.rect[3] - q.rect[1]);
      const lead = zoneRooms.reduce((a, b) => ar(b) > ar(a) ? b : a);
      const zx0 = Math.min(...zoneRooms.map(q => q.rect[0])), zz0 = Math.min(...zoneRooms.map(q => q.rect[1])), zx1 = Math.max(...zoneRooms.map(q => q.rect[2])), zz1 = Math.max(...zoneRooms.map(q => q.rect[3]));
      const pushed = ceilingLights.length;
      lightOnce = lead === r ? { x: (zx0 + zx1) / 2, z: (zz0 + zz1) / 2, w: (zx1 - zx0) * 0.4, h: (zz1 - zz0) * 0.4 } : null;
      void pushed;
    } else lightOnce = undefined;
    if (facility && r.type !== "restroom") {
      // a building's ceilings: 600 mm LED panels in a grid (a corridor's a line of downlights, a
      // gallery's and a shop's track spots, a car park's batten tubes)
      if (r.type === "corridor" || r.type === "liftHall" || r.type === "stair") {
        const n = Math.max(1, Math.round(Math.max(W, D) / 2.4));
        for (let i = 0; i < n; i++) W > D ? downlight(X0 + (W / n) * (i + 0.5), cz, zone) : downlight(cx, Z0 + (D / n) * (i + 0.5), zone);
        pushLight({ room: r, zone, kind: "down", pos: new THREE.Vector3(cx, H - 0.01, cz), w: Math.max(0.4, W * 0.45), h: Math.max(0.4, D * 0.45) });
        return;
      }
      if (r.type === "parking" || r.type === "plant" || r.type === "storage") {
        const nx = Math.max(1, Math.round(W / 4)), nz = Math.max(1, Math.round(D / 3));
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) panel(X0 + (W / nx) * (i + 0.5), Z0 + (D / nz) * (j + 0.5), 1.2, 0.08, zone);
        // (a car park's deck: lit in parts — one lamp for all of it would leave it dim)
        const gx = r.type === "parking" ? Math.min(4, Math.max(1, Math.round(W / 8))) : 1, gz = r.type === "parking" ? 2 : 1;
        for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++)
          pushLight({ room: r, zone, kind: "panel", pos: new THREE.Vector3(X0 + (W / gx) * (i + 0.5), H - 0.05, Z0 + (D / gz) * (j + 0.5)), w: W * 0.4 / gx, h: D * 0.4 / gz });
        return;
      }
      const step = r.type === "gallery" || r.type === "shop" || r.type === "cafe" ? 2.0 : 2.4;
      const nx = Math.max(1, Math.round(W / step)), nz = Math.max(1, Math.round(D / step));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = X0 + (W / nx) * (i + 0.5), z = Z0 + (D / nz) * (j + 0.5);
        if (r.type === "gallery" || r.type === "cafe") downlight(x, z, zone); else panel(x, z, 0.58, 0.58, zone);
      }
      pushLight({ room: r, zone, kind: "panel", pos: new THREE.Vector3(cx, H - 0.05, cz), w: Math.max(0.5, W * 0.4), h: Math.max(0.5, D * 0.4) });
      return;
    }
    if (r.type === "hall" || r.type === "entrance" || r.type === "dressroom" || r.type === "utility") {
      const n = Math.max(1, Math.round(Math.max(W, D) / 1.6));
      for (let i = 0; i < n; i++) W > D ? downlight(X0 + (W / n) * (i + 0.5), cz, zone) : downlight(cx, Z0 + (D / n) * (i + 0.5), zone);
      ceilingLights.push({ room: r, zone, kind: "down", pos: new THREE.Vector3(cx, H - 0.01, cz), w: Math.max(0.3, W * 0.5), h: Math.max(0.3, D * 0.5) });
      return;
    }
    if (wet(r)) {
      // a square panel light and the fan's grille
      panel(cx, cz, 0.32, 0.32, zone);
      const g = boxUV(new RoundedBoxGeometry(0.24, 0.02, 0.24, 2, 0.008));
      B.add(P.plastic, zone, g, new THREE.Matrix4().makeTranslation(X1 - 0.35, H - 0.01, Z0 + 0.35));
      g.dispose();
      (facility ? pushLight : (l: CeilingLight) => ceilingLights.push(l))({ room: r, zone, kind: "bath", pos: new THREE.Vector3(cx, H - 0.03, cz), w: 0.32, h: 0.32 });
      return;
    }
    if (r.type === "kitchen") {
      // a long LED line over the counter side, the dining pendants come with the table
      const lw = Math.min(1.6, W * 0.45);
      panel(cx, Z0 + Math.min(1.2, D * 0.35), lw, 0.12, zone);
      ceilingLights.push({ room: r, zone, kind: "linear", pos: new THREE.Vector3(cx, H - 0.04, Z0 + Math.min(1.2, D * 0.35)), w: lw, h: 0.12 });
      return;
    }
    // 방등: a flat square LED fixture
    const s = Math.min(0.62, Math.min(W, D) * 0.22);
    panel(cx, cz, s, s, zone);
    ceilingLights.push({ room: r, zone, kind: "panel", pos: new THREE.Vector3(cx, H - 0.05, cz), w: s, h: s });
  }
  function panel(x: number, z: number, w: number, d: number, zone: number) {
    const body = boxUV(new RoundedBoxGeometry(w + 0.03, 0.045, d + 0.03, 2, 0.012));
    B.add(P.trim, zone, body, new THREE.Matrix4().makeTranslation(x, H - 0.0225, z));
    body.dispose();
    const lens = new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2);
    B.add(lampMat(zone, P.ledPanel), zone, lens, new THREE.Matrix4().makeTranslation(x, H - 0.046, z), false);
    lens.dispose();
  }
  function downlight(x: number, z: number, zone: number) {
    const ring = new THREE.RingGeometry(0.045, 0.058, 24).rotateX(Math.PI / 2);
    B.add(P.trim, zone, ring, new THREE.Matrix4().makeTranslation(x, H - 0.002, z), false);
    ring.dispose();
    const disc = new THREE.CircleGeometry(0.045, 24).rotateX(Math.PI / 2);
    B.add(lampMat(zone, P.ledPanel), zone, disc, new THREE.Matrix4().makeTranslation(x, H - 0.004, z), false);
    disc.dispose();
  }

  // ---------------------------------------------------------------- doors and windows
  function joinery(o: Opening, s: Side, r: Room, a0: number, a1: number, bot: number, top: number, zone: number) {
    const w = a1 - a0, mid = (a0 + a1) / 2, yaw = s.axis === "z" ? 0 : -Math.PI / 2;
    const rot = new THREE.Matrix4().makeRotationY(yaw);
    // a box in the opening's frame: u along the wall, y up, d across (+ into room a)
    const box = (m: THREE.Material, u: number, y: number, d: number, su: number, sy: number, sd: number, cast = true) => {
      const g = boxUV(new THREE.BoxGeometry(su, sy, sd));
      const p = s.at(u, y, d), M = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().setPosition(p), rot);
      // (sidesOf's "at" flips d on the s and e sides: the box is symmetric, only its centre moves)
      B.add(m, zone, g, M, cast);
      g.dispose();
    };
    if (o.type === "window" || o.type === "balcony_window") {
      const h = top - bot, inner = -(e + 0.03), outer = -(e + 0.15);
      for (const d of [inner, outer]) {
        const f = 0.06;
        box(P.winFrame, mid, bot + f / 2, d, w, f, 0.09); box(P.winFrame, mid, top - f / 2, d, w, f, 0.09);
        box(P.winFrame, a0 + f / 2, (bot + top) / 2, d, f, h, 0.09); box(P.winFrame, a1 - f / 2, (bot + top) / 2, d, f, h, 0.09);
        // two sashes on two tracks, overlapping at the middle
        const sw = (w - 2 * f) / 2 + 0.03, sf = 0.05;
        for (const [k, dd] of [[0, 0.022], [1, -0.022]] as [number, number][]) {
          const cu = k === 0 ? a0 + f + sw / 2 : a1 - f - sw / 2, y0 = bot + f, y1 = top - f, sh = y1 - y0;
          box(P.winFrame, cu, y0 + sf / 2, d + dd, sw, sf, 0.035); box(P.winFrame, cu, y1 - sf / 2, d + dd, sw, sf, 0.035);
          box(P.winFrame, cu - sw / 2 + sf / 2, (y0 + y1) / 2, d + dd, sf, sh, 0.035); box(P.winFrame, cu + sw / 2 - sf / 2, (y0 + y1) / 2, d + dd, sf, sh, 0.035);
          const gq = new THREE.PlaneGeometry(sw - 2 * sf, sh - 2 * sf);
          const p = s.at(cu, (y0 + y1) / 2, d + dd);
          B.add(P.glass, zone, gq, new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().setPosition(p), rot), false);
          gq.dispose();
        }
      }
      const c = s.at(mid, (bot + top) / 2, inner);
      windows.push({ opening: o, room: r, zone, center: c, inward: s.inward.clone(), along: s.along.clone(), width: w, height: h, bottom: bot });
      return;
    }
    if (o.type === "open") return;
    // casing (문선) on both faces
    const cw = 0.065, ct = 0.014;
    for (const d of [e + ct / 2, -e - ct / 2]) {
      const ext = o.b === "out" && d < 0;
      if (ext) continue;
      box(P.doorFrame, a0 - cw / 2, (bot + top) / 2 + cw / 2 - 0.0, d, cw, top - bot + cw, ct);
      box(P.doorFrame, a1 + cw / 2, (bot + top) / 2 + cw / 2 - 0.0, d, cw, top - bot + cw, ct);
      box(P.doorFrame, mid, top + cw / 2, d, w + 2 * cw, cw, ct);
    }
    const label = o.type === "front_door" ? (facility ? "출입문" : "현관문") : o.type === "glass_door" ? "중문" : `${(byId.get(o.a === "out" ? o.b : o.a) ?? r).label} 문`;
    if (o.type === "glass_door") {
      // 중문: a fixed and a sliding panel — slim black aluminium, an oak frame with frosted glass, a
      // bronze grid or a white full-height frame (the flat's own: variants.ts)
      const pw = w / 2 + 0.04, ph = top - bot - 0.01;
      const spec = middleDoorBars(variantOf(`${plan.complexId}|${plan.dong}|${plan.floor}|${plan.style}`, "middledoor", 4)), FM = P[spec.m];
      const glassM = spec.frosted ? frosted ??= Object.assign((P.glass as THREE.MeshBasicMaterial).clone(), { opacity: 0.6 }) : P.glass;
      const mk = () => {
        const g = new THREE.Group();
        const f = spec.f, add = (m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const me = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); me.position.set(x, y, z); me.castShadow = true; g.add(me); };
        add(FM, 0, f / 2, 0, pw, f, 0.035); add(FM, 0, ph - f / 2, 0, pw, f, 0.035);
        add(FM, -pw / 2 + f / 2, ph / 2, 0, f, ph, 0.035); add(FM, pw / 2 - f / 2, ph / 2, 0, f, ph, 0.035);
        for (const r of spec.rails) add(FM, 0, ph * r, 0, pw - 2 * f, 0.012 + (spec.f > 0.05 ? 0.04 : 0), 0.03);
        for (const sx of spec.stiles) add(FM, sx * (pw - 2 * f), ph / 2, 0, 0.012, ph - 2 * f, 0.03);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(pw - 2 * f, ph - 2 * f), glassM); gl.position.set(0, ph / 2, 0); g.add(gl);
        add(spec.m === "woodLight" ? P.handle : FM, pw / 2 - 0.07 - f / 2, 1.0, 0.03, 0.02, 0.5, 0.02);
        mergeMeshChildren(g);
        return g;
      };
      const fixed = mk(), slide = mk();
      const pf = s.at(a0 + pw / 2, bot, 0.025), ps = s.at(a1 - pw / 2, bot, -0.025), pOpen = s.at(a0 + pw / 2 + 0.04, bot, -0.025);
      fixed.position.copy(pf); fixed.rotation.y = yaw; slide.position.copy(ps); slide.rotation.y = yaw;
      const pivot = new THREE.Group(); pivot.add(fixed, slide); dynamic.add(pivot);
      const fp0 = s.at(a0, 0, 0), fp1 = s.at(a0 + pw, 0, 0);
      doors.push({ opening: o, kind: "slide", pivot, leaf: slide, t: 1, want: 1, closedYaw: 0, openYaw: 0, hinge: [0, 0], length: pw, slideFrom: ps.clone(), slideTo: pOpen.clone(), fixedSeg: [fp0.x, fp0.z, fp1.x, fp1.z], label, zone });
      slide.position.copy(pOpen);
      return;
    }
    // a hinged leaf
    const front = o.type === "front_door";
    const lw = w - 0.012, lh = top - bot - 0.008, th = front ? 0.06 : 0.038;
    const pivot = new THREE.Group(), leaf = new THREE.Group();
    const glassy = facility && (front || byId.get(o.a)?.type === "shop");
    if (glassy) {
      // a building's way in: a pair of framed glass doors, one standing, one that swings
      const half = lw / 2, f = 0.07;
      const glassLeaf = (into: THREE.Group, x0: number) => {
        const g = new THREE.Group(), add = (m: THREE.Material, x: number, y: number, sx: number, sy: number, sz: number) => { const me = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); me.position.set(x, y, 0); me.castShadow = true; g.add(me); };
        add(P.blackMetal, x0 + half / 2, f / 2, half, f, 0.05); add(P.blackMetal, x0 + half / 2, lh - f / 2, half, f, 0.05);
        add(P.blackMetal, x0 + f / 2, lh / 2, f, lh, 0.05); add(P.blackMetal, x0 + half - f / 2, lh / 2, f, lh, 0.05);
        add(P.chrome, x0 + half - 0.12, 1.05, 0.03, 0.9, 0.08);
        mergeMeshChildren(g); into.add(g);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(half - 2 * f, lh - 2 * f), P.glass); gl.position.set(x0 + half / 2, lh / 2, 0); into.add(gl);
      };
      glassLeaf(leaf, 0);
      // (the standing leaf: in the batches, beside the hinged one)
      const still = new THREE.Group(); glassLeaf(still, 0);
      const sp = s.at(o.hinge === "end" ? a0 + 0.006 : a1 - 0.006 - half, bot + 0.004, 0);
      still.position.copy(sp); still.rotation.y = yaw; dynamic.add(still);
    } else {
      const slab = new THREE.Mesh(boxUV(new RoundedBoxGeometry(lw, lh, th, 2, 0.004)), front ? P.frontDoor : P.door);
      slab.castShadow = slab.receiveShadow = true; slab.position.set(lw / 2, lh / 2, 0); leaf.add(slab);
    }
    // lever handles both sides (a digital lock inside the front door)
    for (const side of glassy ? [] : [1, -1]) {
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 24).rotateX(Math.PI / 2), P.handle); rose.position.set(lw - 0.065, 1.0 - bot, side * (th / 2 + 0.006));
      const lever = new THREE.Mesh(boxUV(new RoundedBoxGeometry(0.13, 0.018, 0.018, 2, 0.008)), P.handle); lever.position.set(lw - 0.115, 1.0 - bot, side * (th / 2 + 0.05));
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.045, 12).rotateX(Math.PI / 2), P.handle); neck.position.set(lw - 0.065, 1.0 - bot, side * (th / 2 + 0.03));
      leaf.add(rose, lever, neck);
      if (front && side === 1) { const lock = new THREE.Mesh(boxUV(new RoundedBoxGeometry(0.075, 0.3, 0.035, 3, 0.012)), P.applianceDark); lock.position.set(lw - 0.075, 1.12 - bot, side * (th / 2 + 0.017)); leaf.add(lock); }
    }
    mergeMeshChildren(leaf);
    pivot.add(leaf);
    const hingeA = o.hinge === "end" ? a1 - 0.006 : a0 + 0.006;
    const hp = s.at(hingeA, bot + 0.004, 0);
    pivot.position.copy(hp);
    dynamic.add(pivot);
    // closed: the leaf runs from the hinge along the wall toward the latch side
    const toLatch = s.along.clone().multiplyScalar(o.hinge === "end" ? -1 : 1);
    const swingRoom = o.swingInto === r.id ? 1 : -1;   // + into room a's side (d > 0)
    const intoDir = s.inward.clone().multiplyScalar(swingRoom * (o.a === r.id ? 1 : -1));
    const yawOf = (v: THREE.Vector3) => Math.atan2(-v.z, v.x);
    const closedYaw = yawOf(toLatch);
    let openYaw = yawOf(intoDir);
    // (the leaf turns through a quarter, never three)
    let dy = openYaw - closedYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    openYaw = closedYaw + dy * 0.98;
    // the leaf faces: its local z must point across the wall
    leaf.rotation.y = 0;
    // (in a building the rooms off the corridor stand open — not the toilets, stores, plant or stair)
    const startOpen = !front && (r.type === "bedroom" || r.type === "master" || o.b === "hall" || r.type === "utility"
      || (facility && !["restroom", "storage", "plant", "stair", "guest"].includes(r.type)));
    const rig: DoorRig = { opening: o, kind: front ? "front" : "swing", pivot, leaf, t: startOpen ? 1 : 0, want: startOpen ? 1 : 0, closedYaw, openYaw, hinge: [hp.x, hp.z], length: glassy ? lw / 2 : lw, label, zone };
    pivot.rotation.y = startOpen ? openYaw : closedYaw;
    doors.push(rig);
  }

  const roomAt = (x: number, z: number) => plan.rooms.find(r => x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]) ?? null;
  return {
    zones, segments, doors, windows, ceilingLights, lampMeshes, H,
    roomAt,
    floorAt: (x, z) => { const r = roomAt(x, z); return r ? -(r.floorDrop ?? 0) : 0; },
  };
}
