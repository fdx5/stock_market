import * as THREE from "three";

/** Damage you can see and hear on the driven vehicle: smoke from under the bonnet as it weakens,
 * flames when it is nearly gone, and at nothing left an explosion — a flash, a fireball, smoke
 * rolling up, debris thrown out and bouncing, a shock ring on the ground — then the wreck burning.
 * Particles are camera-facing quads in instanced meshes (one draw each for fire, smoke, debris). */

const FIRE_N = 220, SMOKE_N = 260, DEBRIS_N = 48;

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; grow: number; spin: number; shade: number; alive: boolean }

function softDot(inner: string, outer: string) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.45, outer); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // a little texture in it (billows)
  for (let i = 0; i < 40; i++) {
    const x = 30 + Math.random() * 68, y = 30 + Math.random() * 68, r = 6 + Math.random() * 16;
    const b = g.createRadialGradient(x, y, 0, x, y, r);
    b.addColorStop(0, "rgba(255,255,255,.10)"); b.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = b; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function vehicleFx() {
  const group = new THREE.Group();
  group.name = "vehicle fx";
  const quad = new THREE.PlaneGeometry(1, 1);
  const fireTex = softDot("rgba(255,255,255,1)", "rgba(255,255,255,.55)"), smokeTex = softDot("rgba(255,255,255,.9)", "rgba(255,255,255,.4)");
  const fireMat = new THREE.MeshBasicMaterial({ map: fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const smokeMat = new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.62 });
  const debrisMat = new THREE.MeshStandardMaterial({ color: "#2a2a2c", roughness: 0.8, metalness: 0.4 });
  const fire = new THREE.InstancedMesh(quad, fireMat, FIRE_N), smoke = new THREE.InstancedMesh(quad, smokeMat, SMOKE_N);
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), debrisMat, DEBRIS_N);
  for (const m of [fire, smoke, debris]) { m.frustumCulled = false; m.count = 0; group.add(m); }
  fire.renderOrder = 6; smoke.renderOrder = 5;
  fire.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_N * 3), 3);
  smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_N * 3), 3);
  debris.castShadow = true;
  const ringG = new THREE.RingGeometry(0.8, 1, 72).rotateX(-Math.PI / 2);
  const ringM = new THREE.MeshBasicMaterial({ color: "#ffd9a0", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const ring = new THREE.Mesh(ringG, ringM); ring.visible = false; group.add(ring);
  const flash = new THREE.PointLight("#ffb060", 0, 90, 1.6); group.add(flash);
  const glow = new THREE.PointLight("#ff7a2a", 0, 22, 1.8); group.add(glow);
  const mk = (n: number): P[] => Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, grow: 0, spin: 0, shade: 1, alive: false }));
  const fires = mk(FIRE_N), smokes = mk(SMOKE_N), bits = mk(DEBRIS_N);
  let fi = 0, si = 0, ringT = -1, flashT = -1, burnT = -1;
  const spawn = (arr: P[], i: number, p: Partial<P>) => { Object.assign(arr[i], { age: 0, alive: true, spin: Math.random() * 6.28, shade: 1 }, p); };
  const emitFire = (x: number, y: number, z: number, sp: number, size: number, life: number) => {
    spawn(fires, fi, { x, y, z, vx: (Math.random() - 0.5) * sp, vy: Math.random() * sp * 0.8 + 0.6, vz: (Math.random() - 0.5) * sp, size, grow: size * 0.9, life });
    fi = (fi + 1) % FIRE_N;
  };
  const emitSmoke = (x: number, y: number, z: number, sp: number, size: number, life: number, shade: number) => {
    spawn(smokes, si, { x, y, z, vx: (Math.random() - 0.5) * sp, vy: 0.9 + Math.random() * 1.2, vz: (Math.random() - 0.5) * sp, size, grow: size * 1.5, life, shade });
    si = (si + 1) % SMOKE_N;
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), zq = new THREE.Quaternion(), qq = new THREE.Quaternion(), eu = new THREE.Euler();
  return {
    group,
    /** The vehicle's engine bay (world) and its state: hp 0–100 (smoke under 45, fire under 20). */
    update(dt: number, camera: THREE.Camera, at: THREE.Vector3 | null, hp: number, wind: [number, number] = [0.4, 0.15]) {
      if (at) {
        // a steady trickle by the damage
        const smokeRate = hp < 45 ? (45 - hp) / 45 * 26 + 4 : 0, fireRate = hp < 20 ? (20 - hp) / 20 * 40 + 8 : 0;
        for (let k = 0; k < Math.round(smokeRate * dt + Math.random() * 0.8 - 0.4); k++)
          emitSmoke(at.x + (Math.random() - 0.5) * 0.8, at.y, at.z + (Math.random() - 0.5) * 0.8, 0.5, 0.5, 2.6, hp < 20 ? 0.18 : 0.55);
        for (let k = 0; k < Math.round(fireRate * dt + Math.random() * 0.8 - 0.4); k++) emitFire(at.x + (Math.random() - 0.5) * 1.1, at.y - 0.1, at.z + (Math.random() - 0.5) * 1.1, 0.8, 0.7 + Math.random() * 0.6, 0.6 + Math.random() * 0.4);
      }
      // the wreck burning on
      if (burnT >= 0) {
        burnT += dt;
        const b = Math.max(0, 1 - burnT / 40);
        if (at && b > 0) {
          for (let k = 0; k < Math.round(50 * b * dt + Math.random() - 0.3); k++) emitFire(at.x + (Math.random() - 0.5) * 2.2, at.y - 0.4, at.z + (Math.random() - 0.5) * 3, 1, 0.9 + Math.random(), 0.7 + Math.random() * 0.5);
          for (let k = 0; k < Math.round(22 * b * dt + Math.random() - 0.3); k++) emitSmoke(at.x + (Math.random() - 0.5) * 2, at.y + 0.8, at.z + (Math.random() - 0.5) * 2, 0.8, 1.2, 5, 0.12);
        }
        glow.intensity = b * (60 + Math.random() * 40);
      } else glow.intensity = hp < 20 && at ? 18 + Math.random() * 14 : 0;
      if (at) glow.position.set(at.x, at.y + 0.8, at.z);
      if (flashT >= 0) { flashT += dt; flash.intensity = Math.max(0, 2600 * Math.exp(-flashT * 7)); if (flashT > 1.2) { flashT = -1; flash.intensity = 0; } }
      if (ringT >= 0) {
        ringT += dt; const k = ringT / 0.9;
        ring.visible = k < 1; ring.scale.setScalar(1 + k * 26); ringM.opacity = 0.9 * (1 - k) ** 2;
        if (k >= 1) ringT = -1;
      }
      // move and draw: quads turned to face the camera
      camera.getWorldQuaternion(q);
      let n = 0;
      for (const p of fires) {
        if (!p.alive) continue;
        p.age += dt; if (p.age > p.life) { p.alive = false; continue; }
        const k = p.age / p.life;
        p.vy += 1.8 * dt; p.vx *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5;
        p.x += (p.vx + wind[0]) * dt; p.y += p.vy * dt; p.z += (p.vz + wind[1]) * dt;
        const size = p.size + p.grow * k;
        // white-yellow → orange → deep red → nothing (additive: black is gone)
        const heat = 1 - k;
        c.setRGB(Math.min(1, 1.4 * heat + 0.15), Math.max(0, 1.25 * heat * heat), Math.max(0, heat ** 4 * 0.7));
        zq.setFromAxisAngle(v.set(0, 0, 1), p.spin + k);
        m4.compose(v.set(p.x, p.y, p.z), qq.copy(q).multiply(zq), s.set(size, size, size));
        fire.setMatrixAt(n, m4); fire.setColorAt(n, c); n++;
      }
      fire.count = n; fire.instanceMatrix.needsUpdate = true; if (fire.instanceColor) fire.instanceColor.needsUpdate = true;
      n = 0;
      for (const p of smokes) {
        if (!p.alive) continue;
        p.age += dt; if (p.age > p.life) { p.alive = false; continue; }
        const k = p.age / p.life;
        p.vy *= 1 - dt * 0.35; p.vx *= 1 - dt * 0.8; p.vz *= 1 - dt * 0.8;
        p.x += (p.vx + wind[0] * 2) * dt; p.y += p.vy * dt; p.z += (p.vz + wind[1] * 2) * dt;
        // grows as it rises; thins away at the end (shrinks and lightens)
        const end = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1, size = (p.size + p.grow * Math.sqrt(k) * 2.2) * (0.35 + 0.65 * end);
        const g = p.shade + (0.75 - p.shade) * k;
        c.setRGB(g, g, g * 1.02);
        zq.setFromAxisAngle(v.set(0, 0, 1), p.spin + k * 0.8);
        m4.compose(v.set(p.x, p.y, p.z), qq.copy(q).multiply(zq), s.set(size, size, size));
        smoke.setMatrixAt(n, m4); smoke.setColorAt(n, c); n++;
      }
      smoke.count = n; smoke.instanceMatrix.needsUpdate = true; if (smoke.instanceColor) smoke.instanceColor.needsUpdate = true;
      n = 0;
      for (const p of bits) {
        if (!p.alive) continue;
        p.age += dt; if (p.age > p.life) { p.alive = false; continue; }
        p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        // bounce off the ground (the shade holds its ground height)
        if (p.y < p.shade) { p.y = p.shade; p.vy = -p.vy * 0.35; p.vx *= 0.6; p.vz *= 0.6; p.spin *= 0.5; }
        zq.setFromEuler(eu.set(p.age * p.spin, p.age * p.spin * 0.7, 0));
        m4.compose(v.set(p.x, p.y, p.z), zq, s.set(p.size, p.size * 0.35, p.size * 0.8));
        debris.setMatrixAt(n++, m4);
      }
      debris.count = n; debris.instanceMatrix.needsUpdate = true;
    },
    /** The explosion, at the vehicle's middle (world), the ground's height there. */
    explode(at: THREE.Vector3, ground: number) {
      flashT = 0; flash.position.set(at.x, at.y + 2, at.z); ringT = 0; ring.position.set(at.x, ground + 0.2, at.z); burnT = 0;
      for (let k = 0; k < 120; k++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = 6 + Math.random() * 14;
        spawn(fires, fi, { x: at.x, y: at.y + 0.5, z: at.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp * 0.8 + 2, vz: Math.sin(a) * Math.cos(e) * sp,
          size: 1.6 + Math.random() * 2.4, grow: 3 + Math.random() * 3, life: 0.7 + Math.random() * 0.9 });
        fi = (fi + 1) % FIRE_N;
      }
      for (let k = 0; k < 90; k++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
        spawn(smokes, si, { x: at.x, y: at.y + 1, z: at.z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 5, vz: Math.sin(a) * sp, size: 2 + Math.random() * 2, grow: 4, life: 3.5 + Math.random() * 3, shade: 0.1 + Math.random() * 0.12 });
        si = (si + 1) % SMOKE_N;
      }
      for (let k = 0; k < DEBRIS_N; k++) {
        const a = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 13;
        spawn(bits, k, { x: at.x, y: at.y + 0.6, z: at.z, vx: Math.cos(a) * sp, vy: 5 + Math.random() * 11, vz: Math.sin(a) * sp, size: 0.12 + Math.random() * 0.5, spin: 4 + Math.random() * 10, life: 7 + Math.random() * 5, shade: ground + 0.05 });
      }
    },
    /** back to nothing (a repaired vehicle) */
    clear() { for (const a of [fires, smokes, bits]) for (const p of a) p.alive = false; burnT = -1; glow.intensity = 0; },
    dispose() {
      quad.dispose(); debris.geometry.dispose(); ringG.dispose();
      [fireMat, smokeMat, debrisMat, ringM].forEach(m => m.dispose()); fireTex.dispose(); smokeTex.dispose();
      [fire, smoke, debris].forEach(m => m.dispose());
      group.removeFromParent();
    },
  };
}

