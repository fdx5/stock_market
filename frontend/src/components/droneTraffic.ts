import * as THREE from "three";
import { CAR_SPECS, carModelMaterial, loadCarModels } from "./sceneCars";
import { DIMS } from "./vehicleShapes";

/* The traffic on the drone's roads (드론 mode): cars along the lanes of each tile (droneRoads.ts),
 * right-hand traffic, keeping their distance from the car ahead, on into the lane that continues
 * where theirs ends (the next piece of the road, across a tile's edge or a junction). Near the
 * camera the modelled cars (sceneCars: the view's own kit, in its paint), farther a body-and-glass
 * block in the same colour: the whole traffic is a draw or two per kind, however many tiles.
 * A car with nowhere to go is set down again at a lane start out of sight. */

type Lane = { tile: string; p: Float32Array; cum: Float32Array; len: number; cars: Car[]; width: number };
type Car = { lane: Lane; s: number; v: number; vmax: number; kind: number; colour: THREE.Color; k: number; hidden: boolean;
  /** across a junction: from the end of the last lane to the start of this one (s < 0 on it) */
  via: { x: number; y: number; z: number; len: number } | null };

// [model, share, length, top speed factor, livery]
const KINDS: [string, number, number, number, string?][] = [
  ["sedan", 12, 4.9, 1], ["sedan-large", 8, 5.0, 1], ["sedan-sports", 8, 4.65, 1.06], ["suv", 10, 4.63, 1], ["suv-small", 8, 4.4, 1.02],
  ["suv-luxury", 6, 4.95, 1], ["hatchback-sports", 5, 3.6, 1.02], ["kei-box", 4, 3.6, 1], ["taxi", 8, 4.9, 1, "#f2f0ea"], ["mpv", 5, 5.1, 0.98],
  ["van", 3, 5.2, 0.95], ["boxtruck", 3, 6.5, 0.9, "#e9e9e6"], ["cargo", 4, 5.1, 0.9, "#2d5fa8"], ["bus", 3, 11, 0.8, "#2a6fc4"],
];
// Korean roads' colours: white, black, grey and silver most; a few blues, reds and the rest.
const PAINT: [string, number][] = [["#f2f2ef", 30], ["#16181b", 20], ["#8d9196", 14], ["#c4c7cb", 13], ["#1f3a6b", 6], ["#8a1c1f", 5], ["#4b5a4a", 3], ["#b8a58a", 3], ["#5f3a24", 2], ["#2f6f9a", 2], ["#d8c24a", 2]];
const NEAR_M = 320, FAR_M = 1100, CAP_NEAR = 160, CAP_FAR = 3000;
// the blocks' size per kind (width, height, length)
const BLOCK: [number, number, number][] = KINDS.map(([name, , L]) => {
  const spec = CAR_SPECS[name], dims = DIMS[name];
  return [spec?.width ?? dims?.[1] ?? 2.4, (spec?.height ?? dims?.[2] ?? 2.6) / 1.35, L];
});
/** An instance's matrix written straight into its array: turned `yaw` about the vertical (cos,
 * sin), pitched along the slope (cos, sin), scaled (sx, sy, sz), at (x, y, z). (Composing it
 * through Matrix4 and setMatrixAt for every car, every frame, was a tenth of the frame.) */
function writeMatrix(a: Float32Array, i: number, x: number, y: number, z: number, cy: number, sy: number, cp: number, sp: number, sx: number, sh: number, sz: number) {
  const o = i * 16;
  a[o] = cy * sx; a[o + 1] = 0; a[o + 2] = -sy * sx; a[o + 3] = 0;
  a[o + 4] = sy * sp * sh; a[o + 5] = cp * sh; a[o + 6] = cy * sp * sh; a[o + 7] = 0;
  a[o + 8] = sy * cp * sz; a[o + 9] = -sp * sz; a[o + 10] = cy * cp * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

function pick<T>(list: [T, number][], r: number): T {
  const total = list.reduce((a, b) => a + b[1], 0);
  let x = r * total;
  for (const [v, w] of list) { if ((x -= w) <= 0) return v; }
  return list[list.length - 1][0];
}

/** A car seen from afar: its body and a darker glasshouse on top, about the size of the kind. */
function blockGeometry() {
  const body = new THREE.BoxGeometry(1, 0.55, 1).translate(0, 0.45, 0);
  const cabin = new THREE.BoxGeometry(0.86, 0.42, 0.55).translate(0, 0.93, -0.04);
  const paint = (g: THREE.BufferGeometry, c: number) => { const n = g.getAttribute("position").count; g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(c), 3)); return g; };
  const merged = new THREE.BufferGeometry();
  const parts = [paint(body, 1), paint(cabin, 0.32)];
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    pos.push(...(g.getAttribute("position").array as Float32Array)); nor.push(...(g.getAttribute("normal").array as Float32Array)); col.push(...(g.getAttribute("color").array as Float32Array));
    idx.push(...Array.from(g.index!.array, i => i + base));
    g.dispose();
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  merged.setIndex(idx);
  return merged;
}

