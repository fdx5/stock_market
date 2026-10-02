import * as THREE from "three";

/** What makes driving felt (driveSim drives, driveFx burns): tyres squealing under hard braking
 * and cornering, a crunch of metal and glass with sparks on a knock, a scream when a person is
 * struck, warning tones for low fuel and low health, the boost's rush; fuel cans and repair
 * kits to pick up along the way; directions spoken (Korean voice, where the browser has one). */

// ---- sounds (made here, nothing to fetch) ----

function noiseBuffer(ctx: AudioContext, secs: number) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * secs), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
const noiseOf = new WeakMap<AudioContext, AudioBuffer>();
const noise = (ctx: AudioContext) => { let b = noiseOf.get(ctx); if (!b) { b = noiseBuffer(ctx, 2); noiseOf.set(ctx, b); } return b; };

/** A tyre squeal held as long as the slip lasts: `set(0..1)` each frame. */
export function screech(ctx: AudioContext, out: AudioNode) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 7;
  const bp2 = ctx.createBiquadFilter(); bp2.type = "bandpass"; bp2.frequency.value = 3100; bp2.Q.value = 9;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(bp); src.connect(bp2); bp.connect(g); bp2.connect(g); g.connect(out); src.start();
  let level = 0;
  return {
    set(v: number) {
      const want = Math.max(0, Math.min(1, v));
      level += (want - level) * 0.25;
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(level * 0.22, t, 0.03);
      // (the pitch wanders a little, as a real squeal does)
      bp.frequency.setTargetAtTime(1750 + level * 500 + Math.random() * 120, t, 0.05);
    },
    dispose() { try { src.stop(); } catch { /* stopped */ } g.disconnect(); },
  };
}

export const feelSfx = {
  /** Metal crunching, glass breaking (harder knocks more of both). */
  crash(ctx: AudioContext, hard: number, out: AudioNode) {
    const t = ctx.currentTime, k = Math.min(1, hard / 10);
    const thump = ctx.createOscillator(), tg = ctx.createGain();
    thump.type = "sine"; thump.frequency.setValueAtTime(120, t); thump.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    tg.gain.setValueAtTime(0.5 * (0.4 + k), t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    thump.connect(tg); tg.connect(out); thump.start(t); thump.stop(t + 0.4);
    // the crunch: noise through a resonant low-mid band, ringing like sheet metal
    const n = ctx.createBufferSource(); n.buffer = noise(ctx);
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 650; f.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.45 * (0.3 + k), t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3 + k * 0.4);
    n.connect(f); f.connect(ng); ng.connect(out); n.start(t, Math.random()); n.stop(t + 0.8);
    for (const fr of [430, 710, 1180]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(fr * (0.9 + Math.random() * 0.2), t);
      og.gain.setValueAtTime(0.05 * k, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.55);
    }
    // glass: bright tinkles scattered over half a second, on the harder knocks
    if (k > 0.35) for (let i = 0; i < 10 + k * 14; i++) {
      const at = t + 0.03 + Math.random() * 0.5, o = ctx.createOscillator(), og = ctx.createGain();
      o.type = "sine"; o.frequency.value = 3000 + Math.random() * 5000;
      og.gain.setValueAtTime(0.04 * k, at); og.gain.exponentialRampToValueAtTime(0.0005, at + 0.08 + Math.random() * 0.1);
      o.connect(og); og.connect(out); o.start(at); o.stop(at + 0.2);
    }
  },
  /** A person screaming: a voiced tone through vowel formants, rising then falling, shaking. */
  scream(ctx: AudioContext, out: AudioNode) {
    const t = ctx.currentTime, dur = 0.9 + Math.random() * 0.4, f0 = 520 + Math.random() * 260;
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(f0 * 0.8, t); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.12); o.frequency.linearRampToValueAtTime(f0 * 0.85, t + dur);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 7 + Math.random() * 3; vg.gain.value = f0 * 0.05;
    vib.connect(vg); vg.connect(o.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.05); g.gain.setValueAtTime(0.32, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    // "아—": formants of an open vowel, and breath
    for (const [fr, q, lv] of [[900, 6, 1], [1400, 8, 0.6], [2900, 10, 0.35]] as const) {
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = fr * (f0 / 600) ** 0.3; f.Q.value = q;
      const fg = ctx.createGain(); fg.gain.value = lv;
      o.connect(f); f.connect(fg); fg.connect(g);
    }
    const br = ctx.createBufferSource(); br.buffer = noise(ctx);
    const bf = ctx.createBiquadFilter(); bf.type = "highpass"; bf.frequency.value = 2500;
    const bg = ctx.createGain(); bg.gain.value = 0.08;
    br.connect(bf); bf.connect(bg); bg.connect(g);
    g.connect(out);
    o.start(t); vib.start(t); br.start(t, Math.random()); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05); br.stop(t + dur + 0.05);
  },
  /** A warning tone: "fuel" two short beeps, "hp" a low double pulse. */
  alarm(ctx: AudioContext, kind: "fuel" | "hp", out: AudioNode) {
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = t + i * (kind === "fuel" ? 0.18 : 0.26);
      o.type = kind === "fuel" ? "square" : "sine"; o.frequency.value = kind === "fuel" ? 1180 : 220;
      g.gain.setValueAtTime(kind === "fuel" ? 0.08 : 0.3, at); g.gain.exponentialRampToValueAtTime(0.001, at + (kind === "fuel" ? 0.12 : 0.22));
      o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.25);
    }
  },
  /** The boost cutting in: a rising rush. */
  boost(ctx: AudioContext, out: AudioNode) {
    const t = ctx.currentTime, n = ctx.createBufferSource(); n.buffer = noise(ctx);
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    n.connect(f); f.connect(g); g.connect(out); n.start(t, Math.random()); n.stop(t + 1);
  },
  /** A repair kit picked up: a ratchet's clicks, then a bright rising pair. */
  repair(ctx: AudioContext, out: AudioNode) {
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const n = ctx.createBufferSource(); n.buffer = noise(ctx);
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 3400; f.Q.value = 6;
      const g = ctx.createGain(), at = t + i * 0.055;
      g.gain.setValueAtTime(0.35, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
      n.connect(f); f.connect(g); g.connect(out); n.start(at, Math.random()); n.stop(at + 0.04);
    }
    [784, 1175].forEach((fr, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = t + 0.24 + i * 0.09;
      o.type = "triangle"; o.frequency.value = fr;
      g.gain.setValueAtTime(0.15, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
      o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.4);
    });
  },
  /** A fuel can picked up. */
  pickup(ctx: AudioContext, out: AudioNode) {
    const t = ctx.currentTime;
    [660, 880, 1320].forEach((fr, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = t + i * 0.07;
      o.type = "triangle"; o.frequency.value = fr;
      g.gain.setValueAtTime(0.16, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
      o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.3);
    });
  },
};

