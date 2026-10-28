import * as THREE from "three";
import type { FloorPlan, Room } from "./plan/types";
import type { Shell } from "./build";
import { HALF_WALL } from "./build";
import { mergeMeshChildren } from "./geom";
import type { Sound } from "../game/sound";
import { furMaterial, furShells } from "./fur";

/* What lives in the flat besides the walker: a pet — a Shiba Inu (the default) or a cat — that roams from room to room through the open
 * doors, comes to see who's there, runs off from someone running, purrs when stroked and settles
 * by them on the sofa; and a robot vacuum that cleans when asked, turning from walls, furniture,
 * feet and the cat. */

export interface Walker { x: number; z: number; speed: number; seated: boolean }
type Collide = (x: number, z: number, r: number) => THREE.Vector2;

// ------------------------------------------------------------------ the rooms as a graph

interface Node { p: THREE.Vector2; room: string; opening?: number; links: number[] }

function roomGraph(plan: FloorPlan) {
  const nodes: Node[] = [];
  const centre = new Map<string, number>();
  for (const r of plan.rooms) {
    const [x0, z0, x1, z1] = r.rect;
    centre.set(r.id, nodes.length);
    nodes.push({ p: new THREE.Vector2((x0 + x1) / 2, (z0 + z1) / 2), room: r.id, links: [] });
  }
  plan.openings.forEach((o, i) => {
    if (!(o.type === "door" || o.type === "open" || o.type === "glass_door") || o.b === "out") return;
    const p = o.axis === "z" ? new THREE.Vector2(o.center, o.at) : new THREE.Vector2(o.at, o.center);
    const k = nodes.length;
    nodes.push({ p, room: "", opening: i, links: [] });
    for (const id of [o.a, o.b]) { const c = centre.get(id); if (c === undefined) continue; nodes[k].links.push(c); nodes[c].links.push(k); }
  });
  return { nodes, centre };
}

