import * as THREE from "three";
import { mergeMeshChildren } from "../interior/geom";

/* The walker: a person of jointed, rounded parts (no rig to download) in casual clothes, posed each
 * frame by a walk cycle, or seated, or lying. Seen from behind in the third-person view and in the
 * bathroom mirrors in the first. */

export type Pose = "stand" | "sit" | "lie" | "cycle";

export class Avatar {
  private static fabric: THREE.Texture | null = null;
  readonly root = new THREE.Group();
  private parts: Record<string, THREE.Object3D> = {};
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private textures: THREE.Texture[] = [];
  private phase = 0;
  private pedalPhase = 0;
  private cycleSteer = 0;
  pose: Pose = "stand";
  private shoeM!: THREE.MeshPhysicalMaterial; private soleM!: THREE.Material;
  private sway = 0; private runK = 0;

  /** `outfit`: clothes for a part (a doctor's white coat, a nurse's scrubs) instead of the seed's casual ones */
  constructor(seed = 1, outfit?: { top?: string; bottom?: string; hair?: string; shoe?: string }) {
    let s = seed * 48271 + 11;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    const skinTones = ["#e9c4a6", "#dcb08f", "#c99a78", "#f0cfb5"];
    const tops = ["#2f3e52", "#e8e4dc", "#6a7356", "#8a3c35", "#3a3a3c", "#c9b89a"];
    const bottoms = ["#2a2c33", "#5a5f6a", "#c7bba8", "#1e2a3c"];
    const mat = (c: string, r = 0.8, sheen = 0) => { const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: r, sheen, sheenColor: new THREE.Color("#ffffff") }); this.mats.push(m); return m; };
    const skin = mat(skinTones[Math.floor(rnd() * skinTones.length)], 0.55); (skin as THREE.MeshPhysicalMaterial).sheen = 0.3;
    const top = mat(outfit?.top ?? tops[Math.floor(rnd() * tops.length)], 0.9, 0.5), bottom = mat(outfit?.bottom ?? bottoms[Math.floor(rnd() * bottoms.length)], 0.85, 0.3);
    const hair = mat(outfit?.hair ?? "#1c1612", 0.6, 0.6), shoe = mat(outfit?.shoe ?? "#f2f2f0", 0.5), sole = mat("#3a3a3a", 0.9);
    this.shoeM = shoe as THREE.MeshPhysicalMaterial; this.soleM = sole;
    // A fine woven normal map stays shared by the garments, rather than adding fabric geometry.
    const weaveSize = 128, weave = new Uint8Array(weaveSize * weaveSize * 4);
    for (let y = 0; y < weaveSize; y++) for (let x = 0; x < weaveSize; x++) {
      const i = (y * weaveSize + x) * 4;
      weave[i] = 128 + Math.sin(x * Math.PI / 2) * 12; weave[i + 1] = 128 + Math.sin(y * Math.PI / 2) * 12; weave[i + 2] = 253; weave[i + 3] = 255;
    }
    const cloth = new THREE.DataTexture(weave, weaveSize, weaveSize); cloth.wrapS = cloth.wrapT = THREE.RepeatWrapping; cloth.repeat.set(5, 5); cloth.generateMipmaps = true; cloth.minFilter = THREE.LinearMipmapLinearFilter; cloth.needsUpdate = true; this.textures.push(cloth);
    for (const garment of [top, bottom]) { garment.normalMap = cloth; garment.normalScale.set(0.35, 0.35); garment.sheen = 0.2; garment.sheenColor.copy(garment.color); garment.sheenRoughness = 0.82; garment.specularIntensity = 0.25; }
    // (one fabric for everyone: a building's people share the walker's, loaded once)
    const fabric = Avatar.fabric ??= (() => { const t = new THREE.TextureLoader().load("/3d/walk/tex/rough_linen_nor.webp"); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.anisotropy = 8; return t; })();
    for (const garment of [top, bottom]) { garment.normalMap = fabric; garment.normalScale.set(0.18, 0.18); }
    hair.sheen = 0.06; hair.roughness = 0.82; hair.specularIntensity = 0.28;
    skin.roughness = 0.57; skin.sheen = 0.12; skin.sheenRoughness = 0.85; skin.clearcoat = 0.025; skin.specularIntensity = 0.35;
    const pores = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < pores.length; i += 4) { const n = rnd() - 0.5; pores[i] = 128 + n * 18; pores[i + 1] = 128 + (rnd() - 0.5) * 18; pores[i + 2] = 254; pores[i + 3] = 255; }
    const skinNormal = new THREE.DataTexture(pores, 256, 256); skinNormal.wrapS = skinNormal.wrapT = THREE.RepeatWrapping; skinNormal.repeat.set(3, 3); skinNormal.generateMipmaps = true; skinNormal.minFilter = THREE.LinearMipmapLinearFilter; skinNormal.needsUpdate = true;
    this.textures.push(skinNormal); skin.normalMap = skinNormal; skin.normalScale.set(0.12, 0.12);
    const cap = (r: number, l: number, m: THREE.Material) => { const g = new THREE.CapsuleGeometry(r, l, 6, 16); this.geos.push(g); const me = new THREE.Mesh(g, m); me.castShadow = true; me.receiveShadow = true; return me; };
    const joint = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); this.parts[name] = j; return j; };
    const lathe = (pts: [number, number][], m: THREE.Material, sz = 0.68) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 32); g.scale(1, 1, sz); this.geos.push(g); const me = new THREE.Mesh(g, m); me.castShadow = true; me.receiveShadow = true; return me; };
    const hips = joint("hips", this.root, 0, 0.95, 0);
    // pelvis and belt line (trousers)
    hips.add(lathe([[0.001, -0.1], [0.13, -0.1], [0.155, -0.04], [0.15, 0.04], [0.14, 0.09], [0.001, 0.09]], bottom, 0.72));
    const spine = joint("spine", hips, 0, 0.08, 0);
    // the torso: waist, chest, shoulders — a T-shirt
    const torso = lathe([[0.001, 0], [0.138, 0], [0.146, 0.035], [0.139, 0.07], [0.142, 0.1], [0.17, 0.26], [0.19, 0.36], [0.18, 0.44], [0.12, 0.5], [0.06, 0.53], [0.001, 0.535]], top, 0.68);
    spine.add(torso);
    const collarG = new THREE.TorusGeometry(0.057, 0.008, 8, 40); collarG.rotateX(Math.PI / 2); collarG.scale(1, 1, 0.8); collarG.translate(0, 0.526, 0); this.geos.push(collarG); spine.add(new THREE.Mesh(collarG, top));
    const neck = joint("neck", spine, 0, 0.52, 0);
    const neckM = cap(0.045, 0.07, skin); neckM.position.y = 0.04; neck.add(neckM);
    const head = joint("head", neck, 0, 0.11, 0);
    // skull and jaw
    const headG = new THREE.SphereGeometry(0.098, 36, 28); headG.scale(0.86, 1.08, 1); this.geos.push(headG);
    const headM = new THREE.Mesh(headG, skin); headM.position.y = 0.1; headM.castShadow = true; head.add(headM);
    const jawG = new THREE.SphereGeometry(0.07, 28, 20); jawG.scale(0.95, 0.9, 1.05); this.geos.push(jawG);
    const jaw = new THREE.Mesh(jawG, skin); jaw.position.set(0, 0.045, 0.018); head.add(jaw);
    for (const sx of [-1, 1]) { const e = cap(0.014, 0.02, skin); e.position.set(sx * 0.085, 0.095, -0.005); e.scale.set(0.6, 1, 1); head.add(e); }
    const nose = cap(0.011, 0.025, skin); nose.position.set(0, 0.085, 0.094); nose.rotation.x = 0.25; head.add(nose);
    // hair: a cut that covers the crown and the back, a fringe over the brow
    const hairG = new THREE.SphereGeometry(0.104, 36, 20, 0, Math.PI * 2, 0, Math.PI * 0.6); hairG.scale(0.9, 1.06, 1.05); this.geos.push(hairG);
    const hairM = new THREE.Mesh(hairG, hair); hairM.position.set(0, 0.112, -0.012); hairM.rotation.x = -0.35; hairM.castShadow = true; head.add(hairM);
    const fringeG = new THREE.SphereGeometry(0.1, 28, 10, -1.2, 2.4, 0.3, 0.55); fringeG.scale(0.9, 1.0, 1.06); this.geos.push(fringeG);
    const fringe = new THREE.Mesh(fringeG, hair); fringe.position.set(0, 0.118, 0.0); head.add(fringe);
    // Short combed locks break the helmet silhouette, merged into the hair draw.
    for (let lock = 0; lock < 38; lock++) {
      const angle = lock / 38 * Math.PI * 2, radius = 0.06 + rnd() * 0.03;
      const a = new THREE.Vector3(Math.cos(angle) * radius * 0.6, 0.19, Math.sin(angle) * radius * 0.6 - 0.012);
      const b = new THREE.Vector3(Math.cos(angle + 0.13) * radius, 0.17 + rnd() * 0.025, Math.sin(angle + 0.13) * radius - 0.009);
      const c = new THREE.Vector3(Math.cos(angle + 0.24) * radius * 1.06, 0.118 + rnd() * 0.035, Math.sin(angle + 0.24) * radius * 1.1 - 0.006);
      const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, b, c), 5, 0.003 + rnd() * 0.0025, 4, false);
      this.geos.push(g); head.add(new THREE.Mesh(g, hair));
    }
    // Shaped eyes, pupils, eyelids, eyebrows and lips give a readable face at close walking distance.
    const sclera = mat("#e9e8e2", 0.24), iris = mat("#4e382b", 0.32), lips = mat("#a56d60", 0.64);
    const oval = (parent: THREE.Object3D, m: THREE.Material, radius: number, position: [number, number, number], scale: [number, number, number]) => {
      const geo = new THREE.SphereGeometry(radius, 20, 14); this.geos.push(geo);
      const mesh = new THREE.Mesh(geo, m); mesh.position.set(...position); mesh.scale.set(...scale); mesh.castShadow = true; parent.add(mesh); return mesh;
    };
    for (const sx of [-1, 1]) {
      oval(head, sclera, 0.018, [sx * 0.038, 0.105, 0.089], [1, 0.48, 0.48]);
      oval(head, iris, 0.008, [sx * 0.038, 0.105, 0.097], [1, 1, 0.32]);
      oval(head, hair, 0.0041, [sx * 0.038, 0.105, 0.1], [1, 1, 0.3]);
      oval(head, sclera, 0.0018, [sx * 0.038 - 0.002, 0.108, 0.102], [1, 1, 0.5]);
      oval(head, skin, 0.019, [sx * 0.038, 0.116, 0.087], [1.15, 0.23, 0.43]);
      oval(head, hair, 0.021, [sx * 0.038, 0.133, 0.084], [1.15, 0.14, 0.3]);
      oval(head, lips, 0.007, [sx * 0.012, 0.068, 0.103], [0.55, 0.5, 0.45]);
      oval(head, lips, 0.023, [sx * 0.009, 0.036, 0.085], [0.7, 0.12, 0.26]);
      oval(head, skin, 0.016, [sx * 0.093, 0.09, -0.006], [0.25, 1.1, 0.6]);
    }
    oval(head, lips, 0.023, [0, 0.03, 0.087], [1, 0.12, 0.25]);
    oval(head, skin, 0.035, [0, 0.016, 0.065], [1, 0.36, 0.46]);
    for (const sx of [-1, 1]) {
      const sh = joint(sx < 0 ? "lShoulder" : "rShoulder", spine, sx * 0.175, 0.44, 0);
      const sleeve = cap(0.05, 0.12, top); sleeve.position.y = -0.08; sh.add(sleeve);
      sh.add(lathe([[0.049, -0.15], [0.052, -0.145], [0.052, -0.133], [0.048, -0.13]], top, 1));
      const upper = cap(0.04, 0.2, skin); upper.position.y = -0.15; sh.add(upper);
      const el = joint(sx < 0 ? "lElbow" : "rElbow", sh, 0, -0.29, 0);
      const fore = cap(0.035, 0.2, skin); fore.position.y = -0.13; el.add(fore);
      const hand = cap(0.032, 0.05, skin); hand.position.y = -0.29; hand.scale.set(1, 1, 0.55); el.add(hand);
      for (let finger = 0; finger < 4; finger++) {
        const tip = cap(0.007, 0.031 + (finger === 1 || finger === 2 ? 0.007 : 0), skin);
        tip.position.set((finger - 1.5) * 0.013, -0.342, 0.008); tip.rotation.x = -0.08; el.add(tip);
      }
      const thumb = cap(0.009, 0.027, skin); thumb.position.set(sx * -0.035, -0.297, 0.014); thumb.rotation.z = sx * -0.45; el.add(thumb);
      const hip = joint(sx < 0 ? "lHip" : "rHip", hips, sx * 0.085, -0.04, 0);
      const thigh = lathe([[0.001, -0.42], [0.058, -0.42], [0.07, -0.2], [0.08, -0.05], [0.075, 0.02], [0.001, 0.02]], bottom, 1);
      hip.add(thigh);
      const knee = joint(sx < 0 ? "lKnee" : "rKnee", hip, 0, -0.42, 0);
      const shin = lathe([[0.001, -0.42], [0.048, -0.42], [0.056, -0.25], [0.06, -0.08], [0.058, 0.02], [0.001, 0.02]], bottom, 1);
      knee.add(shin);
      const ankle = joint(sx < 0 ? "lAnkle" : "rAnkle", knee, 0, -0.43, 0);
      const fg = new THREE.CapsuleGeometry(0.045, 0.17, 6, 16); fg.rotateX(Math.PI / 2); fg.scale(1, 0.75, 1); this.geos.push(fg);
      const foot = new THREE.Mesh(fg, shoe); foot.position.set(0, -0.025, 0.05); foot.castShadow = true; ankle.add(foot);
      const sg = new THREE.BoxGeometry(0.095, 0.02, 0.26); this.geos.push(sg);
      const so = new THREE.Mesh(sg, sole); so.position.set(0, -0.058, 0.05); ankle.add(so);
      for (let lace = 0; lace < 4; lace++) {
        const g = new THREE.BoxGeometry(0.068, 0.007, 0.009); g.translate(0, 0.01, 0.015 + lace * 0.026); this.geos.push(g); ankle.add(new THREE.Mesh(g, sole));
      }
    }
    // (each joint's parts one mesh a material)
    const all: THREE.Object3D[] = []; this.root.traverse(o => all.push(o));
    for (const o of all) this.geos.push(...mergeMeshChildren(o));
  }

  /** Pedals follow actual distance, so a stopped or blocked bicycle never pedals in place. */
  pedal(distance: number, steer: number) { this.pose = "cycle"; this.pedalPhase += distance / (0.34 * 2.8); this.cycleSteer = steer; }
  /** A seated speaker turns their head while their body stays aligned with the chair. */
  lookSide(yaw: number) { this.parts.neck.rotation.y = THREE.MathUtils.clamp(yaw, -.7, .7); }

  /** speed: m/s along the ground; dt: s */
  update(dt: number, speed: number) {
    const p = this.parts, t = this.pose;
    const set = (n: string, x: number, y = 0, z = 0) => { p[n].rotation.set(x, y, z); };
    if (t === "stand") {
      // A gait from the walking and running cycles of real people: the thigh swings on a sine,
      // the knee folds early in the swing (to clear the toe) and a little as the heel lands, the
      // ankle lifts the toe for the heel strike and points for the push-off; the pelvis bobs twice a
      // stride, sways over the standing foot and turns with the swinging leg, the chest turns back
      // against it and the arms swing with the opposite legs. Running (from ~2.5 m/s): a forward
      // lean, elbows held at a right angle and pumping, the knee driven high, the heel kicked up,
      // the body rising in the flight between steps. The head kept level all the while.
      // (past a run, a sprint: the steps quicken less than the speed, the stride lengthens)
      this.phase += dt * (speed > 0.05 ? 1.75 + Math.min(speed, 3.5) * 0.62 + Math.max(0, speed - 3.5) * 0.75 : 0);
      const a = Math.min(1, speed / 1.2);
      this.runK += (Math.min(1, Math.max(0, (speed - 2.3) / 1.4)) - this.runK) * Math.min(1, dt * 6);
      const run = this.runK, ph = this.phase * Math.PI;
      const leg = (o: number) => {
        const q = ph + o, sw = Math.sin(q);                                  // +: thigh forward
        const swingK = Math.max(0, Math.sin(q + 0.9));                       // swing phase (foot off)
        const hip = sw * (0.42 * a * (1 - run) + 0.78 * run) + run * 0.18;
        const knee = a * (0.1 + 0.62 * Math.pow(swingK, 1.4)) * (1 - run) + run * (0.35 + 1.55 * Math.pow(swingK, 1.2));
        const ankle = a * (0.22 * Math.sin(q + 2.2) - 0.05) * (1 - run) + run * (0.3 * Math.sin(q + 2.0) - 0.15);
        return { hip, knee, ankle };
      };
      const L = leg(0), Rl = leg(Math.PI);
      set("lHip", -L.hip); set("rHip", -Rl.hip);
      set("lKnee", L.knee + 0.04); set("rKnee", Rl.knee + 0.04);
      set("lAnkle", L.ankle); set("rAnkle", Rl.ankle);
      // pelvis: bob (twice a stride; a run rises in flight), sway, turn
      const bob = Math.abs(Math.sin(ph)), lean = 0.06 * a * (1 - run) + 0.3 * run;
      p.hips.position.set(Math.sin(ph) * 0.018 * a * (1 - run), 0.95 - 0.022 * a * (1 - run) + (0.045 * bob - 0.04) * run - bob * 0.012 * a * (1 - run), 0);
      p.hips.rotation.set(0, Math.sin(ph) * (0.09 * a + 0.12 * run), Math.sin(ph) * 0.035 * a * (1 - run));
      set("spine", lean, -Math.sin(ph) * (0.14 * a + 0.2 * run), -Math.sin(ph) * 0.02 * a);
      set("neck", -lean * 0.85 + 0.02, Math.sin(ph) * (0.05 * a + 0.08 * run));
      // arms: opposite the legs; bent and pumping in a run
      const armSw = 0.36 * a * (1 - run) + 0.95 * run;
      // (+ back: the left arm back as the left leg goes forward)
      const lArm = Math.sin(ph), rArm = Math.sin(ph + Math.PI);
      set("lShoulder", lArm * armSw - run * 0.15, 0, -0.06 - run * 0.08); set("rShoulder", rArm * armSw - run * 0.15, 0, 0.06 + run * 0.08);
      set("lElbow", -0.18 - Math.max(0, -lArm) * 0.3 * a * (1 - run) - run * (1.4 + 0.3 * Math.max(0, -lArm)));
      set("rElbow", -0.18 - Math.max(0, -rArm) * 0.3 * a * (1 - run) - run * (1.4 + 0.3 * Math.max(0, -rArm)));
      // (breathing and a slight shift of weight when still)
      if (speed < 0.05) {
        this.sway += dt; this.phase = 0;
        p.spine.rotation.x = Math.sin(this.sway * 1.6) * 0.012; p.hips.rotation.z = Math.sin(this.sway * 0.35) * 0.02;
        p.lShoulder.rotation.z = -0.07 - Math.sin(this.sway * 1.6) * 0.01; p.rShoulder.rotation.z = 0.07 + Math.sin(this.sway * 1.6) * 0.01;
        p.lElbow.rotation.x = -0.12; p.rElbow.rotation.x = -0.12;
      }
    } else if (t === "cycle") {
      p.hips.position.set(0, 1.11, -0.29); p.hips.rotation.set(0, 0, 0);
      set("spine", 0.28, this.cycleSteer * 0.12); set("neck", -0.2);
      for (const [side, phase] of [["l", this.pedalPhase], ["r", this.pedalPhase + Math.PI]] as const) {
        const dy = 1.07 - (0.44 + Math.sin(phase) * 0.17), dz = 0.23 + Math.cos(phase) * 0.17;
        const d = Math.min(0.845, Math.max(0.15, Math.hypot(dy, dz))), a = 0.42, b = 0.43;
        const hip = -Math.atan2(dz, dy) - Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
        const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - d * d) / (2 * a * b))));
        set(`${side}Hip`, hip); set(`${side}Knee`, knee); set(`${side}Ankle`, -hip - knee);
      }
      set("lShoulder", -0.85, this.cycleSteer * 0.15, -0.15); set("rShoulder", -0.85, this.cycleSteer * 0.15, 0.15);
      set("lElbow", -0.35); set("rElbow", -0.35);
    } else if (t === "sit") {
      p.hips.position.set(0, 0.47, 0); p.hips.rotation.set(0, 0, 0);
      set("spine", -0.12); set("neck", 0.05);
      set("lHip", -1.5); set("rHip", -1.5); set("lKnee", 1.5); set("rKnee", 1.5); set("lAnkle", 0); set("rAnkle", 0);
      set("lShoulder", -0.35, 0, 0.12); set("rShoulder", -0.35, 0, -0.12); set("lElbow", -0.9); set("rElbow", -0.9);
    } else {
      p.hips.position.set(0, 0.95, 0); p.hips.rotation.set(0, 0, 0);
      set("spine", 0); set("neck", 0.1);
      set("lHip", 0); set("rHip", 0); set("lKnee", 0.08); set("rKnee", 0.05); set("lAnkle", 0.5); set("rAnkle", 0.5);
      set("lShoulder", 0, 0, 0.25); set("rShoulder", 0, 0, -0.25); set("lElbow", -0.2); set("rElbow", -0.2);
    }
  }
  /** Shoes on outdoors; indoors (a Korean home) in socks — the same person in both. */
  shoes(on: boolean) {
    this.shoeM.color.set(on ? "#f2f2f0" : "#d9d6cf"); this.shoeM.roughness = on ? 0.5 : 0.95; this.soleM.visible = on;
  }
  dispose() { this.geos.forEach(g => g.dispose()); this.mats.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); }
}
