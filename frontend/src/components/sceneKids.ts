import * as THREE from "three";
import type { RealEstateParcel } from "../api/client";
import type { Look } from "./complexScene";
import { inRing, rng } from "./complexScene";
import type { Terrain } from "./sceneTerrain";

/* Children at play on school grounds (지목 학), by day in dry weather: about twenty a
 * school, 1.05-1.4 m tall with a child's proportions (a larger head), each dressed
 * differently — some with a balloon on a string, some with a school bag, some in a
 * cap — running about, chasing one another or walking. They keep to the open ground,
 * clear of the school buildings and a few metres in from the fence.
 * Drawn as instanced parts (torso, head, hair, arms, legs, cap, bag, balloon, string):
 * a dozen draws however many children, the limbs swung per frame.
 * Footprint frame: x east, y north; world (x, height, -y). */

type Role = "run" | "chase" | "walk" | "balloon";
interface Kid {
  x: number; y: number; heading: number; tx: number; ty: number; speed: number; role: Role;
  scale: number; phase: number; wait: number; target?: Kid; school: number;
  cap: boolean; bag: boolean; balloon: boolean; bx: number; by: number; bz: number;
}

const SHIRTS = ["#e8413c", "#f5c518", "#4aa3e0", "#3fb36b", "#f17fb0", "#ff8a2a", "#f4f4f2", "#8c6ad8", "#2bb8b0"];
const PANTS = ["#26324a", "#3d5a80", "#1e1f24", "#8a7a5c", "#5a6470", "#b33a3a"];
const HAIR = ["#1b1411", "#2a1d15", "#3a2618", "#15110e"];
const SKIN = ["#e3b594", "#d9a784", "#eec2a0", "#cf9b77"];
const CAPS = ["#f5c518", "#f5c518", "#e8413c", "#2f6fd6", "#ffffff"];
const BAGS = ["#e8413c", "#2f6fd6", "#f17fb0", "#3fb36b", "#f5c518", "#8c6ad8"];
const BALLOONS = ["#ff3b4e", "#ff6fb1", "#ffd23a", "#3a8dff", "#a45cff", "#ff8a2a", "#35d08a"];

/** The open ground of each school parcel near the complex: points a child may stand
 * on (inside, clear of buildings and roads, 4 m in from the edge). */
function playgrounds(parcels: RealEstateParcel[], blocked: (x: number, y: number) => boolean, T: number) {
  const out: { ring: [number, number][]; spots: [number, number][]; cx: number; cy: number }[] = [];
  for (const p of parcels) {
    if (p.kind !== "학") continue;
    const ring = p.ring as [number, number][];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < -T || y1 < -T || x0 > T || y0 > T) continue;
    const edge = (x: number, y: number) => {
      let d = Infinity;
      for (let i = 0, n = ring.length; i < n; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n], dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        d = Math.min(d, Math.hypot(x - ax - dx * t, y - ay - dy * t));
      }
      return d;
    };
    const spots: [number, number][] = [];
    const step = Math.max(3, Math.sqrt(((x1 - x0) * (y1 - y0)) / 900));
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) {
      if (Math.abs(x) > T || Math.abs(y) > T || !inRing([x, y], ring) || edge(x, y) < 4) continue;
      // Clear of buildings, with a margin (a child does not brush the wall).
      if (blocked(x, y) || blocked(x + 2, y) || blocked(x - 2, y) || blocked(x, y + 2) || blocked(x, y - 2)) continue;
      spots.push([x, y]);
    }
    if (spots.length < 12) continue;
    const cx = spots.reduce((a, s) => a + s[0], 0) / spots.length, cy = spots.reduce((a, s) => a + s[1], 0) / spots.length;
    out.push({ ring, spots, cx, cy });
  }
  return out;
}