/** Sounds of damage, made on the spot: a person struck (a dull thud), the warning chime under
 * 20 hp, the explosion (a deep boom with a falling body, a crack, debris rattling down) and a fire's crackle. */
export const damageSfx = {
  thud(ctx: AudioContext, out: AudioNode) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3);
  },
  warn(ctx: AudioContext, out: AudioNode) {
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = 988;
      g.gain.setValueAtTime(0.06, t + i * 0.18); g.gain.setValueAtTime(0, t + i * 0.18 + 0.1);
      o.connect(g); g.connect(out); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.12);
    }
  },
  explosion(ctx: AudioContext, out: AudioNode) {
    const t = ctx.currentTime, sr = ctx.sampleRate;
    const noise = (secs: number, decay: number) => {
      const b = ctx.createBuffer(2, Math.floor(sr * secs), sr);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * decay)); }
      return b;
    };
    const master = ctx.createGain(); master.gain.value = 1.1;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6;
    master.connect(comp); comp.connect(out);
    // the boom: low noise, long tail
    const boom = ctx.createBufferSource(); boom.buffer = noise(4, 0.9);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 2.5);
    const bg = ctx.createGain(); bg.gain.setValueAtTime(1.6, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 4);
    boom.connect(lp); lp.connect(bg); bg.connect(master); boom.start(t);
    // the body: a falling sine
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "sine";
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    og.gain.setValueAtTime(1.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 1.7);
    // the crack at the front
    const crack = ctx.createBufferSource(); crack.buffer = noise(0.25, 0.03);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1400;
    const cg = ctx.createGain(); cg.gain.value = 0.9; crack.connect(hp); hp.connect(cg); cg.connect(master); crack.start(t);
    // debris coming down: small clanks over two seconds
    for (let i = 0; i < 16; i++) {
      const at = t + 0.5 + Math.random() * 2.2, c = ctx.createBufferSource(); c.buffer = noise(0.08, 0.012);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800 + Math.random() * 3000; bp.Q.value = 8;
      const g = ctx.createGain(); g.gain.value = 0.25 + Math.random() * 0.3; c.connect(bp); bp.connect(g); g.connect(master); c.start(at);
    }
  },
  /** a fire's crackle, as long as it burns: returns a stop */
  fire(ctx: AudioContext, out: AudioNode) {
    const sr = ctx.sampleRate, b = ctx.createBuffer(1, sr * 3, sr), d = b.getChannelData(0);
    // a rumble with pops in it
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.06; d[i] = last + (Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : 0); }
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(0.55, ctx.currentTime + 0.4, 0.5);
    src.connect(g); g.connect(out); src.start();
    return (secs = 1.5) => { g.gain.setTargetAtTime(0, ctx.currentTime, secs / 3); setTimeout(() => { try { src.stop(); } catch { /* */ } }, secs * 1000 + 200); };
  },
};