const rnd = (() => { let s = 12345; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
const inner = (r: Room, m = 0.45): [number, number, number, number] => [r.rect[0] + HALF_WALL + m, r.rect[1] + HALF_WALL + m, r.rect[2] - HALF_WALL - m, r.rect[3] - HALF_WALL - m];

// ------------------------------------------------------------------ the cat

type CatState = "wander" | "sit" | "sleep" | "come" | "pet" | "flee";

export type PetKind = "dog" | "cat";

export class Cat {
  readonly root = new THREE.Group();
  readonly hit!: THREE.Mesh;
  pos = new THREE.Vector2(); yaw = 0;
  state: CatState = "sit";
  private path: THREE.Vector2[] = [];
  private timer = 2; private phase = 0; private speed = 0; private meowIn = 6; private wag = 0; private lastDist = 9;
  private j: Record<string, THREE.Object3D> = {};
  private mats: THREE.Material[] = []; private geos: THREE.BufferGeometry[] = [];
  private graph: ReturnType<typeof roomGraph>;
  name = "";

  constructor(private plan: FloorPlan, private shell: Shell, private collide: Collide, private sound: Sound, readonly species: PetKind = "dog") {
    this.graph = roomGraph(plan);
    if (species === "dog") this.buildDog(); else this.buildCat();
    // (the look ray's target: a box round it)
    const dog = species === "dog";
    const hg = dog ? new THREE.BoxGeometry(0.34, 0.6, 0.78) : new THREE.BoxGeometry(0.3, 0.35, 0.5); this.geos.push(hg);
    this.hit = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ visible: false })); this.hit.position.y = dog ? 0.3 : 0.18; this.root.add(this.hit);
    // (each joint's parts one mesh a material)
    const joints: THREE.Object3D[] = []; this.root.traverse(o => joints.push(o));
    for (const o of joints) this.geos.push(...mergeMeshChildren(o));
    // start curled up somewhere in the living room
    const living = plan.rooms.find(r => r.type === "living") ?? plan.rooms[0];
    const [a, b, c, d] = inner(living, 0.8);
    this.pos.set(a + (c - a) * 0.3, b + (d - b) * 0.7);
    this.state = "sleep"; this.timer = 6;
  }
  private buildCat() {
    const furs = [["#c98a4b", "#f1d3ad", "치즈"], ["#7f8084", "#d9d9da", "회색이"], ["#262427", "#f3f2ef", "턱시도"], ["#e8dcc8", "#fffaf2", "크림이"]];
    const [furC, bellyC, name] = furs[Math.floor(rnd() * furs.length)];
    this.name = name;
    const fur = this.mat(furC, 0.85, 1), belly = this.mat(bellyC, 0.85, 1), nose = this.mat("#d98b8b", 0.5, 0);
    const eye = new THREE.MeshPhysicalMaterial({ color: "#9ccf5a", roughness: 0.05, clearcoat: 1, emissive: "#3a5a10", emissiveIntensity: 0.3 }); this.mats.push(eye);
    const pupil = this.mat("#050505", 0.1, 0);
    const cap = (r: number, l: number, m: THREE.Material) => { const g = new THREE.CapsuleGeometry(r, l, 6, 14); this.geos.push(g); const me = new THREE.Mesh(g, m); return me; };
    const sph = (r: number, m: THREE.Material) => { const g = new THREE.SphereGeometry(r, 24, 16); this.geos.push(g); const me = new THREE.Mesh(g, m); return me; };
    const J = (n: string, parent: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); this.j[n] = o; return o; };
    const body = J("body", this.root, 0, 0.2, 0);
    const torso = cap(0.075, 0.2, fur); torso.rotation.x = Math.PI / 2; torso.scale.set(1, 1, 0.92); body.add(torso);
    const under = cap(0.06, 0.16, belly); under.rotation.x = Math.PI / 2; under.position.set(0, -0.025, 0.02); body.add(under);
    const neck = J("neck", body, 0, 0.05, 0.14);
    const head = J("head", neck, 0, 0.05, 0.05);
    const skull = sph(0.062, fur); skull.scale.set(1.08, 0.92, 1); head.add(skull);
    const muzzle = sph(0.032, belly); muzzle.position.set(0, -0.018, 0.048); muzzle.scale.set(1.3, 0.85, 1); head.add(muzzle);
    const n = sph(0.008, nose); n.position.set(0, -0.004, 0.078); head.add(n);
    for (const s of [-1, 1]) {
      const g = new THREE.ConeGeometry(0.026, 0.05, 4); this.geos.push(g);
      const ear = new THREE.Mesh(g, fur); ear.position.set(s * 0.036, 0.058, -0.005); ear.rotation.set(-0.15, 0, s * -0.3); head.add(ear);
      const e = sph(0.013, eye); e.position.set(s * 0.025, 0.012, 0.05); head.add(e);
      const p = sph(0.006, pupil); p.scale.set(0.5, 1.2, 0.5); p.position.set(s * 0.025, 0.012, 0.062); head.add(p);
      for (const [hx, hz, name] of [[0.05, 0.13, s < 0 ? "fl" : "fr"], [0.05, -0.12, s < 0 ? "bl" : "br"]] as [number, number, string][]) {
        const hip = J(name, body, s * hx, -0.02, hz);
        const leg = cap(0.02, 0.13, fur); leg.position.y = -0.09; hip.add(leg);
        const paw = sph(0.024, belly); paw.scale.set(1, 0.6, 1.3); paw.position.set(0, -0.17, 0.01); hip.add(paw);
      }
    }
    let t = J("tail0", body, 0, 0.03, -0.17);
    for (let i = 0; i < 5; i++) {
      const seg = cap(0.016 - i * 0.0015, 0.045, fur); seg.position.y = 0.03; t.add(seg);
      t = J(`tail${i + 1}`, t, 0, 0.055, 0);
    }
    this.j.tail0.rotation.x = -2.2;
  }
  /** A Shiba Inu, from photographs: a compact spitz (37 cm at the withers) in a short dense double
   * coat of ochre-red, with the cream "urajiro" — the whole muzzle, the cheeks below the eyes, two
   * eyebrow spots, the throat, chest and belly, the inside of the legs, under the tail — and a red
   * stripe down the bridge of the nose. A broad flat forehead, a wedge of a muzzle with a black nose
   * and a black lip line turned up at the corners; small, deep-set, upslanted dark eyes with black
   * rims; small thick triangular ears pricked forward; a tail curled in a ring over the back. The
   * head is one sculpted mesh (a sphere shaped into skull, stop, muzzle and cheeks) so the markings
   * blend across it; every coat is one fur, two colours, mixed per vertex. */
  private buildDog() {
    const coats = [["#d39a5a", "#eec48a", "하루"], ["#cc9050", "#eabb7c", "콩이"], ["#d8a468", "#f2cc96", "모모"]];
    const [root, tip, name] = coats[Math.floor(rnd() * coats.length)];
    this.name = name;
    const c2 = { root2: "#eee2cc", tip2: "#fffaf2" };
    // (a Shiba's coat is short and lies flat: sleek on the body, velvet on the face; only the tail is plumed)
    const body = furMaterial({ length: 0.009, density: 1400, layers: 12, root, tip, droop: 0.05, clump: 0.2, sweep: 1.1, ...c2 });
    const ruff = furMaterial({ length: 0.014, density: 1200, layers: 12, root, tip, droop: 0.08, clump: 0.3, sweep: 0.9, ...c2 });
    const face = furMaterial({ length: 0.0035, density: 2200, layers: 7, root, tip, droop: 0.02, clump: 0.15, sweep: 1.0, ...c2 });
    const tail = furMaterial({ length: 0.026, density: 1000, layers: 14, root, tip, droop: 0.06, clump: 0.45, sweep: 0.5, ...c2 });
    this.mats.push(body, ruff, face, tail);
    const nose = new THREE.MeshPhysicalMaterial({ color: "#141111", roughness: 0.42, clearcoat: 0.9, clearcoatRoughness: 0.3 });
    const eye = new THREE.MeshPhysicalMaterial({ color: "#3a1e0c", roughness: 0.02, clearcoat: 1 });
    const black = new THREE.MeshPhysicalMaterial({ color: "#1a1311", roughness: 0.5 });
    const tongue = new THREE.MeshPhysicalMaterial({ color: "#d26a72", roughness: 0.3, clearcoat: 0.7 });
    const claw = new THREE.MeshPhysicalMaterial({ color: "#3a332e", roughness: 0.4, clearcoat: 0.5 });
    const glint = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const sclera = new THREE.MeshPhysicalMaterial({ color: "#efe6da", roughness: 0.15, clearcoat: 0.6 });
    this.mats.push(nose, eye, black, tongue, claw, glint, sclera);
    const layers = new Map<THREE.Material, number>([[body, 12], [ruff, 12], [face, 7], [tail, 14]]);
    const ss = THREE.MathUtils.smoothstep;
    const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    /** a part in its joint's frame: transformed, its markings painted by where each point is, furred */
    const part = (g: THREE.BufferGeometry, m: THREE.Material, t: THREE.Matrix4 | null, mix?: (p: THREE.Vector3) => number) => {
      if (t) g.applyMatrix4(t);
      if (!g.getAttribute("normal")) g.computeVertexNormals();
      const lay = layers.get(m);
      if (lay) {
        const pos = g.getAttribute("position"), X = new Float32Array(pos.count), v = new THREE.Vector3();
        if (mix) for (let i = 0; i < pos.count; i++) X[i] = mix(v.fromBufferAttribute(pos, i));
        g.setAttribute("furMix", new THREE.BufferAttribute(X, 1));
        const s = furShells(g, lay); g.dispose(); this.geos.push(s);
        const me = new THREE.Mesh(s, m); me.castShadow = false; return me;
      }
      this.geos.push(g); return new THREE.Mesh(g, m);
    };
    const J = (n: string, parent: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); this.j[n] = o; return o; };

    // ---- the body: a deep chest, level back, tucked belly, firm rump; cream underneath and on the chest
    const torso = J("body", this.root, 0, 0.29, 0);
    const under = (p: THREE.Vector3) => Math.max(ss(-p.y, 0.02, 0.06), ss(p.z, 0.15, 0.22) * ss(-p.y, -0.05, 0.03));
    torso.add(part(new THREE.CapsuleGeometry(0.085, 0.2, 8, 20), body, M(0, 0.005, 0, 1, 1, 1, Math.PI / 2), under));
    torso.add(part(new THREE.SphereGeometry(0.1, 24, 18), body, M(0, 0.008, 0.12, 0.95, 1.08, 1), under));
    torso.add(part(new THREE.SphereGeometry(0.092, 24, 18), body, M(0, 0.012, -0.13, 0.96, 0.98, 1), under));
    torso.add(part(new THREE.CapsuleGeometry(0.055, 0.16, 6, 16), body, M(0, -0.05, 0, 1.05, 1, 0.75, Math.PI / 2), () => 1));
    torso.add(part(new THREE.SphereGeometry(0.076, 20, 16), ruff, M(0, 0.065, 0.14, 1.12, 0.82, 1), p => ss(p.z, 0.15, 0.2)));

    // ---- the neck: thick, cream down the throat
    const neck = J("neck", torso, 0, 0.06, 0.19);
    // (the throat cream all the way from the cheeks down into the chest)
    neck.add(part(new THREE.CapsuleGeometry(0.064, 0.05, 6, 18), ruff, M(0, 0.03, 0.01, 1.05, 1, 1, 0.6), p => ss(p.z, -0.03, 0.01)));

    // ---- the head: one sphere sculpted into skull, stop, wedge muzzle and cheeks
    const head = J("head", neck, 0, 0.068, 0.045);
    const R = 0.072;
    const shape = (p: THREE.Vector3) => {
      const d = p.clone().normalize();
      const q = new THREE.Vector3(p.x * 1.03, p.y * 0.99, p.z * 0.93);
      // the muzzle: the lower front pulled forward into a wedge round an axis a little below centre
      const m = ss(d.z, 0.2, 0.92) * (1 - ss(d.y, 0.0, 0.6));
      // (a blunt block, narrower and shallower than the skull: a distinct muzzle)
      q.z += m * 0.05; q.x *= 1 - 0.46 * m; q.y += (-0.03 - q.y) * 0.55 * m;
      // the stop: a step in between the eyes, where the forehead meets the muzzle
      const st = ss(d.z, 0.55, 0.85) * ss(d.y, -0.05, 0.12) * (1 - ss(d.y, 0.3, 0.5)) * (1 - ss(Math.abs(d.x), 0.15, 0.4)); q.z -= st * 0.008;
      // the nose's end blunt and slightly up-tilted
      const tip = ss(d.z, 0.85, 1.0) * (1 - ss(d.y, -0.2, 0.5)); q.z -= tip * 0.008; q.y += tip * 0.004;
      // a broad flat forehead and a moderate stop
      const fh = ss(d.y, 0.25, 0.8) * ss(d.z, 0.05, 0.75); q.z -= fh * 0.016; q.y -= fh * 0.005;
      // full cheeks
      const ck = ss(Math.abs(d.x), 0.35, 0.85) * (1 - ss(d.y, -0.15, 0.35)) * ss(d.z, -0.4, 0.4); q.x *= 1 + 0.12 * ck;
      // the jaw drawn in under the muzzle
      const jw = ss(-d.y, 0.55, 0.95) * ss(d.z, 0.1, 0.7); q.y += jw * 0.012;
      return q;
    };
    const hg = new THREE.SphereGeometry(R, 56, 40), hp = hg.getAttribute("position"), hv = new THREE.Vector3();
    for (let i = 0; i < hp.count; i++) { const o = shape(hv.fromBufferAttribute(hp, i)); hp.setXYZ(i, o.x, o.y, o.z); }
    hg.deleteAttribute("normal"); hg.computeVertexNormals();
    /** a point on the sculpted head, by the direction on the sphere it came from */
    const onHead = (x: number, y: number, z: number, out = 0) => { const d = new THREE.Vector3(x, y, z).normalize(); const p = shape(d.clone().multiplyScalar(R)); return p.addScaledVector(d, out); };
    // the urajiro: the whole muzzle and lower cheeks cream, the bridge's red stripe, two eyebrow spots
    const brow = [onHead(-0.4, 0.56, 0.72), onHead(0.4, 0.56, 0.72)];
    const eyeY = onHead(0.45, 0.36, 0.81).y;
    const headMix = (p: THREE.Vector3) => {
      // cream below a line from under the eyes back to the ears' roots, round the cheeks and the jaw…
      const below = ss(eyeY - 0.004 - p.y, 0.0, 0.01) * ss(p.z, -0.035, 0.0);
      // …except the bridge: an orange band down the top of the muzzle to the nose, widening up to the forehead
      const half = 0.009 + Math.max(0, p.y - (eyeY - 0.02)) * 0.6;
      const bridge = (1 - ss(Math.abs(p.x), half, half + 0.006)) * ss(p.y, -0.022, -0.012) * ss(p.z, 0.02, 0.04);
      const chin = ss(-p.y, 0.03, 0.045);
      const spots = Math.max(...brow.map(b => 1 - ss(p.distanceTo(b), 0.006, 0.011)));
      return Math.max(Math.max(below * (1 - bridge), chin), spots);
    };
    head.add(part(hg, face, null, headMix));
    // the nose: a black leather button with two nostrils, at the muzzle's end
    const tipP = onHead(0, -0.16, 1, -0.006);
    head.add(part(new THREE.SphereGeometry(0.0105, 20, 14), nose, M(tipP.x, tipP.y + 0.004, tipP.z, 1.3, 0.85, 0.8, -0.25)));
    for (const s of [-1, 1]) head.add(part(new THREE.SphereGeometry(0.0026, 8, 6), black, M(s * 0.0045, tipP.y + 0.0012, tipP.z + 0.0025, 1.3, 0.7, 0.6)));
    // the lips: a thin black line under the nose and back along the muzzle
    for (const s of [-1, 1]) {
      const pts = [onHead(0, -0.5, 0.86, 0.0004), onHead(s * 0.18, -0.55, 0.82, 0.0005), onHead(s * 0.34, -0.5, 0.76, 0.0006), onHead(s * 0.44, -0.44, 0.7, 0.0006)];
      head.add(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.0012, 5, false), black, null));
    }
    // (the tongue just out between the lips, under the nose)
    const tg = part(new THREE.SphereGeometry(0.011, 14, 10), tongue, M(0, tipP.y - 0.03, tipP.z - 0.03, 0.9, 0.28, 1.2, 0.35)); head.add(tg); this.j.tongue = tg;
    for (const s of [-1, 1]) {
      // small, deep-set almond eyes, the outer corners up, with black rims
      // the eyes: round, dark brown, with a little white showing at the outer corner and below (the
      // look in the photograph), a thin dark rim, a catchlight
      const ep = onHead(s * 0.45, 0.36, 0.81, -0.005);
      const outward = new THREE.Vector3(s, -0.35, 0).normalize().multiplyScalar(0.0022);
      head.add(part(new THREE.SphereGeometry(0.0136, 24, 18), sclera, M(ep.x + outward.x, ep.y + outward.y, ep.z - 0.0012, 1.0, 0.98, 0.8, 0, s * 0.35, 0)));
      head.add(part(new THREE.SphereGeometry(0.0124, 24, 18), eye, M(ep.x - outward.x * 0.5, ep.y - outward.y * 0.5, ep.z + 0.0007, 1.0, 1.0, 0.82, 0, s * 0.35, 0)));
      const rimP = onHead(s * 0.45, 0.36, 0.81, -0.0042);
      head.add(part(new THREE.TorusGeometry(0.0142, 0.0011, 8, 30), black, M(rimP.x + outward.x, rimP.y + outward.y, rimP.z, 1.0, 0.98, 1, 0, s * 0.35, 0)));
      const gl = onHead(s * 0.43, 0.4, 0.81, 0.0026);
      head.add(part(new THREE.SphereGeometry(0.0017, 8, 6), glint, M(gl.x, gl.y, gl.z)));
      // ears: small thick triangles set wide on the crown, leaning forward, cream inside
      const ear = J(s < 0 ? "earL" : "earR", head, s * 0.045, 0.055, -0.014);
      ear.rotation.set(0.3, 0, s * -0.28);
      const eg = new THREE.ConeGeometry(0.027, 0.056, 4, 3); eg.rotateY(Math.PI / 4); eg.scale(1, 1, 0.42);
      ear.add(part(eg, face, M(0, 0.02, 0), p => ss(p.z, 0.003, 0.006) * ss(p.y, 0.01, 0.018) * (1 - ss(Math.abs(p.x), 0.006, 0.012))));
      // ---- the legs: straight forelegs, angulated hind legs; red outside, cream inside and down the front
      for (const [hz, nm] of [[0.15, s < 0 ? "fl" : "fr"], [-0.15, s < 0 ? "bl" : "br"]] as [number, string][]) {
        const hip = J(nm, torso, s * 0.055, -0.03, hz);
        const front = hz > 0;
        const inside = (p: THREE.Vector3) => ss(-s * p.x, 0.0, 0.012);
        hip.add(part(new THREE.CapsuleGeometry(front ? 0.032 : 0.044, front ? 0.07 : 0.08, 6, 16), body, M(0, -0.05, front ? 0 : -0.01), inside));
        const knee = J(`${nm}k`, hip, 0, -0.1, front ? 0.004 : -0.012);
        knee.add(part(new THREE.CapsuleGeometry(0.02, 0.1, 6, 14), body, M(0, -0.06, 0, 1, 1, 1, front ? 0 : -0.12), p => Math.max(inside(p), ss(p.z, 0.004, 0.016), front ? ss(-p.y, 0.08, 0.11) : 0)));
        // (the foot in the leg's own coat, all cream: one draw a leg)
        knee.add(part(new THREE.SphereGeometry(0.026, 18, 12), body, M(0, -0.135, 0.012, 1, 0.6, 1.35), () => 1));
      }
    }
    // ---- the tail: thick, curled in a ring over the back; red over the curl, cream under it
    let t = J("tail0", torso, 0, 0.07, -0.205);
    for (let i = 0; i < 4; i++) {
      t.add(part(new THREE.CapsuleGeometry(0.027 - i * 0.003, 0.05, 6, 14), tail, M(0, 0.03, 0), p => ss(-p.z, 0.004, 0.016)));
      t = J(`tail${i + 1}`, t, 0, 0.06, 0);
    }
  }

  private mat(c: string, r: number, sheen: number) { const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: r, sheen, sheenColor: new THREE.Color("#ffffff"), sheenRoughness: 0.5 }); this.mats.push(m); return m; }

  /** stroked, what it does: a dog wags hard (sitting), then may lie down with its chin on its paws or
   * roll onto its back for its belly; a cat purrs sitting, rolls onto its side, or stretches */
  private petMode: "wag" | "down" | "belly" | "roll" | "stretch" = "wag";
  /** the pose eased toward each frame (0 → 1 over ~0.6 s) */
  private petK = 0;
  label() {
    const dog = this.species === "dog";
    const doing = dog ? { wag: "꼬리 흔드는 중…", down: "엎드려서 꼬리 흔드는 중…", belly: "배 보여주는 중…", roll: "", stretch: "" }[this.petMode]
      : { wag: "골골송 중…", roll: "뒹굴며 배 보여주는 중…", stretch: "기지개 켜는 중…", down: "", belly: "" }[this.petMode];
    return this.state === "pet" ? `${this.name} ${doing || "좋아하는 중…"}` : this.state === "sleep" ? `자는 ${this.name} 쓰다듬기` : `${this.name} 쓰다듬기`;
  }
  pet() {
    // (stroked again while already happy: on to the next thing — down, then the belly)
    const again = this.state === "pet";
    this.state = "pet"; this.timer = 7; this.path = [];
    if (this.species === "dog") this.petMode = again ? (this.petMode === "wag" ? "down" : "belly") : (["wag", "wag", "down", "belly"] as const)[Math.floor(rnd() * 4)];
    else this.petMode = again ? (this.petMode === "wag" ? "roll" : "stretch") : (["wag", "roll", "stretch"] as const)[Math.floor(rnd() * 3)];
    if (!again) this.petK = 0;
    if (this.species === "dog") this.quietUntil = performance.now() / 1000 + 300;
    else if (rnd() < 0.5) this.voice();
    return null;
  }
  /** a meow, or a bark — a dog's never within 10 s of the last, and not at all for 5 minutes after
   * it has been stroked (it settles down) */
  private voice() {
    if (this.species !== "dog") { this.sound.play("meow"); return; }
    const now = performance.now() / 1000;
    if (now < this.quietUntil || now - this.lastBark < 10) return;
    this.lastBark = now; this.sound.play("bark");
  }
  private quietUntil = 0; private lastBark = -99;

  private roomOf(p: THREE.Vector2) { return this.shell.roomAt(p.x, p.y); }
  private open(i: number) {
    const o = this.plan.openings[i];
    if (o.type === "open") return true;
    const d = this.shell.doors.find(d => d.opening === o);
    return !d || d.t > 0.55;
  }
  /** a way to a point: through the doorways (BFS over the room graph) */
  private route(to: THREE.Vector2) {
    const from = this.roomOf(this.pos), dest = this.roomOf(to);
    if (!from || !dest) { this.path = [to]; return; }
    if (from === dest) { this.path = [to]; return; }
    const g = this.graph, start = g.centre.get(from.id)!, goal = g.centre.get(dest.id)!;
    const prev = new Map<number, number>([[start, -1]]), q = [start];
    while (q.length) {
      const n = q.shift()!;
      if (n === goal) break;
      for (const m of g.nodes[n].links) {
        if (prev.has(m)) continue;
        if (g.nodes[m].opening !== undefined && !this.open(g.nodes[m].opening!)) continue;
        prev.set(m, n); q.push(m);
      }
    }
    if (!prev.has(goal)) { this.path = []; return; }
    const way: THREE.Vector2[] = [];
    for (let n = goal; n !== -1; n = prev.get(n)!) if (g.nodes[n].opening !== undefined) way.unshift(g.nodes[n].p.clone());
    this.path = [...way, to];
  }
  private somewhere() {
    const rooms = this.plan.rooms.filter(r => r.type !== "utility");
    const r = rooms[Math.floor(rnd() * rooms.length)];
    const [a, b, c, d] = inner(r, 0.5);
    return new THREE.Vector2(a + (c - a) * rnd(), b + (d - b) * rnd());
  }

  /** held still for a close look: sits facing this point (the eye), null lets it go */
  hold: THREE.Vector3 | null = null;
  update(dt: number, w: Walker) {
    if (this.hold) {
      this.state = "sit"; this.timer = 5; this.path = []; this.speed = 0;
      const want = Math.atan2(this.hold.x - this.pos.x, this.hold.z - this.pos.y);
      let dy = want - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      this.yaw += dy * Math.min(1, dt * 4);
      this.lastDist = 1;
      this.pose(dt, false);
      this.root.position.set(this.pos.x, this.shell.floorAt(this.pos.x, this.pos.y), this.pos.y); this.root.rotation.y = this.yaw;
      return;
    }
    const dx = w.x - this.pos.x, dz = w.z - this.pos.y, dist = Math.hypot(dx, dz);
    this.lastDist = dist;
    this.timer -= dt;
    // a running walker close by startles it
    if (this.species === "dog" && w.speed > 2.2 && dist < 3 && this.state !== "come" && this.state !== "pet") { this.state = "come"; this.timer = 8; this.voice(); }
    else if (this.species === "cat" && w.speed > 2.2 && dist < 1.6 && this.state !== "flee") {
      this.state = "flee"; this.voice();
      const away = new THREE.Vector2(this.pos.x - dx * 3, this.pos.y - dz * 3);
      this.route(this.roomOf(away) ? away : this.somewhere());
    }
    switch (this.state) {
      case "sleep": case "sit":
        if (this.timer < 0) {
          // come and see who's there (more often when they sit down), or wander off
          if (dist < (this.species === "dog" ? 7 : 4.5) && rnd() < (w.seated ? 0.85 : this.species === "dog" ? 0.75 : 0.5)) { this.state = "come"; this.timer = 12; }
          else { this.state = "wander"; this.route(this.somewhere()); this.timer = 25; }
        }
        break;
      case "pet":
        if (this.timer < 0) { this.state = "sit"; this.timer = 5 + rnd() * 5; }
        break;
      case "come": {
        const near = w.seated ? 0.55 : 0.75;
        if (dist < near || this.timer < 0) { this.state = "sit"; this.timer = 6 + rnd() * 8; this.path = []; if (rnd() < 0.6) this.voice(); break; }
        const tgt = new THREE.Vector2(w.x - (dx / dist) * near, w.z - (dz / dist) * near);
        if (!this.path.length || this.path[this.path.length - 1].distanceTo(tgt) > 0.5) this.route(tgt);
        break;
      }
      case "wander": case "flee":
        if (!this.path.length || this.timer < 0) { this.state = rnd() < 0.3 ? "sleep" : "sit"; this.timer = 5 + rnd() * 12; this.path = []; }
        break;
    }
    // move along the path
    const dog = this.species === "dog";
    const want = this.state === "flee" ? 2.4 : this.state === "come" ? (dog ? 1.15 + Math.min(1, w.speed / 3) : 0.75) : this.state === "wander" ? (dog ? 0.7 : 0.55) : 0;
    let moving = false;
    if (want > 0 && this.path.length) {
      const tgt = this.path[0], v = tgt.clone().sub(this.pos), l = v.length();
      if (l < 0.12) this.path.shift();
      else {
        const yaw = Math.atan2(v.x, v.y);
        let dy = yaw - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        this.yaw += dy * Math.min(1, dt * 6);
        this.speed += (want - this.speed) * Math.min(1, dt * 4);
        const step = Math.min(l, this.speed * dt);
        const next = this.collide(this.pos.x + Math.sin(this.yaw) * step, this.pos.y + Math.cos(this.yaw) * step, dog ? 0.2 : 0.12);
        // (stuck against something: the next point, or give up)
        if (next.distanceTo(this.pos) < step * 0.2) { this.timer -= dt * 4; if (this.path.length > 1 && this.timer < 2) this.path.shift(); }
        this.pos.copy(next); moving = true;
      }
    } else this.speed *= Math.max(0, 1 - dt * 6);
    if (!moving && (this.state === "sit" || this.state === "pet" || this.state === "come") && dist < 3) {
      // look at the walker
      const yaw = Math.atan2(dx, dz); let dy = yaw - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      this.yaw += dy * Math.min(1, dt * 3);
    }
    this.meowIn -= dt;
    if (this.meowIn < 0) { this.meowIn = (dog ? 20 : 14) + rnd() * 25; if (dist < 6 && this.state !== "sleep") this.voice(); }
    const happy = this.state === "pet" ? Math.min(1, (4 - this.timer) * 2) * (dist < 3 ? 1 : 0.3) : 0;
    if (dog) this.sound.pant(performance.now() / 1000 < this.quietUntil ? 0 : this.state === "come" && dist < 2 ? 0.5 : 0); else this.sound.purr(happy);
    this.pose(dt, moving);
    const fy = this.shell.floorAt(this.pos.x, this.pos.y);
    this.root.position.set(this.pos.x, fy, this.pos.y);
    this.root.rotation.y = this.yaw;
  }

  private pose(dt: number, moving: boolean) {
    if (this.species === "dog") { this.poseDog(dt, moving); return; }
    const j = this.j, s = this.state;
    // (a step cycle is 2 of phase: its rate is the speed over the stride — a cat's ~0.38 m walking,
    // longer as it runs — so the paws keep their place on the floor)
    this.phase += dt * (moving ? (2 * this.speed) / (0.38 + 0.14 * this.speed) : 1.5);
    const w = Math.sin(this.phase * Math.PI), sw = moving ? 0.55 : 0;
    const body = j.body;
    this.petK = s === "pet" ? Math.min(1, this.petK + dt * 1.7) : 0;
    if (s === "pet" && !moving && this.petMode !== "wag") {
      const k = this.petK * this.petK * (3 - 2 * this.petK), wig = Math.sin(this.phase * 2.4);
      if (this.petMode === "roll") {
        // over onto its side and back, belly up, the paws curled; a wriggle
        body.position.set(0, 0.2 - 0.1 * k, 0); body.rotation.set(0, 0, 1.9 * k + wig * 0.12 * k);
        for (const n of ["fl", "fr"]) j[n].rotation.set(-0.9 * k, 0, 0);
        for (const n of ["bl", "br"]) j[n].rotation.set(0.6 * k, 0, 0);
        j.neck.rotation.set(0.2, 0, 0); j.head.rotation.set(0, 0, -0.6 * k);
      } else {
        // the stretch: front paws out along the floor, chest down, rear up, tail high
        body.position.set(0, 0.2 - 0.03 * k, 0); body.rotation.set(0.45 * k, 0, 0);
        for (const n of ["fl", "fr"]) j[n].rotation.set(-1.25 * k, 0, 0);
        for (const n of ["bl", "br"]) j[n].rotation.set(-0.35 * k, 0, 0);
        j.neck.rotation.set(-0.3 * k, 0, 0); j.head.rotation.set(-0.25 * k, 0, 0);
      }
      j.tail0.rotation.set(-0.9, Math.sin(this.phase * 0.9) * 0.4, 0);
      for (let i = 1; i <= 5; i++) j[`tail${i}`].rotation.set(0.1, Math.sin(this.phase * 1.2 + i) * 0.15, 0);
      return;
    }
    if (s === "sleep") {
      body.position.set(0, 0.09, 0); body.rotation.set(0, 0, 0.9);
      for (const n of ["fl", "fr", "bl", "br"]) j[n].rotation.set(-1.4, 0, 0);
      j.neck.rotation.set(0.5, 0.6, 0); j.head.rotation.set(0, 0, 0.3);
      j.tail0.rotation.set(-1.6, 1.2, 0); for (let i = 1; i <= 5; i++) j[`tail${i}`].rotation.set(0, 0.5, 0);
      body.position.y = 0.09 + Math.sin(this.phase * 1.6) * 0.003;
      return;
    }
    body.rotation.set(0, 0, 0);
    if ((s === "sit" || s === "pet") && !moving) {
      body.position.set(0, 0.19, -0.04); body.rotation.x = -0.6;
      j.fl.rotation.set(0.6, 0, 0); j.fr.rotation.set(0.6, 0, 0);
      j.bl.rotation.set(-1.0, 0, 0); j.br.rotation.set(-1.0, 0, 0);
      j.neck.rotation.set(0.5, 0, 0);
      j.head.rotation.set(-0.1, 0, s === "pet" ? Math.sin(this.phase * 2) * 0.25 : 0);
      j.tail0.rotation.set(-1.9, 0.8, 0);
      for (let i = 1; i <= 5; i++) j[`tail${i}`].rotation.set(0, s === "pet" ? 0.05 : 0.3 + Math.sin(this.phase * 0.7 + i) * 0.08, 0);
      return;
    }
    body.position.set(0, 0.2 + Math.abs(w) * 0.008 * (moving ? 1 : 0), 0);
    j.fl.rotation.set(w * sw, 0, 0); j.br.rotation.set(w * sw, 0, 0);
    j.fr.rotation.set(-w * sw, 0, 0); j.bl.rotation.set(-w * sw, 0, 0);
    j.neck.rotation.set(0.15, 0, 0); j.head.rotation.set(-0.15, 0, 0);
    // the tail up and curling at its tip as it trots
    j.tail0.rotation.set(-0.5 - (this.state === "flee" ? 0.6 : 0), Math.sin(this.phase * 0.5) * 0.2, 0);
    for (let i = 1; i <= 5; i++) j[`tail${i}`].rotation.set(i > 3 ? 0.35 : 0.08, Math.sin(this.phase * 0.8 + i * 0.6) * 0.12, 0);
  }


  /** the dog: trots with its head up, sits upright, lies flat with its chin down; the tail curled
   * over the back, wagging fast when it is with you; the tongue out when it is happy */
  private poseDog(dt: number, moving: boolean) {
    const j = this.j, s = this.state;
    // (a Shiba's stride ~0.45 m at a walk, ~0.6 m at a trot: the legs' cycle paced to it — it once
    // swung them two to three times too fast for the ground it covered)
    this.phase += dt * (moving ? (2 * this.speed) / (0.42 + 0.12 * this.speed) : 1.5);
    const w = Math.sin(this.phase * Math.PI), sw = moving ? 0.6 : 0;
    const near = s === "come" || s === "pet" || (s === "sit" && this.lastDist < 2.5);
    this.petK = s === "pet" ? Math.min(1, this.petK + dt * 1.7) : 0;
    this.wag += dt * (s === "pet" ? 30 : near ? 22 : 5);
    const wag = Math.sin(this.wag) * (s === "pet" ? 0.8 : near ? 0.55 : 0.12);
    j.tongue.visible = false; // (no tongue out: as asked)
    // (up from the croup, then curled forward in a ring over the back)
    j.tail0.rotation.set(-0.15, wag * 0.6, 0);
    for (let i = 1; i <= 4; i++) j[`tail${i}`].rotation.set(1.05, wag * 0.15, 0);
    // (ears: pricked when alert, laid back a little when being stroked)
    const back = s === "pet" ? 0.5 : s === "sleep" ? 0.35 : 0;
    j.earL.rotation.x = 0.4 - back; j.earR.rotation.x = 0.4 - back;
    const body = j.body;
    if (s === "sleep") {
      body.position.set(0, 0.12 + Math.sin(this.phase * 1.6) * 0.003, 0); body.rotation.set(0, 0, 0);
      for (const n of ["fl", "fr"]) { j[n].rotation.set(-1.45, 0, 0); j[`${n}k`].rotation.set(0, 0, 0); }
      for (const n of ["bl", "br"]) { j[n].rotation.set(1.2, 0, 0); j[`${n}k`].rotation.set(0.3, 0, 0); }
      j.neck.rotation.set(0.75, 0, 0); j.head.rotation.set(-0.2, 0.25, 0);
      return;
    }
    body.rotation.set(0, 0, 0);
    if (s === "pet" && !moving && this.petMode !== "wag") {
      const k = this.petK * this.petK * (3 - 2 * this.petK);
      if (this.petMode === "down") {
        // down (엎드려): the chest on the floor, forelegs out ahead, hind legs tucked, chin on the paws
        // between looks up; the tail sweeping the floor
        body.position.set(0, 0.29 - 0.16 * k, 0); body.rotation.set(0, 0, 0);
        for (const n of ["fl", "fr"]) { j[n].rotation.set(-1.45 * k, 0, 0); j[`${n}k`].rotation.set(0, 0, 0); }
        for (const n of ["bl", "br"]) { j[n].rotation.set(1.2 * k, 0, 0); j[`${n}k`].rotation.set(0.3 + 1.6 * k, 0, 0); }
        const look = Math.max(0, Math.sin(this.phase * 0.5));
        j.neck.rotation.set(0.1 + 0.55 * k * (1 - look), 0, 0); j.head.rotation.set(-0.15 * k, 0, Math.sin(this.phase * 1.3) * 0.08);
        j.tail0.rotation.set(-0.15 - 0.9 * k, wag * 0.9, 0);
      } else {
        // the belly: rolled onto its back (a little to one side), legs folded up in the air, wriggling
        const wig = Math.sin(this.phase * 2.6) * 0.14 * k;
        body.position.set(0, 0.29 - 0.12 * k, 0); body.rotation.set(0, 0, 2.55 * k + wig);
        for (const n of ["fl", "fr"]) { j[n].rotation.set(-0.5 * k + Math.sin(this.phase * 3 + (n === "fl" ? 0 : 1.6)) * 0.15 * k, 0, 0); j[`${n}k`].rotation.set(-1.3 * k, 0, 0); }
        for (const n of ["bl", "br"]) { j[n].rotation.set(0.7 * k, 0, 0); j[`${n}k`].rotation.set(1.1 * k, 0, 0); }
        j.neck.rotation.set(0.1, 0, 0); j.head.rotation.set(0.2 * k, 0, -0.5 * k);
        j.tail0.rotation.set(-0.15 - 0.6 * k, wag * 0.7, 0);
      }
      return;
    }
    if ((s === "sit" || s === "pet") && !moving) {
      body.position.set(0, 0.25, -0.06); body.rotation.x = -0.55;
      // (front legs straight and upright under the raised chest; the hind legs folded: thigh
      // forward along the ground, the hock back under it, the foot flat)
      for (const n of ["fl", "fr"]) { j[n].rotation.set(0.55, 0, 0); j[`${n}k`].rotation.set(0, 0, 0); }
      for (const n of ["bl", "br"]) { j[n].rotation.set(-0.95, 0, 0); j[`${n}k`].rotation.set(2.3, 0, 0); }
      // (the body sits up, so the neck and head come forward again to look level)
      j.neck.rotation.set(0.45, 0, 0);
      j.head.rotation.set(0.12 + (s === "pet" ? 0.12 : 0), 0, s === "pet" ? Math.sin(this.phase * 2.2) * 0.18 : Math.sin(this.phase * 0.6) * 0.15);
      return;
    }
    body.position.set(0, 0.29 + Math.abs(w) * 0.012 * (moving ? 1 : 0), 0);
    // (a trot: diagonal pairs together; the lower legs flex as each foot swings forward; the hind
    // legs angulated at the stifle when standing)
    const lift = (x: number) => Math.max(0, x) * (moving ? 0.9 : 0);
    j.fl.rotation.set(w * sw, 0, 0); j.br.rotation.set(-0.2 + w * sw, 0, 0);
    j.fr.rotation.set(-w * sw, 0, 0); j.bl.rotation.set(-0.2 - w * sw, 0, 0);
    j.flk.rotation.set(-lift(-w), 0, 0); j.frk.rotation.set(-lift(w), 0, 0);
    j.blk.rotation.set(0.3 + lift(w), 0, 0); j.brk.rotation.set(0.3 + lift(-w), 0, 0);
    j.neck.rotation.set(-0.1, 0, 0); j.head.rotation.set(0.05 + Math.abs(w) * 0.04, 0, 0);
  }

  dispose() { this.geos.forEach(g => g.dispose()); this.mats.forEach(m => m.dispose()); (this.hit.material as THREE.Material).dispose(); }
}

