import * as THREE from "three";
import type { Look } from "./complexScene";
import { mergeStatic } from "./sceneMerge";

/* A hot-air balloon over the complex, day and night, in any weather: a full-size
 * envelope (about 18 m across, 22 m tall) of sixteen coloured gores with a crown band,
 * load tapes and a throat; eight cables down to a wicker basket with a leather rim, a
 * burner frame and burners that fire now and then — at night the envelope glows from
 * inside while they burn. It circles the complex slowly, rising and sinking, turning
 * gently as balloons do, right over the apartments, its basket 9-27 m above the tallest
 * roof. From its basket the complex can be looked down on
 * (ComplexHologram's balloon view).
 * World frame, metres; the envelope's throat is 6 m above the basket floor. */

const GORES = 16;
const PALETTE = ["#e63b2e", "#f6c343", "#2f7fd8", "#ffffff", "#27a86b", "#f07c2b", "#7a4fd1", "#ffffff"];

function envelopeGeometry() {
  // Profile (radius, height) from the throat up: a classic teardrop.
  const prof: [number, number][] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28, y = 6 + t * 22;
    const r = t < 0.12 ? 2.2 + (t / 0.12) * 1.6 : 9 * Math.sin(Math.min(Math.PI, 0.35 + (t - 0.12) / 0.88 * (Math.PI - 0.35))) ** 0.75 + (t > 0.97 ? 0 : 0.3);
    prof.push([Math.max(t >= 1 ? 0.01 : 0.6, r), y]);
  }
  prof[prof.length - 1] = [0.01, 28];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), GORES * 4).toNonIndexed();
  // Colour per face by its gore and height: crisp vertical stripes, a band round the
  // equator, a crown in one colour; slightly darker along the load tapes.
  const pos = geo.getAttribute("position"), col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += pos.getX(f + k); y += pos.getY(f + k); z += pos.getZ(f + k); }
    x /= 3; y /= 3; z /= 3;
    const a = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1, gore = Math.floor(a * GORES), within = a * GORES - gore;
    let hex = PALETTE[gore % PALETTE.length];
    if (y > 25.5) hex = "#e63b2e";
    else if (y > 15.5 && y < 17.5) hex = "#1f2b5c";
    else if (y < 8.5) hex = "#3a3a3a";
    c.set(hex);
    if (within < 0.06 || within > 0.94) c.multiplyScalar(0.72);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildBalloon() {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const keep = <T extends THREE.BufferGeometry>(g: T) => { geos.push(g); return g; };
  const mat = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(p); mats.push(m); return m; };
  const group = new THREE.Group();
  const body = new THREE.Group();          // everything that sways together
  group.add(body);
  // Double-sided: from the basket, looking up, the inside of the envelope shows.
  const envMat = mat({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, emissive: "#ff9a3c", emissiveIntensity: 0 });
  const envelope = new THREE.Mesh(keep(envelopeGeometry()), envMat);
  envelope.castShadow = true;
  body.add(envelope);
  // Basket: wicker sides, leather rim, a floor.
  const wicker = mat({ color: "#9a6a36", roughness: 0.95 });
  const leather = mat({ color: "#4a2f1c", roughness: 0.7 });
  const steel = mat({ color: "#b9bec4", roughness: 0.35, metalness: 0.85 });
  const basket = new THREE.Group();
  body.add(basket);
  const side = keep(new THREE.BoxGeometry(1.5, 1.1, 0.06));
  for (const [x, z, ry] of [[0, 0.72, 0], [0, -0.72, 0], [0.72, 0, Math.PI / 2], [-0.72, 0, Math.PI / 2]] as const) {
    const m = new THREE.Mesh(side, wicker); m.position.set(x, 0.55, z); m.rotation.y = ry; m.castShadow = true; basket.add(m);
  }
  const floorM = new THREE.Mesh(keep(new THREE.BoxGeometry(1.5, 0.08, 1.5)), wicker); floorM.position.y = 0.04; basket.add(floorM);
  const rim = keep(new THREE.TorusGeometry(1.03, 0.07, 6, 4));
  const rimM = new THREE.Mesh(rim, leather); rimM.rotation.set(Math.PI / 2, 0, Math.PI / 4); rimM.position.y = 1.1; rimM.scale.set(1, 1, 1); basket.add(rimM);
  // Uprights and the burner frame above the basket, the burner under the throat.
  const post = keep(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6));
  for (const [x, z] of [[0.62, 0.62], [-0.62, 0.62], [0.62, -0.62], [-0.62, -0.62]]) { const m = new THREE.Mesh(post, steel); m.position.set(x * 0.8, 1.85, z * 0.8); m.rotation.set(-z * 0.25, 0, x * 0.25); basket.add(m); }
  const burner = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.28, 0.32, 0.35, 12)), steel); burner.position.y = 2.65; basket.add(burner);
  const tank = keep(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 10));
  for (const [x, z] of [[0.4, 0.4], [-0.4, -0.4]]) { const m = new THREE.Mesh(tank, steel); m.position.set(x, 0.45, z); basket.add(m); }
  // Cables from the basket corners to the throat's load ring.
  const cable = keep(new THREE.CylinderGeometry(0.012, 0.012, 1, 3));
  const cableMat = mat({ color: "#2b2b2b", roughness: 0.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const from = new THREE.Vector3(Math.cos(a) * 0.95, 1.1, Math.sin(a) * 0.95), to = new THREE.Vector3(Math.cos(a) * 2.25, 6.05, Math.sin(a) * 2.25);
    const d = to.clone().sub(from), m = new THREE.Mesh(cable, cableMat);
    m.position.copy(from).addScaledVector(d, 0.5); m.scale.y = d.length(); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    body.add(m);
  }
  // Burner flames: two cones, flickering; hidden between burns.
  const flameMat = mat({ color: "#000000", emissive: "#ffb347", emissiveIntensity: 6, transparent: true, opacity: 0.85, depthWrite: false, roughness: 1 });
  const flameCore = mat({ color: "#000000", emissive: "#bfe3ff", emissiveIntensity: 8, transparent: true, opacity: 0.9, depthWrite: false, roughness: 1 });
  const flames = new THREE.Group();
  const fl = new THREE.Mesh(keep(new THREE.ConeGeometry(0.22, 1.6, 10, 1, true)), flameMat); fl.position.y = 3.65; flames.add(fl);
  const core = new THREE.Mesh(keep(new THREE.ConeGeometry(0.09, 0.8, 8, 1, true)), flameCore); core.position.y = 3.25; flames.add(core);
  // (never hidden: shrunk between burns, so the renderers keep their pipelines)
  flames.scale.setScalar(0.0001);
  body.add(flames);
  // Basket, frame, tanks and cables ride together: one mesh per material (the envelope,
  // which glows, and the flickering flames stay apart).
  const hardware = mergeStatic(body, o => o === envelope || o === flames);
  geos.push(...hardware.map(m => m.geometry));

  // ---- flight ----
  let center = new THREE.Vector3(), radius = 200, base = 80, time = 0, night = 0, burn = 0, nextBurn = 3;
  const heading = { yaw: 0 };
  const place = () => {
    // Circling at ~3 m/s; height swinging slowly between ~10 and ~70 m over the roofs
    // (low enough to sit in the opening view's sky, just above the skyline).
    // Starting beyond the complex from the opening view (it looks in from +x +z), in
    // that view's sky, then on round.
    const w = 3 / radius, a = time * w - 2.36;
    const r = radius * (1 + 0.12 * Math.sin(time * 0.021));
    const y = base + 6 * Math.sin(time * 0.043) + 3 * Math.sin(time * 0.11 + 1.3);
    group.position.set(center.x + Math.cos(a) * r, y, center.z + Math.sin(a) * r);
    // A slow spin of its own, and a gentle pendulum sway of basket and envelope.
    heading.yaw = time * 0.05;
    body.rotation.set(0.02 * Math.sin(time * 0.7), heading.yaw, 0.025 * Math.sin(time * 0.53 + 0.7));
  };
  return {
    group,
    /** Things a click on the balloon can hit. */
    pickables: [envelope, ...hardware] as THREE.Object3D[],
    /** Over this complex: its centre, its footprint's size, how high the roofs are. */
    setRoute(c: THREE.Vector3, span: number, roofTop: number) {
      // Over the complex itself: a circle inside its footprint, the basket 9-27 m over
      // the tallest roof (never low enough to touch a tower).
      center = c.clone(); radius = Math.max(35, span * 0.42); base = roofTop + 18;
      place();
    },
    update(dt: number) {
      if (!(dt > 0)) return;
      time += Math.min(dt, 0.1);
      place();
      // Burns every few seconds, longer ones as it climbs; the flame flickers.
      if (burn > 0) burn -= dt; else if ((nextBurn -= dt) <= 0) { burn = 0.8 + Math.random() * 1.8; nextBurn = 4 + Math.random() * 7; }
      if (burn > 0) { const f = 0.85 + Math.random() * 0.3; flames.scale.set(1, f, 1); } else flames.scale.setScalar(0.0001);
      envMat.emissiveIntensity = burn > 0 ? 0.35 * night : 0.03 * night;
    },
    /** Glow from the burner reads at night (Look.stars 1), barely by day. */
    setLook(l: Look) { night = l.stars; },
    /** The basket's position and the balloon's own heading (the view from it). */
    basket(out: THREE.Vector3) { return out.copy(group.position); },
    get yaw() { return heading.yaw; },
    dispose() { geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); },
  };
}
export type Balloon = ReturnType<typeof buildBalloon>;