// ---- sparks: bright streaks thrown from a knock, falling and dying ----

export function sparks() {
  const N = 160;
  const geo = new THREE.PlaneGeometry(0.06, 0.28);
  const mat = new THREE.MeshBasicMaterial({ color: "#ffcf6a", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 7; mesh.name = "sparks";
  const ps = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, age: 1 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  let next = 0;
  return {
    mesh,
    /** A burst at `at` (world), thrown mostly along `away` (world, horizontal), `n` sparks. */
    burst(at: THREE.Vector3, away: THREE.Vector3, n: number) {
      for (let i = 0; i < n; i++) {
        const sp = ps[next]; next = (next + 1) % N;
        sp.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.4, (Math.random() - 0.5) * 0.4));
        sp.v.set(away.x * (2 + Math.random() * 5) + (Math.random() - 0.5) * 5, 1.5 + Math.random() * 4, away.z * (2 + Math.random() * 5) + (Math.random() - 0.5) * 5);
        sp.age = 0; sp.life = 0.25 + Math.random() * 0.45;
      }
    },
    update(dt: number, camera: THREE.Camera) {
      let k = 0;
      for (const sp of ps) {
        if (sp.age >= sp.life) continue;
        sp.age += dt; sp.v.y -= 9.8 * dt; sp.p.addScaledVector(sp.v, dt);
        if (sp.age >= sp.life) continue;
        // a streak along its motion, facing the camera
        dir.copy(sp.v).normalize();
        q.setFromUnitVectors(up, dir);
        const fade = 1 - sp.age / sp.life;
        s.set(fade, 0.4 + Math.min(2, sp.v.length() / 6), 1);
        m.compose(sp.p, q, s);
        mesh.setMatrixAt(k++, m);
      }
      mesh.count = k;
      if (k) mesh.instanceMatrix.needsUpdate = true;
      void camera;
    },
    dispose() { geo.dispose(); mat.dispose(); mesh.removeFromParent(); },
  };
}

// ---- pickups along the way: fuel cans and repair kits ----

export type PickupKind = "fuel" | "repair";

/** Where the pickups go on a way of `len` m: every ~130 m from 90 m in (none in the last
 * 50 m), fuel cans and repair kits by turns — a repair kit first when the vehicle is hurt. */
export function pickupPlan(len: number, hp: number): { at: number; kind: PickupKind }[] {
  const out: { at: number; kind: PickupKind }[] = [];
  let repair = hp < 60;
  for (let at = 90; at < len - 50; at += 130) { out.push({ at, kind: repair ? "repair" : "fuel" }); repair = !repair; }
  return out;
}