// ------------------------------------------------------------------ the robot vacuum

export class Robot {
  readonly root = new THREE.Group();
  readonly hit: THREE.Mesh;
  pos = new THREE.Vector2(); yaw = 0;
  cleaning = false;
  private brush: THREE.Object3D; private led: THREE.MeshBasicMaterial;
  private turn = 0; private geos: THREE.BufferGeometry[] = []; private mats: THREE.Material[] = [];
  private home: THREE.Vector2; private homeYaw: number;
  covered = 0;

  constructor(dock: { pos: THREE.Vector3; out: THREE.Vector3 }, private shell: Shell, private collide: Collide, private sound: Sound) {
    const shell1 = new THREE.MeshPhysicalMaterial({ color: "#f2f2f0", roughness: 0.25, clearcoat: 1 }), top = new THREE.MeshPhysicalMaterial({ color: "#1c1d20", roughness: 0.15, clearcoat: 1, metalness: 0.2 });
    const grey = new THREE.MeshStandardMaterial({ color: "#5c5f63", roughness: 0.6 });
    this.led = new THREE.MeshBasicMaterial({ color: "#47b6ff" });
    this.mats.push(shell1, top, grey, this.led);
    const g = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => { this.geos.push(geo); const me = new THREE.Mesh(geo, m); me.position.y = y; me.castShadow = false; me.receiveShadow = true; this.root.add(me); return me; };
    g(new THREE.CylinderGeometry(0.175, 0.175, 0.07, 48), shell1, 0.045);
    g(new THREE.CylinderGeometry(0.16, 0.165, 0.012, 48), top, 0.085);
    g(new THREE.CylinderGeometry(0.045, 0.045, 0.022, 32), grey, 0.1).position.set(0, 0.1, -0.06);
    const bumper = g(new THREE.CylinderGeometry(0.177, 0.177, 0.035, 48, 1, true, -1.2, 2.4), grey, 0.035); bumper.rotation.y = 0;
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.01), this.led); led.position.set(0, 0.092, 0.09); this.root.add(led); this.geos.push(led.geometry);
    this.brush = new THREE.Group(); this.brush.position.set(0.12, 0.012, 0.12); this.root.add(this.brush);
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.002, 0.008), grey); b.position.x = 0.04; const a = new THREE.Group(); a.rotation.y = (i * Math.PI * 2) / 3; a.add(b); this.brush.add(a); this.geos.push(b.geometry); }
    // its dock against the wall
    const dk = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.08), top); this.geos.push(dk.geometry);
    const yaw = Math.atan2(dock.out.x, dock.out.z);
    dk.position.set(dock.pos.x, 0.06, dock.pos.z); dk.rotation.y = yaw; dk.castShadow = true;
    this.dockMesh = dk;
    const hg = new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12); this.geos.push(hg);
    this.hit = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ visible: false })); this.hit.position.y = 0.06; this.root.add(this.hit);
    this.home = new THREE.Vector2(dock.pos.x + dock.out.x * 0.3, dock.pos.z + dock.out.z * 0.3);
    this.homeYaw = yaw;
    this.pos.copy(this.home); this.yaw = yaw;
  }
  readonly dockMesh: THREE.Mesh;

  label() { return this.cleaning ? "로봇청소기 멈추기" : "로봇청소기 청소 시작"; }
  toggle() { this.cleaning = !this.cleaning; this.turn = 0; return "beep" as const; }

  update(dt: number, avoid: { x: number; z: number; r: number }[]) {
    this.sound.whirr(this.cleaning ? 1 : 0);
    this.led.color.set(this.cleaning ? "#47ff9a" : "#47b6ff");
    if (!this.cleaning) { this.place(); return; }
    this.brush.rotation.y += dt * 14;
    if (this.turn > 0) {
      // turning on the spot after a bump
      const r = Math.min(this.turn, dt * 2.2); this.yaw += r; this.turn -= r;
    } else {
      const sp = 0.3, nx = this.pos.x + Math.sin(this.yaw) * sp * dt, nz = this.pos.y + Math.cos(this.yaw) * sp * dt;
      const p = this.collide(nx, nz, 0.18);
      const room = this.shell.roomAt(p.x, p.y);
      const blocked = p.distanceTo(new THREE.Vector2(nx, nz)) > 0.004 || !room || (room.floorDrop ?? 0) > 0.05 || avoid.some(a => Math.hypot(a.x - p.x, a.z - p.y) < a.r + 0.18);
      if (blocked) { this.turn = 1.2 + Math.random() * 2; this.sound.play("thud"); }
      else { this.covered += sp * dt; this.pos.copy(p); }
    }
    this.place();
  }
  private place() {
    this.root.position.set(this.pos.x, this.shell.floorAt(this.pos.x, this.pos.y), this.pos.y);
    this.root.rotation.y = this.yaw;
  }
  dispose() { this.geos.forEach(g => g.dispose()); this.mats.forEach(m => m.dispose()); (this.hit.material as THREE.Material).dispose(); void this.homeYaw; }
}
