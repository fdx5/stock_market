import * as THREE from "three";

/** Rotations are authored in *character space* (degrees): x = pitch about the
 *  character's left axis (+ bends a spine forward, swings a hanging limb backward),
 *  y = yaw (+ turns toward the character's left), z = roll (+ raises the left arm
 *  sideways / lowers the right). The engine converts them into each bone's local
 *  frame, so a clip reads the same on every hero regardless of bone roll. */
export type Rot = [number, number, number];
export type Pose = Record<string, Rot>;
export interface RootMotion { x: number; y: number; z: number; yaw: number }
export interface Key { t: number; pose: Pose; root?: Partial<RootMotion>; ease?: Ease }
export type Ease = "linear" | "inOut" | "out" | "in" | "back" | "snap";
/** Retargeted motion capture (tools/blender/heroes/mocap.py): per frame, every bone's
 *  character-space joint rotation (deg, YXZ) and the hips' travel. */
export interface Mocap { fps: number; frames: number; bones: string[]; rot: number[][]; root: number[][] }

export interface Clip {
  name: string;
  duration: number;
  loop: boolean;
  keys: Key[];
  /** Captured motion played under the keys (the keys then add on top). */
  mocap?: Mocap;
  /** Seconds into the capture where this clip starts; speed multiplier. */
  mocapStart?: number;
  mocapSpeed?: number;
  /** Keep the hips over the spot (no travel), only bob/crouch. */
  inPlace?: boolean;
  /** Fraction of the captured motion applied (1 = full). */
  mocapWeight?: number;
  /** Marker events (spec §5.4): fired when playback crosses `t`. */
  events?: { t: number; name: string }[];
  /** A one-shot performance hands over to this clip when it ends. */
  next?: Clip;
  /** Procedural layer added on top of the keys (breathing, tremble, spin). */
  extra?: (t: number, pose: Pose, root: RootMotion) => void;
}

export const ease = (e: Ease | undefined, x: number) => {
  switch (e) {
    case "linear": return x;
    case "out": return 1 - (1 - x) ** 3;
    case "in": return x ** 3;
    case "back": { const c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; }
    case "snap": return 1 - (1 - x) ** 6;
    default: return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
  }
};

/** Swap left/right and mirror the rotation across the character's sagittal plane. */
export function mirror(p: Pose): Pose {
  const out: Pose = {};
  for (const [k, [x, y, z]] of Object.entries(p)) {
    const m = k.endsWith("_l") ? k.slice(0, -2) + "_r" : k.endsWith("_r") ? k.slice(0, -2) + "_l" : k;
    out[m] = [x, -y, -z];
  }
  return out;
}

export function merge(...poses: Pose[]): Pose {
  const out: Pose = {};
  for (const p of poses) for (const [k, v] of Object.entries(p)) {
    const o = out[k];
    out[k] = o ? [o[0] + v[0], o[1] + v[1], o[2] + v[2]] : [...v] as Rot;
  }
  return out;
}

const D = Math.PI / 180;
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export function rotToQuat(r: Rot, out = new THREE.Quaternion()) {
  _e.set(r[0] * D, r[1] * D, r[2] * D, "YXZ");
  return out.setFromEuler(_e);
}