export function buildKids(parcels: RealEstateParcel[], terrain: Terrain, blocked: (x: number, y: number) => boolean, T: number, seed: number) {
  // The two schools nearest the complex.
  const grounds = playgrounds(parcels, blocked, T).sort((a, b) => Math.hypot(a.cx, a.cy) - Math.hypot(b.cx, b.cy)).slice(0, 2);
  if (!grounds.length) return null;
  const r = rng(seed * 17 + 3);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const kids: Kid[] = [];
  grounds.forEach((g, school) => {
    const n = 18 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const [x, y] = pick(g.spots);
      const role: Role = i < 2 ? "balloon" : i < 8 ? "run" : i < 12 ? "chase" : "walk";
      const k: Kid = {
        x, y, heading: r() * Math.PI * 2, tx: x, ty: y, role, school,
        speed: role === "run" || role === "chase" ? 2.4 + r() * 1.2 : role === "balloon" ? 1.3 + r() * 1.1 : 0.9 + r() * 0.5,
        scale: (1.05 + r() * 0.35) / 1.25, phase: r() * 10, wait: r() * 2,
        cap: r() < 0.35, bag: role === "walk" ? r() < 0.7 : r() < 0.15, balloon: role === "balloon",
        bx: x, by: 1.9, bz: -y,
      };
      kids.push(k);
    }
    // Chasers each after a runner of the same school.
    const runners = kids.filter(k => k.school === school && k.role === "run");
    kids.filter(k => k.school === school && k.role === "chase").forEach(k => { k.target = pick(runners); });
  });
  const N = kids.length;
  const spotsOf = (k: Kid) => grounds[k.school].spots;
  // A straight run to the target must stay on the open ground.
  const clearTo = (x0: number, y0: number, x1: number, y1: number) => {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 2);
    for (let i = 1; i < n; i++) { const t = i / n; if (blocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
    return true;
  };
  const newTarget = (k: Kid) => {
    for (let tries = 0; tries < 8; tries++) {
      const [x, y] = spotsOf(k)[Math.floor(r() * spotsOf(k).length)];
      const far = k.role === "walk" ? 25 : 45;
      if (Math.hypot(x - k.x, y - k.y) > far || !clearTo(k.x, k.y, x, y)) continue;
      k.tx = x; k.ty = y; return;
    }
    k.tx = k.x; k.ty = k.y;
  };
  kids.forEach(newTarget);

  // ---- parts (a 1.25 m child; each instance scaled) ----
  const geos: THREE.BufferGeometry[] = [];
  const g = <G extends THREE.BufferGeometry>(x: G) => { geos.push(x); return x; };
  const torsoG = g(new THREE.CapsuleGeometry(0.12, 0.2, 4, 10)); torsoG.scale(0.85, 1, 1.1);
  const headG = g(new THREE.SphereGeometry(0.115, 14, 10)); headG.scale(0.95, 1.08, 0.92);
  const hairG = g(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)); hairG.rotateZ(0.3);
  const legG = g(new THREE.CapsuleGeometry(0.05, 0.36, 3, 8)); legG.translate(0, -0.23, 0);
  const armG = g(new THREE.CapsuleGeometry(0.036, 0.26, 3, 8)); armG.translate(0, -0.17, 0);
  const capTop = new THREE.CylinderGeometry(0.118, 0.122, 0.07, 14); capTop.translate(0, 0.02, 0);
  const brim = new THREE.BoxGeometry(0.13, 0.014, 0.19); brim.translate(0.13, -0.01, 0);
  const capG = g(mergeTwo(capTop, brim)); capTop.dispose(); brim.dispose();
  const bagG = g(new THREE.BoxGeometry(0.12, 0.27, 0.23));
  const balloonG = g(new THREE.SphereGeometry(0.17, 14, 10)); balloonG.scale(1, 1.18, 1);
  const knot = g(new THREE.ConeGeometry(0.03, 0.05, 6));
  const stringG = g(new THREE.CylinderGeometry(0.004, 0.004, 1, 3)); stringG.translate(0, 0.5, 0);

  const mat = (roughness = 0.75) => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness, metalness: 0 });
  const mats = [mat(), mat(0.65), mat(0.9), mat(0.35), mat(0.8)];
  const [cloth, skinM, hairM, balloonM, stringM] = mats;
  const inst = (geo: THREE.BufferGeometry, m: THREE.Material, count: number) => {
    const im = new THREE.InstancedMesh(geo, m, count);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = true; im.frustumCulled = false;
    return im;
  };
  const torso = inst(torsoG, cloth, N), head = inst(headG, skinM, N), hair = inst(hairG, hairM, N);
  const legs = inst(legG, cloth, N * 2), arms = inst(armG, skinM, N * 2);
  const caps = inst(capG, cloth, N), bags = inst(bagG, cloth, N);
  const balloons = inst(balloonG, balloonM, N), knots = inst(knot, balloonM, N), strings = inst(stringG, stringM, N);
  strings.castShadow = false;
  const color = new THREE.Color();
  kids.forEach((_k, i) => {
    torso.setColorAt(i, color.set(pick(SHIRTS)));
    const skin = pick(SKIN); head.setColorAt(i, color.set(skin)); arms.setColorAt(i * 2, color.set(skin)); arms.setColorAt(i * 2 + 1, color.set(skin));
    hair.setColorAt(i, color.set(pick(HAIR)));
    const pants = pick(PANTS); legs.setColorAt(i * 2, color.set(pants)); legs.setColorAt(i * 2 + 1, color.set(pants));
    caps.setColorAt(i, color.set(pick(CAPS))); bags.setColorAt(i, color.set(pick(BAGS)));
    const b = pick(BALLOONS); balloons.setColorAt(i, color.set(b)); knots.setColorAt(i, color.set(b));
    strings.setColorAt(i, color.set("#f2f2f2"));
  });
  const group = new THREE.Group();
  group.add(torso, head, hair, legs, arms, caps, bags, balloons, knots, strings);

  // ---- per frame ----
  const m = new THREE.Matrix4(), body = new THREE.Matrix4(), part = new THREE.Matrix4(), rot = new THREE.Matrix4();
  const q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const hand = new THREE.Vector3();
  let time = 0, on = false;
  const place = (im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rz = 0, rx = 0) => {
    part.makeTranslation(x, y, z);
    if (rz || rx) part.multiply(rot.makeRotationFromEuler(new THREE.Euler(rx, 0, rz, "XYZ")));
    im.setMatrixAt(i, m.multiplyMatrices(body, part));
  };
  const update = (dt: number) => {
    if (!on || !(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    time += dt;
    for (let i = 0; i < N; i++) {
      const k = kids[i];
      // Move: toward the target (a chaser toward its quarry), then a pause, then on.
      if (k.role === "chase" && k.target) { k.tx = k.target.x; k.ty = k.target.y; }
      const dx = k.tx - k.x, dy = k.ty - k.y, d = Math.hypot(dx, dy);
      let moving = false;
      if (k.wait > 0) k.wait -= dt;
      else if (d < (k.role === "chase" ? 1.2 : 0.5)) {
        if (k.role === "chase") { const t = k.target; k.target = undefined; k.role = "run"; if (t) { t.role = "chase"; t.target = k; t.wait = 0.8; } }
        k.wait = k.role === "walk" ? 1 + r() * 3 : 0.3 + r() * 1.5;
        newTarget(k);
      } else {
        const want = Math.atan2(dy, dx);
        let turn = want - k.heading; turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
        k.heading += Math.max(-4 * dt, Math.min(4 * dt, turn));
        const step = Math.min(d, k.speed * dt * (Math.abs(turn) > 1.2 ? 0.4 : 1));
        const nx = k.x + Math.cos(k.heading) * step, ny = k.y + Math.sin(k.heading) * step;
        if (!blocked(nx, ny)) { k.x = nx; k.y = ny; moving = true; } else { k.wait = 0.4; newTarget(k); }
      }
      // Gait: stride rate and swing from the speed; a runner bobs and leans in.
      const running = moving && k.speed > 1.8;
      const rate = moving ? (running ? 9.5 : 6) : 0;
      k.phase += rate * dt;
      const swing = moving ? (running ? 0.85 : 0.45) : 0.04 * Math.sin(time * 1.3 + k.phase);
      const bob = running ? Math.abs(Math.sin(k.phase)) * 0.06 : moving ? Math.abs(Math.sin(k.phase)) * 0.02 : 0;
      const lean = running ? 0.2 : moving ? 0.05 : 0;
      const h = terrain.at(k.x, k.y);
      q.setFromAxisAngle(up, k.heading);
      body.compose(v.set(k.x, h + bob * k.scale, -k.y), q, s.setScalar(k.scale));
      // Torso leans about the hips.
      const hipY = 0.6;
      part.makeTranslation(0, hipY, 0).multiply(rot.makeRotationZ(-lean)).multiply(new THREE.Matrix4().makeTranslation(0, 0.2, 0));
      torso.setMatrixAt(i, m.multiplyMatrices(body, part));
      const headX = Math.sin(lean) * 0.5, headY = hipY + Math.cos(lean) * 0.5;
      place(head, i, headX, headY, 0);
      place(hair, i, headX - 0.005, headY + 0.03, 0);
      if (k.cap) place(caps, i, headX, headY + 0.08, 0); else caps.setMatrixAt(i, zero);
      if (k.bag) place(bags, i, -0.16 + headX * 0.3, hipY + 0.24, 0, -lean); else bags.setMatrixAt(i, zero);
      // Legs swing opposite; arms opposite to the legs. A balloon arm is raised to the string.
      const sw = Math.sin(k.phase) * swing;
      place(legs, i * 2, 0, hipY, -0.07, sw);
      place(legs, i * 2 + 1, 0, hipY, 0.07, -sw);
      const shY = hipY + 0.34, shX = Math.sin(lean) * 0.34;
      place(arms, i * 2, shX, shY, -0.16, -sw * 0.9, -0.12);
      if (k.balloon) place(arms, i * 2 + 1, shX, shY, 0.16, 0.5, Math.PI - 0.35);
      else place(arms, i * 2 + 1, shX, shY, 0.16, sw * 0.9, 0.12);
      if (k.balloon) {
        // The hand, and the balloon trailing it on the string: pulled up, dragged behind.
        hand.set(shX + 0.12, shY + 0.26, 0.26).applyMatrix4(body);
        const tx = hand.x - Math.cos(k.heading) * (moving ? 0.5 : 0.1), tz = hand.z + Math.sin(k.heading) * (moving ? 0.5 : 0.1);
        const ty = hand.y + 0.95 * k.scale + 0.05 * Math.sin(time * 1.7 + k.phase);
        const f = Math.min(1, dt * 4);
        k.bx += (tx - k.bx) * f; k.by += (ty - k.by) * f; k.bz += (tz - k.bz) * f;
        m.compose(v.set(k.bx, k.by, k.bz), q.setFromAxisAngle(up, time * 0.4 + i), s.setScalar(k.scale));
        balloons.setMatrixAt(i, m);
        m.compose(v.set(k.bx, k.by - 0.2 * k.scale, k.bz), q.identity(), s.setScalar(k.scale));
        knots.setMatrixAt(i, m);
        const dir = v.set(k.bx - hand.x, k.by - 0.22 * k.scale - hand.y, k.bz - hand.z);
        const len = dir.length();
        q.setFromUnitVectors(up, dir.normalize());
        strings.setMatrixAt(i, m.compose(hand, q, s.set(1, len, 1)));
      } else { balloons.setMatrixAt(i, zero); knots.setMatrixAt(i, zero); strings.setMatrixAt(i, zero); }
    }
    for (const im of [torso, head, hair, legs, arms, caps, bags, balloons, knots, strings]) im.instanceMatrix.needsUpdate = true;
  };
  group.visible = false;
  return {
    group,
    update,
    /** Where the children are (footprint metres), for tests. */
    positions: () => kids.map(k => ({ x: k.x, y: k.y, h: terrain.at(k.x, k.y), role: k.role, cap: k.cap, bag: k.bag, balloon: k.balloon })),
    /** Out by day, in dry weather (children are indoors at night and in rain or snow). */
    setLook(l: Look) {
      const next = l.sunElev > 3 && l.rain < 0.05 && l.snow < 0.05;
      if (next === on) return;
      on = next; group.visible = on;
      if (on) update(1 / 60);
    },
    dispose() { geos.forEach(x => x.dispose()); mats.forEach(x => x.dispose()); },
  };
}

/** Two geometries as one (same attributes: position, normal, uv). */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const A = a.index ? a.toNonIndexed() : a, B = b.index ? b.toNonIndexed() : b;
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const x = A.getAttribute(name) as THREE.BufferAttribute, y = B.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0); arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  if (A !== a) A.dispose();
  if (B !== b) B.dispose();
  return out;
}