export class DroneTraffic {
  readonly group = new THREE.Group();
  private lanes = new Map<string, Lane[]>();
  private starts = new Map<string, Lane[]>();
  private cars: Car[] = [];
  private near: (THREE.InstancedMesh | null)[] = KINDS.map(() => null);
  private far: THREE.InstancedMesh;
  private farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
  private nearMat: THREE.MeshStandardMaterial | null = null;
  private rnd: () => number;
  private disposed = false;

  constructor(seed: number) {
    let s = (seed % 2147483646) + 1;
    this.rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    this.group.name = "drone traffic";
    this.far = new THREE.InstancedMesh(blockGeometry(), this.farMat, CAP_FAR);
    this.far.count = 0; this.far.frustumCulled = false; this.far.castShadow = false; this.far.receiveShadow = true;
    this.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP_FAR * 3), 3);
    this.group.add(this.far);
    // The modelled cars once the kit is in (it is the view's: usually loaded already).
    void loadCarModels().then(models => {
      if (this.disposed) return;
      this.nearMat = carModelMaterial();
      KINDS.forEach(([name], i) => {
        const g = models.get(name);
        if (!g) return;
        const im = new THREE.InstancedMesh(g, this.nearMat!, CAP_NEAR);
        im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP_NEAR * 3), 3);
        this.near[i] = im;
        this.group.add(im);
      });
    }).catch(() => {});
  }

  private cell = (x: number, y: number) => `${Math.round(x / 4)},${Math.round(y / 4)}`;

  /** A tile's lanes (droneRoads: [n, road width, x, y, z, …]…), and cars on them by the road's width. */
  addTile(tile: string, packed: Float32Array) {
    if (this.lanes.has(tile)) this.removeTile(tile);
    const list: Lane[] = [];
    for (let o = 0; o < packed.length;) {
      const n = packed[o++], width = packed[o++], p = packed.slice(o, o + n * 3);
      o += n * 3;
      const cum = new Float32Array(n);
      for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(p[k * 3] - p[k * 3 - 3], p[k * 3 + 1] - p[k * 3 - 2]);
      const lane: Lane = { tile, p, cum, len: cum[n - 1], cars: [], width };
      if (lane.len < 8) continue;
      list.push(lane);
      const key = this.cell(p[0], p[1]);
      this.starts.set(key, [...(this.starts.get(key) ?? []), lane]);
    }
    this.lanes.set(tile, list);
    for (const lane of list) {
      // (the city's density: a car every ~30–55 m on a boulevard, 45–85 m on a street, sparse on lanes)
      const gap = lane.width >= 15 ? [30, 25] : lane.width >= 8 ? [45, 40] : [80, 60];
      for (let s = 5 + this.rnd() * gap[0]; s < lane.len - 6; s += gap[0] + this.rnd() * gap[1]) {
        if (this.cars.length >= CAP_FAR) return;
        this.spawn(lane, s);
      }
    }
  }

  private spawn(lane: Lane, s: number) {
    const kind = pick(KINDS.map((k, i) => [i, k[1]] as [number, number]), this.rnd());
    const livery = KINDS[kind][4];
    const colour = new THREE.Color(livery ?? pick(PAINT, this.rnd()));
    const vmax = (9 + this.rnd() * 7) * KINDS[kind][3];
    const car: Car = { lane, s, v: vmax * 0.8, vmax, kind, colour, k: 0, hidden: false, via: null };
    lane.cars.push(car);
    lane.cars.sort((a, b) => a.s - b.s);
    this.cars.push(car);
  }

  removeTile(tile: string) {
    const list = this.lanes.get(tile);
    if (!list) return;
    this.lanes.delete(tile);
    for (const lane of list) {
      const key = this.cell(lane.p[0], lane.p[1]);
      const at = this.starts.get(key)?.filter(l => l !== lane);
      if (at?.length) this.starts.set(key, at); else this.starts.delete(key);
    }
    const gone = new Set(list);
    this.cars = this.cars.filter(c => !gone.has(c.lane));
  }

  /** Where a lane that ends at (x, y) heading (dx, dy) carries on: a lane starting within 4 m
   * (the same road, across a tile's edge) or, across a junction, within 22 m ahead of it — straight
   * on twice as likely as a turn, never back the way it came. */
  private next(x: number, y: number, dx: number, dy: number, from: Lane): Lane | null {
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const cx = Math.round(x / 4), cy = Math.round(y / 4), out: [Lane, number][] = [];
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) for (const l of this.starts.get(`${cx + i},${cy + j}`) ?? []) {
      if (l === from) continue;
      const ox = l.p[0] - x, oy = l.p[1] - y, d = Math.hypot(ox, oy);
      if (d > 22) continue;
      const ex = l.p[3] - l.p[0], ey = l.p[4] - l.p[1], el = Math.hypot(ex, ey) || 1, turn = (ex * dx + ey * dy) / el;
      if (d <= 4) { if (turn > 0.2) out.push([l, 4]); continue; }
      // (across a junction: ahead of the car, not back; straight on most likely)
      if ((ox * dx + oy * dy) / d < 0.2 || turn < -0.3) continue;
      out.push([l, turn > 0.8 ? 2 : 1]);
    }
    if (!out.length) return null;
    const near = out.filter(o => o[1] === 4);
    return pick(near.length ? near : out, this.rnd());
  }

  /** One step: every car on (gap-keeping), then the instances placed for the camera at (cx, cz). */
  update(dt: number, camera: THREE.Vector3) {
    if (!this.cars.length) { this.far.count = 0; this.near.forEach(im => { if (im) im.count = 0; }); return; }
    dt = Math.min(dt, 0.1);
    // (lanes far off are not driven: their cars wait, unseen, till the drone comes back near)
    const reach2 = (FAR_M + 150) ** 2;
    for (const list of this.lanes.values()) for (const lane of list) {
      const n3 = lane.p.length - 3, lx = lane.p[0] - camera.x, lz = -lane.p[1] - camera.z, ex = lane.p[n3] - camera.x, ez = -lane.p[n3 + 1] - camera.z;
      if (lx * lx + lz * lz > reach2 && ex * ex + ez * ez > reach2) continue;
      const cs = lane.cars;
      for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i];
        // the car ahead: on this lane, or the start of the next if near the end (not looked up: a margin)
        const ahead = cs[i + 1];
        const gap = ahead ? ahead.s - c.s - KINDS[ahead.kind][2] : Infinity;
        const want = gap < 6 ? 0 : gap < 40 ? c.vmax * (gap - 6) / 34 : c.vmax;
        c.v += THREE.MathUtils.clamp(want - c.v, -6 * dt, 2.5 * dt);
        c.s += Math.max(0, c.v) * dt;
      }
      // cars past the end: on into the next lane, or set down elsewhere
      while (cs.length && cs[cs.length - 1].s > lane.len) {
        const c = cs.pop()!, n = lane.p.length / 3;
        const ex = lane.p[(n - 1) * 3], ey = lane.p[(n - 1) * 3 + 1];
        const nx = lane.p[(n - 1) * 3] - lane.p[(n - 2) * 3], ny = lane.p[(n - 1) * 3 + 1] - lane.p[(n - 2) * 3 + 1];
        const on = this.next(ex, ey, nx, ny, lane), to = on ?? this.elsewhere(camera);
        if (!to) { this.cars = this.cars.filter(x => x !== c); continue; }
        const gap = on ? Math.hypot(to.p[0] - ex, to.p[1] - ey) : 0;
        // (a gap over a metre: driven across, from where the last lane ended)
        c.via = on && gap > 1 ? { x: ex, y: ey, z: lane.p[(n - 1) * 3 + 2], len: gap } : null;
        c.s = on ? c.s - lane.len - (c.via ? gap : 0) : 0;
        if (to.cars.length && to.cars[0].s < c.s + 8) c.s = Math.max(0, to.cars[0].s - 10);
        c.lane = to; c.k = 0;
        to.cars.unshift(c);
      }
    }
    // Place them: the modelled cars near, the blocks beyond, none past FAR_M.
    const counts = this.near.map(() => 0);
    let farN = 0;
    const cx = camera.x, cz = camera.z;
    for (const c of this.cars) {
      const l = c.lane, p = l.p;
      let x: number, y: number, z: number, dx: number, dy: number, dz: number, seg: number;
      if (c.s < 0 && c.via) {
        // on the way across a junction: straight from where it left to where its lane starts
        const v = c.via, f = 1 + c.s / v.len;
        dx = p[0] - v.x; dy = p[1] - v.y; dz = p[2] - v.z; seg = v.len;
        x = v.x + dx * f; y = v.y + dy * f; z = v.z + dz * f;
      } else {
        while (c.k < l.cum.length - 2 && l.cum[c.k + 1] < c.s) c.k++;
        const k = c.k; seg = l.cum[k + 1] - l.cum[k] || 1;
        const f = Math.min(1, Math.max(0, (c.s - l.cum[k]) / seg));
        x = p[k * 3] + (p[k * 3 + 3] - p[k * 3]) * f; y = p[k * 3 + 1] + (p[k * 3 + 4] - p[k * 3 + 1]) * f; z = p[k * 3 + 2] + (p[k * 3 + 5] - p[k * 3 + 2]) * f;
        dx = p[k * 3 + 3] - p[k * 3]; dy = p[k * 3 + 4] - p[k * 3 + 1]; dz = p[k * 3 + 5] - p[k * 3 + 2];
      }
      const ddx = x - cx, ddz = -y - cz;
      if (ddx * ddx + ddz * ddz > FAR_M * FAR_M) continue;
      // heading (scene: forward +z, x east, z south) and slope, without trigonometry
      const hl = Math.hypot(dx, dy) || 1, cyaw = -dy / hl, syaw = dx / hl;
      const pl = Math.hypot(seg, dz) || 1, cp = seg / pl, sp = -dz / pl;
      const near = ddx * ddx + ddz * ddz < NEAR_M * NEAR_M;
      const im = near ? this.near[c.kind] : null;
      if (im && counts[c.kind] < CAP_NEAR) {
        const i = counts[c.kind]++;
        writeMatrix(im.instanceMatrix.array as Float32Array, i, x, z, -y, cyaw, syaw, cp, sp, 1, 1, 1);
        const ca = im.instanceColor!.array as Float32Array; ca[i * 3] = c.colour.r; ca[i * 3 + 1] = c.colour.g; ca[i * 3 + 2] = c.colour.b;
      } else if (farN < CAP_FAR) {
        const b = BLOCK[c.kind];
        writeMatrix(this.far.instanceMatrix.array as Float32Array, farN, x, z, -y, cyaw, syaw, cp, sp, b[0], b[1], b[2]);
        const ca = this.far.instanceColor!.array as Float32Array; ca[farN * 3] = c.colour.r; ca[farN * 3 + 1] = c.colour.g; ca[farN * 3 + 2] = c.colour.b;
        farN++;
      }
    }
    this.far.count = farN;
    this.far.instanceMatrix.needsUpdate = true; if (this.far.instanceColor) this.far.instanceColor.needsUpdate = true;
    this.near.forEach((im, i) => {
      if (!im) return;
      im.count = counts[i];
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  /** A lane start out of sight (over 300 m from the camera), for a car with nowhere to go. */
  private elsewhere(camera: THREE.Vector3): Lane | null {
    const all = [...this.lanes.values()].flat();
    for (let t = 0; t < 8 && all.length; t++) {
      const l = all[Math.floor(this.rnd() * all.length)];
      if (Math.hypot(l.p[0] - camera.x, -l.p[1] - camera.z) > 300) return l;
    }
    return null;
  }

  materials(): THREE.Material[] { return [this.farMat, ...(this.nearMat ? [this.nearMat] : [])]; }

  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    this.far.geometry.dispose(); this.far.dispose();
    this.near.forEach(im => im?.dispose());
    this.farMat.dispose(); this.nearMat?.dispose();
  }
}