/** Sample a clip at time t into `pose`/`root` (cleared first). */
export function sample(clip: Clip, t: number, pose: Pose, root: RootMotion) {
  for (const k in pose) delete pose[k];
  root.x = root.y = root.z = root.yaw = 0;
  const T = clip.loop ? ((t % clip.duration) + clip.duration) % clip.duration : Math.min(t, clip.duration);
  const keys = clip.keys;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= T) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  let f = b === a ? 0 : (T - a.t) / Math.max(1e-6, b.t - a.t);
  f = ease(b.ease, Math.min(1, Math.max(0, f)));
  const names = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
  for (const n of names) {
    const ra = a.pose[n] ?? [0, 0, 0], rb = b.pose[n] ?? [0, 0, 0];
    pose[n] = [ra[0] + (rb[0] - ra[0]) * f, ra[1] + (rb[1] - ra[1]) * f, ra[2] + (rb[2] - ra[2]) * f];
  }
  for (const k of ["x", "y", "z", "yaw"] as const) {
    const va = a.root?.[k] ?? 0, vb = b.root?.[k] ?? 0;
    root[k] = va + (vb - va) * f;
  }
  const mc = clip.mocap;
  if (mc) {
    const w = clip.mocapWeight ?? 1;
    const n = mc.frames;
    const segFrames = n - (clip.mocapStart ?? 0) * mc.fps - 1;
    let ft = T * mc.fps * (clip.mocapSpeed ?? 1);
    if (segFrames > 1) ft = clip.loop || ft > segFrames ? ft % segFrames : ft;
    const f = (clip.mocapStart ?? 0) * mc.fps + ft;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1), k = Math.min(1, Math.max(0, f - i0));
    const r0 = mc.rot[i0], r1 = mc.rot[i1];
    // Face the camera at the segment start: remove the hips' heading at that frame.
    const startRow = mc.rot[Math.max(0, Math.min(n - 1, Math.floor((clip.mocapStart ?? 0) * mc.fps)))];
    const pj = mc.bones.indexOf("pelvis");
    const heading = pj >= 0 ? startRow[pj * 3 + 1] : 0;
    mc.bones.forEach((b, j) => {
      const o = pose[b] ?? (pose[b] = [0, 0, 0]);
      for (let c = 0; c < 3; c++) o[c] += (r0[j * 3 + c] + (r1[j * 3 + c] - r0[j * 3 + c]) * k - (j === pj && c === 1 ? heading : 0)) * w;
    });
    const s0 = mc.root[Math.max(0, Math.min(n - 1, Math.floor((clip.mocapStart ?? 0) * mc.fps)))];
    const q0 = mc.root[i0], q1 = mc.root[i1];
    const lerp = (c: number) => q0[c] + (q1[c] - q0[c]) * k;
    root.y += lerp(1) * w;
    if (!clip.inPlace) { root.x += (lerp(0) - s0[0]) * w; root.z += (lerp(2) - s0[2]) * w; }
  }
  clip.extra?.(T, pose, root);
}

const mocapCache = new Map<string, Promise<Mocap | null>>();
/** Fetch a retargeted capture once per page. */
export function loadMocap(name: string) {
  let p = mocapCache.get(name);
  if (!p) {
    p = fetch(`/3d/pulse2/motion/${name}.json`).then(r => r.ok ? r.json() as Promise<Mocap> : null).catch(() => null);
    mocapCache.set(name, p);
  }
  return p;
}

/** Drives a glTF skeleton from character-space poses. */
export class PoseRig {
  bones = new Map<string, THREE.Bone>();
  private restLocal = new Map<string, THREE.Quaternion>();
  private restChar = new Map<string, THREE.Quaternion>();
  private restCharInv = new Map<string, THREE.Quaternion>();

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Quaternion();
    root.getWorldQuaternion(rootInv).invert();
    root.traverse(o => {
      if ((o as THREE.Bone).isBone) {
        const b = o as THREE.Bone;
        this.bones.set(b.name, b);
        this.restLocal.set(b.name, b.quaternion.clone());
        const wq = new THREE.Quaternion();
        b.getWorldQuaternion(wq);
        const cq = rootInv.clone().multiply(wq);
        this.restChar.set(b.name, cq);
        this.restCharInv.set(b.name, cq.clone().invert());
      }
    });
  }

  /** Post-multiply an extra character-space rotation onto a bone (finger curls). */
  rotateChar(name: string, axis: THREE.Vector3, angle: number) {
    const bone = this.bones.get(name);
    if (!bone) return;
    const c = this.restChar.get(name)!, ci = this.restCharInv.get(name)!;
    _q.setFromAxisAngle(axis, angle);
    bone.quaternion.multiply(ci.clone().multiply(_q).multiply(c));
  }

  /** local = restLocal · (C⁻¹ · R · C) with R the joint rotation in character axes. */
  apply(pose: Pose) {
    for (const [name, bone] of this.bones) {
      const rest = this.restLocal.get(name)!;
      const r = pose[name];
      if (!r || (r[0] === 0 && r[1] === 0 && r[2] === 0)) { bone.quaternion.copy(rest); continue; }
      rotToQuat(r, _q);
      const c = this.restChar.get(name)!, ci = this.restCharInv.get(name)!;
      bone.quaternion.copy(rest).multiply(ci).multiply(_q).multiply(c);
    }
  }
}

/** Weighted blend of several sampled poses (crossfades). */
export function blend(out: Pose, layers: { pose: Pose; w: number }[]) {
  for (const k in out) delete out[k];
  const total = layers.reduce((s, l) => s + l.w, 0) || 1;
  for (const { pose, w } of layers) {
    const f = w / total;
    for (const [k, v] of Object.entries(pose)) {
      const o = out[k] ?? (out[k] = [0, 0, 0]);
      o[0] += v[0] * f; o[1] += v[1] * f; o[2] += v[2] * f;
    }
  }
  return out;
}