/** Red jerry cans (fuel) and white kits with a green cross (repair), each with a glow ring,
 * spinning and bobbing over the road; driven through, taken. */
export function fuelCans() {
  const group = new THREE.Group(); group.name = "pickups";
  const body = new THREE.BoxGeometry(0.42, 0.55, 0.2);
  const handle = new THREE.TorusGeometry(0.09, 0.025, 6, 12).translate(0, 0.3, 0);
  const canMat = new THREE.MeshStandardMaterial({ color: "#d4241c", roughness: 0.35, metalness: 0.3, emissive: "#5a0804", emissiveIntensity: 0.6 });
  const kit = new THREE.BoxGeometry(0.56, 0.4, 0.3);
  const kitHandle = new THREE.TorusGeometry(0.08, 0.022, 6, 12, Math.PI).translate(0, 0.2, 0);
  const crossA = new THREE.BoxGeometry(0.26, 0.08, 0.32), crossB = new THREE.BoxGeometry(0.08, 0.26, 0.32);
  const kitMat = new THREE.MeshStandardMaterial({ color: "#f2f4f2", roughness: 0.4, metalness: 0.1, emissive: "#2a3a30", emissiveIntensity: 0.5 });
  const crossMat = new THREE.MeshStandardMaterial({ color: "#19c25a", roughness: 0.4, emissive: "#0c7a34", emissiveIntensity: 0.9 });
  const ringGeo = new THREE.RingGeometry(0.75, 0.95, 40).rotateX(-Math.PI / 2);
  const ring = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const ringMat = { fuel: ring("#ffd14a"), repair: ring("#3dff8a") };
  const items: { g: THREE.Group; kind: PickupKind; x: number; y: number; z: number; taken: boolean; t: number }[] = [];
  return {
    group,
    /** Pickups at these points (footprint frame x, y; ground height z). */
    place(pts: { x: number; y: number; z: number; kind?: PickupKind }[]) {
      this.clear();
      for (const p of pts) {
        const kind = p.kind ?? "fuel", g = new THREE.Group(), obj = new THREE.Group();
        if (kind === "fuel") obj.add(new THREE.Mesh(body, canMat), new THREE.Mesh(handle, canMat));
        else obj.add(new THREE.Mesh(kit, kitMat), new THREE.Mesh(kitHandle, kitMat), new THREE.Mesh(crossA, crossMat), new THREE.Mesh(crossB, crossMat));
        obj.position.y = 0.9;
        const r = new THREE.Mesh(ringGeo, ringMat[kind]); r.position.y = 0.06;
        g.add(obj, r);
        g.position.set(p.x, p.z, -p.y);
        group.add(g);
        items.push({ g, kind, x: p.x, y: p.y, z: p.z, taken: false, t: Math.random() * 6 });
      }
    },
    /** Spin and bob; any within `r` of (x, y) taken: how many of each. */
    update(dt: number, x: number, y: number, r: number) {
      const got = { fuel: 0, repair: 0 };
      for (const it of items) {
        if (it.taken) continue;
        it.t += dt;
        const obj = it.g.children[0];
        obj.rotation.y = it.t * 2.2; obj.position.y = 0.9 + Math.sin(it.t * 3) * 0.12;
        if (Math.hypot(it.x - x, it.y - y) < r) { it.taken = true; it.g.visible = false; got[it.kind]++; }
      }
      return got;
    },
    clear() { for (const it of items) it.g.removeFromParent(); items.length = 0; },
    dispose() {
      this.clear();
      for (const d of [body, handle, canMat, kit, kitHandle, crossA, crossB, kitMat, crossMat, ringGeo, ringMat.fuel, ringMat.repair]) d.dispose();
      group.removeFromParent();
    },
  };
}

// ---- directions spoken ----

/** Korean voice directions (the browser's speech synthesis), at most one phrase in flight. */
export function navVoice() {
  const ok = typeof window !== "undefined" && "speechSynthesis" in window;
  let voice: SpeechSynthesisVoice | null = null, last = "", lastAt = 0, on = true;
  const pick = () => { if (!ok) return; voice = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith("ko")) ?? null; };
  pick();
  if (ok) speechSynthesis.addEventListener?.("voiceschanged", pick);
  return {
    get available() { return ok; },
    get on() { return on; },
    set on(v: boolean) { on = v; if (!v && ok) speechSynthesis.cancel(); },
    say(text: string, urgent = false) {
      if (!ok || !on) return;
      const now = performance.now();
      if (text === last && now - lastAt < 6000) return;
      last = text; lastAt = now;
      if (urgent) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR"; if (voice) u.voice = voice; u.rate = 1.08; u.volume = 0.9;
      speechSynthesis.speak(u);
    },
    dispose() { if (ok) { speechSynthesis.cancel(); speechSynthesis.removeEventListener?.("voiceschanged", pick); } },
  };
}
