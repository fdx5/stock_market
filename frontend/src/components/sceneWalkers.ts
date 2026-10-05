import { frameSlice } from "./frameSlice";
import {flushInstanceAttribute} from './instanceDirty';
import { walkerJoint } from "./walkerJoint";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Terrain } from "./sceneTerrain";
import { KERB_H, runPt, type Run } from "./sceneSidewalk";
import { rng, type Ring } from "./complexScene";

/* People walking the sidewalks: twenty kinds (office workers, students in uniform,
 * children, older people, a runner, hikers, a courier with a parcel …), each built from
 * smooth lathed and tapered parts with jointed hips, knees, shoulders and elbows, and a
 * walk cycle posed on the CPU. Every part is one instanced mesh shared by all people,
 * so the crowd is a couple of dozen draws whichever renderer draws it.
 * Body frame: y up, facing +z, feet at 0, an adult 1.70 m. */

type Top = "shirt" | "tee" | "jacket" | "coat" | "puffer" | "hoodie" | "blouse" | "dress" | "vest";
type Bottom = "pants" | "shorts" | "skirt" | "none";
type Hair = "short" | "long" | "bob" | "pony" | "cap" | "sunhat" | "helmet" | "perm" | "buzz";
type Acc = "none" | "backpack" | "schoolbag" | "briefcase" | "handbag" | "shopping" | "parcel" | "crossbody" | "tote";
type Gait = "walk" | "slow" | "run" | "carry" | "stroll";

interface Kind {
  name: string; h: number; build: number; top: Top; bottom: Bottom; hair: Hair; acc: Acc; gait: Gait;
  longSleeve: boolean; tops: string[]; bottoms: string[]; shoes: string[]; hairs: string[]; accs: string[];
  /** Legs under a skirt or dress: skin, or tights. */
  legs?: string; detail?: "tie" | "ribbon" | "hivis" | "collar"; weight: number;
}

const SKIN = ["#e9c4a4", "#e2b793", "#d8a881", "#f0cfb2", "#c99672"];
const DARK_HAIR = ["#1d1714", "#2a1f19", "#3a2a1f", "#15110f", "#4a3525"];
const GREY_HAIR = ["#b9b6b0", "#9d9993", "#d4d1cb"];

const KINDS: Kind[] = [
  { name: "정장 직장인", h: 1.76, build: 1.05, top: "jacket", bottom: "pants", hair: "short", acc: "briefcase", gait: "walk", longSleeve: true,
    tops: ["#1f2a3d", "#2b2e33", "#3a3f47", "#1c1f24"], bottoms: [], shoes: ["#141414", "#3b2618"], hairs: DARK_HAIR, accs: ["#1a1a1a", "#4a2e1c"], detail: "tie", weight: 8 },
  { name: "오피스룩 여성", h: 1.63, build: 0.92, top: "blouse", bottom: "skirt", hair: "bob", acc: "handbag", gait: "walk", longSleeve: true, legs: "#2b2522",
    tops: ["#f3efe8", "#dfe6ee", "#efdcd4", "#e9e4d0"], bottoms: ["#23262c", "#3b3f48", "#5a4a3e"], shoes: ["#1a1716", "#6b4a35"], hairs: DARK_HAIR, accs: ["#6b3f2a", "#1c1c1c", "#b99a78"], weight: 7 },
  { name: "후드티 대학생", h: 1.75, build: 1.0, top: "hoodie", bottom: "pants", hair: "short", acc: "backpack", gait: "walk", longSleeve: true,
    tops: ["#8b9098", "#2f3542", "#5e6b52", "#b44a3e", "#e8e4dc"], bottoms: ["#2e3f5c", "#394a66", "#20242b"], shoes: ["#eeeeec", "#232323"], hairs: DARK_HAIR, accs: ["#1d2229", "#3f4f3a", "#6e2f2f"], weight: 7 },
  { name: "캐주얼 여대생", h: 1.62, build: 0.9, top: "shirt", bottom: "pants", hair: "long", acc: "tote", gait: "walk", longSleeve: true,
    tops: ["#d8c9b0", "#b9c7d6", "#f1ece2", "#c9a7a0"], bottoms: ["#3f5373", "#2a3446", "#dcd4c4"], shoes: ["#f2f2f0", "#8a6a50"], hairs: DARK_HAIR, accs: ["#e6dccb", "#2c2c2c"], weight: 7 },
  { name: "초등학생", h: 1.3, build: 0.82, top: "tee", bottom: "shorts", hair: "short", acc: "schoolbag", gait: "walk", longSleeve: false,
    tops: ["#f2c230", "#3f8fd6", "#e5533c", "#57b36a"], bottoms: ["#2b3d63", "#4b4b4b"], shoes: ["#f5f5f5", "#d33"], hairs: DARK_HAIR, accs: ["#e34b4b", "#2f6fd1", "#f2a33a"], weight: 4 },
  { name: "교복 남학생", h: 1.72, build: 0.95, top: "jacket", bottom: "pants", hair: "short", acc: "backpack", gait: "walk", longSleeve: true,
    tops: ["#1e2b44", "#2d2f35"], bottoms: ["#4a4d52", "#2b2e33"], shoes: ["#151515"], hairs: DARK_HAIR, accs: ["#1c1c1c", "#2c3d58"], detail: "collar", weight: 4 },
  { name: "교복 여학생", h: 1.6, build: 0.88, top: "jacket", bottom: "skirt", hair: "pony", acc: "backpack", gait: "walk", longSleeve: true, legs: "#1d1b1b",
    tops: ["#1e2b44", "#3b2233"], bottoms: ["#2d3a55", "#4a3a3a"], shoes: ["#151515"], hairs: DARK_HAIR, accs: ["#f0e6d8", "#1c1c1c"], detail: "ribbon", weight: 4 },
  { name: "어르신(남)", h: 1.66, build: 1.0, top: "jacket", bottom: "pants", hair: "cap", acc: "none", gait: "slow", longSleeve: true,
    tops: ["#6b6b62", "#4f5a4a", "#7a6a55"], bottoms: ["#b9ae98", "#5a5a58"], shoes: ["#2a2622"], hairs: ["#5a5448", "#2c3140", "#8a8272"], accs: [], weight: 4 },
  { name: "어르신(여)", h: 1.55, build: 1.02, top: "blouse", bottom: "pants", hair: "perm", acc: "shopping", gait: "slow", longSleeve: true,
    tops: ["#8a5a8c", "#b86a6a", "#6a7fa0", "#c8a24a"], bottoms: ["#2c2c30", "#4a4540"], shoes: ["#2a2624"], hairs: GREY_HAIR, accs: ["#e9e6df", "#6f8a4a"], weight: 4 },
  { name: "러너", h: 1.74, build: 0.95, top: "tee", bottom: "shorts", hair: "cap", acc: "none", gait: "run", longSleeve: false,
    tops: ["#e84b3c", "#2fb5d6", "#1c1c1c", "#f2f2f2"], bottoms: ["#1c1c1c", "#2b3544"], shoes: ["#f2f2f2", "#ff6a2a"], hairs: ["#1c1c1c", "#f2f2f2", "#2a4f8a"], accs: [], weight: 2 },
  { name: "등산복 중년", h: 1.68, build: 1.08, top: "jacket", bottom: "pants", hair: "cap", acc: "backpack", gait: "walk", longSleeve: true,
    tops: ["#d8342c", "#e9751c", "#2c7fb8", "#3d8c4a"], bottoms: ["#1c1c1e", "#3b3b3f"], shoes: ["#4a3a2a", "#2c2c2c"], hairs: ["#3a3a3a", "#8a2020", "#e8e0d0"], accs: ["#2b2b2b", "#5a6b3a"], weight: 3 },
  { name: "롱코트 여성", h: 1.66, build: 0.9, top: "coat", bottom: "pants", hair: "long", acc: "handbag", gait: "walk", longSleeve: true,
    tops: ["#b38b62", "#2b2b2d", "#9a9a94", "#6e4a3a"], bottoms: ["#1f1f22", "#3a3d44"], shoes: ["#1a1716"], hairs: DARK_HAIR, accs: ["#1c1c1c", "#7a3f2c"], weight: 5 },
  { name: "롱패딩", h: 1.72, build: 1.05, top: "puffer", bottom: "pants", hair: "short", acc: "none", gait: "walk", longSleeve: true,
    tops: ["#161618", "#2a2c30", "#e9e7e2", "#2e3a52"], bottoms: ["#1c1c1c"], shoes: ["#f0f0f0", "#1c1c1c"], hairs: DARK_HAIR, accs: [], weight: 4 },
  { name: "택배기사", h: 1.74, build: 1.05, top: "tee", bottom: "pants", hair: "cap", acc: "parcel", gait: "carry", longSleeve: true,
    tops: ["#2d5a9c", "#e0632a", "#3a3a3a"], bottoms: ["#2a2d33"], shoes: ["#1c1c1c"], hairs: ["#2d5a9c", "#1c1c1c"], accs: ["#b88a55"], weight: 2 },
  { name: "원피스 여성", h: 1.63, build: 0.88, top: "dress", bottom: "none", hair: "sunhat", acc: "crossbody", gait: "stroll", longSleeve: false,
    tops: ["#f0e6d2", "#9bb7d4", "#d9a3a3", "#bcc9a0", "#f4f1ea"], bottoms: [], shoes: ["#e8dccb", "#8a6a50"], hairs: ["#e6d6b8", "#d8c4a0", "#2c2c2c"], accs: ["#7a5a3a", "#e8e0d0"], weight: 4 },
  { name: "반팔 반바지 남성", h: 1.75, build: 1.02, top: "tee", bottom: "shorts", hair: "buzz", acc: "none", gait: "stroll", longSleeve: false,
    tops: ["#f4f4f2", "#1f2a3a", "#7a8a6a", "#c9b79a"], bottoms: ["#b8a584", "#3d4a5c", "#6a6a66"], shoes: ["#f0f0f0", "#3a3a3a"], hairs: DARK_HAIR, accs: [], weight: 4 },
  { name: "장보기 주부", h: 1.6, build: 0.96, top: "shirt", bottom: "pants", hair: "bob", acc: "shopping", gait: "walk", longSleeve: true,
    tops: ["#e8dcc8", "#c9d4dc", "#d9b9a9", "#a9b89a"], bottoms: ["#2f3b54", "#4a4a4a", "#d8d0c0"], shoes: ["#ecebe8", "#3a2e28"], hairs: DARK_HAIR, accs: ["#f0f0ee", "#e2a23a", "#5a8a4a"], weight: 5 },
  { name: "체크셔츠 남성", h: 1.73, build: 1.0, top: "shirt", bottom: "pants", hair: "short", acc: "crossbody", gait: "walk", longSleeve: true,
    tops: ["#7a2f2f", "#2f4f7a", "#4a5a3a", "#c9c9c4"], bottoms: ["#384a68", "#2a2a2a", "#9a8a70"], shoes: ["#3a2a1e", "#f0f0f0"], hairs: DARK_HAIR, accs: ["#2a2a2a", "#5a4a3a"], weight: 5 },
  { name: "현장 근로자", h: 1.74, build: 1.1, top: "vest", bottom: "pants", hair: "helmet", acc: "none", gait: "walk", longSleeve: true,
    tops: ["#5a6470", "#6a5a4a"], bottoms: ["#3a4250", "#4a4238"], shoes: ["#3a2a1a"], hairs: ["#f2f2ee", "#f2c230"], accs: [], detail: "hivis", weight: 2 },
  { name: "레깅스 운동복 여성", h: 1.64, build: 0.86, top: "tee", bottom: "pants", hair: "pony", acc: "none", gait: "walk", longSleeve: false,
    tops: ["#e8e4df", "#f2b8c6", "#9ad0c8", "#2a2a2c"], bottoms: ["#1c1c1e", "#3a3f4a", "#5a4a5a"], shoes: ["#f5f5f5", "#b8c8e8"], hairs: DARK_HAIR, accs: [], weight: 4 },
];

const HELD = new Set<Acc>(["briefcase", "handbag", "shopping", "tote"]);

/* ---------- Part geometry (body frame, each around its own joint) ---------- */

const lathe = (profile: [number, number][], depth = 0.68, segs = 12) => {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  g.scale(1, 1, depth);
  g.computeVertexNormals();
  return g;
};
const limb = (r0: number, r1: number, len: number, segs = 9) => {
  const g = new THREE.CylinderGeometry(r0, r1, len, segs, 1);
  g.translate(0, -len / 2, 0);
  // Rounded joint caps so a bent knee or elbow doesn't show a hollow end.
  const top = new THREE.SphereGeometry(r0, segs, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const bot = new THREE.SphereGeometry(r1, segs, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bot.translate(0, -len, 0);
  const out = mergeGeometries([g, top, bot].map(x => x.toNonIndexed()), false)!;
  [g, top, bot].forEach(x => x.dispose());
  return out;
};
const ellipsoid = (rx: number, ry: number, rz: number, x = 0, y = 0, z = 0, segs = 12) => {
  const g = new THREE.SphereGeometry(1, segs, Math.max(6, segs * 0.7 | 0));
  g.scale(rx, ry, rz); g.translate(x, y, z);
  return g.toNonIndexed();
};
const merge = (list: THREE.BufferGeometry[]) => {
  const out = mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)).map(g => { g.deleteAttribute("uv"); return g; }), false)!;
  list.forEach(g => g.dispose());
  return out;
};
const colored = (g: THREE.BufferGeometry, color: string) => {
  const c = new THREE.Color(color), n = g.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
};

// Joints (adult, metres).
const HIP_Y = 0.92, HIP_X = 0.092, THIGH = 0.43, SHIN = 0.41, SHOULDER_Y = 1.41, SHOULDER_X = 0.2, UPPER = 0.29, FORE = 0.25;
const NECK_Y = 1.47;

let partsCache: ReturnType<typeof partGeometries> | null = null;
function partGeometries() {
  const torso: Record<Top, THREE.BufferGeometry> = {
    shirt: lathe([[0, 0.86], [0.14, 0.87], [0.155, 0.96], [0.142, 1.08], [0.155, 1.22], [0.178, 1.35], [0.172, 1.42], [0.11, 1.47], [0.05, 1.49], [0, 1.49]]),
    tee: lathe([[0, 0.88], [0.138, 0.89], [0.15, 0.97], [0.138, 1.08], [0.152, 1.22], [0.176, 1.35], [0.17, 1.42], [0.1, 1.47], [0.05, 1.485], [0, 1.485]]),
    blouse: lathe([[0, 0.9], [0.13, 0.91], [0.138, 0.98], [0.122, 1.08], [0.142, 1.2], [0.16, 1.33], [0.158, 1.41], [0.1, 1.465], [0.05, 1.48], [0, 1.48]]),
    jacket: lathe([[0, 0.8], [0.162, 0.81], [0.17, 0.92], [0.158, 1.06], [0.168, 1.22], [0.19, 1.36], [0.186, 1.43], [0.12, 1.475], [0.06, 1.5], [0, 1.5]]),
    hoodie: merge([lathe([[0, 0.84], [0.16, 0.85], [0.168, 0.95], [0.16, 1.08], [0.17, 1.22], [0.188, 1.36], [0.182, 1.43], [0.12, 1.47], [0.06, 1.49], [0, 1.49]]),
      ellipsoid(0.12, 0.07, 0.07, 0, 1.46, -0.09)]),
    coat: lathe([[0, 0.42], [0.2, 0.43], [0.19, 0.6], [0.175, 0.8], [0.165, 0.98], [0.162, 1.1], [0.172, 1.24], [0.192, 1.36], [0.188, 1.43], [0.12, 1.475], [0.07, 1.51], [0, 1.51]]),
    // Long padded coat: quilted in rings.
    puffer: lathe([[0, 0.34], [0.2, 0.35], [0.215, 0.42], [0.2, 0.5], [0.215, 0.58], [0.2, 0.66], [0.212, 0.74], [0.198, 0.82], [0.206, 0.9], [0.192, 0.98],
      [0.2, 1.06], [0.19, 1.14], [0.2, 1.22], [0.205, 1.32], [0.2, 1.42], [0.13, 1.48], [0.09, 1.54], [0, 1.54]], 0.7),
    dress: lathe([[0, 0.5], [0.23, 0.51], [0.2, 0.66], [0.165, 0.84], [0.135, 0.98], [0.122, 1.06], [0.14, 1.2], [0.158, 1.33], [0.156, 1.41], [0.1, 1.465], [0.05, 1.48], [0, 1.48]]),
    vest: lathe([[0, 0.84], [0.16, 0.85], [0.168, 0.96], [0.158, 1.08], [0.168, 1.22], [0.186, 1.35], [0.18, 1.43], [0.12, 1.47], [0.06, 1.49], [0, 1.49]]),
  };
  const hips = lathe([[0, 0.8], [0.13, 0.81], [0.155, 0.88], [0.148, 0.97], [0, 0.97]]);
  const skirt = lathe([[0, 0.6], [0.2, 0.61], [0.17, 0.76], [0.145, 0.9], [0.13, 1.0], [0, 1.0]]);
  const thigh = limb(0.084, 0.062, THIGH), shin = limb(0.06, 0.044, SHIN);
  const shoe = merge([ellipsoid(0.048, 0.04, 0.125, 0, -SHIN - 0.028, 0.045), new RoundedBoxGeometry(0.1, 0.03, 0.26, 2, 0.012).translate(0, -SHIN - 0.058, 0.045)]);
  const upper = limb(0.054, 0.045, UPPER, 10), fore = limb(0.044, 0.035, FORE, 10);
  const hand = merge([ellipsoid(0.03, 0.05, 0.02, 0, -FORE - 0.045, 0, 8), ellipsoid(0.012, 0.03, 0.012, 0.022, -FORE - 0.035, 0.012, 6)]);
  // Head (in the neck frame): skull, jaw, nose, ears, neck.
  const head = merge([
    ellipsoid(0.094, 0.11, 0.1, 0, 0.13, 0.006, 12), ellipsoid(0.075, 0.06, 0.08, 0, 0.075, 0.022, 12),
    ellipsoid(0.016, 0.024, 0.02, 0, 0.12, 0.103, 6), ellipsoid(0.014, 0.026, 0.012, 0.094, 0.125, 0, 6), ellipsoid(0.014, 0.026, 0.012, -0.094, 0.125, 0, 6),
    new THREE.CylinderGeometry(0.046, 0.05, 0.1, 10).translate(0, 0.03, 0),
  ]);
  const cap = (rx: number, ry: number, rz: number, y: number, z: number, theta: number) => {
    const g = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, theta);
    g.scale(rx, ry, rz); g.translate(0, y, z);
    return g.toNonIndexed();
  };
  const hair: Record<Hair, THREE.BufferGeometry> = {
    short: merge([cap(0.101, 0.118, 0.108, 0.135, -0.006, Math.PI * 0.52)]),
    buzz: merge([cap(0.098, 0.114, 0.104, 0.133, -0.004, Math.PI * 0.48)]),
    bob: merge([cap(0.108, 0.122, 0.112, 0.132, -0.01, Math.PI * 0.68)]),
    long: merge([cap(0.104, 0.12, 0.11, 0.133, -0.008, Math.PI * 0.56),
      new THREE.CylinderGeometry(0.104, 0.118, 0.26, 16, 1, true, Math.PI * 0.62, Math.PI * 0.76).translate(0, 0.02, -0.012)]),
    pony: merge([cap(0.102, 0.12, 0.108, 0.134, -0.006, Math.PI * 0.55), ellipsoid(0.04, 0.035, 0.04, 0, 0.17, -0.105),
      new THREE.CylinderGeometry(0.03, 0.012, 0.2, 8).translate(0, 0.07, -0.13)]),
    perm: merge([new THREE.IcosahedronGeometry(1, 2).scale(0.114, 0.1, 0.118).translate(0, 0.17, -0.012)]),
    cap: merge([cap(0.104, 0.12, 0.11, 0.138, -0.004, Math.PI * 0.46), new THREE.CylinderGeometry(0.075, 0.08, 0.012, 14, 1, false, -Math.PI * 0.5, Math.PI).scale(1, 1, 1.25).translate(0, 0.182, 0.07)]),
    sunhat: merge([cap(0.104, 0.12, 0.11, 0.14, -0.004, Math.PI * 0.46), new THREE.CylinderGeometry(0.2, 0.2, 0.01, 22).translate(0, 0.178, 0)]),
    helmet: merge([cap(0.122, 0.13, 0.13, 0.15, 0, Math.PI * 0.5), new THREE.CylinderGeometry(0.14, 0.14, 0.012, 20).scale(1, 1, 1.12).translate(0, 0.152, 0.01)]),
  };
  const acc: Record<Exclude<Acc, "none">, THREE.BufferGeometry> = {
    backpack: merge([new RoundedBoxGeometry(0.28, 0.38, 0.14, 2, 0.04).translate(0, 1.18, -0.2)]),
    schoolbag: merge([new RoundedBoxGeometry(0.28, 0.3, 0.16, 2, 0.04).translate(0, 1.1, -0.2)]),
    crossbody: merge([new RoundedBoxGeometry(0.2, 0.15, 0.06, 2, 0.02).translate(0.17, 0.98, 0.04),
      new THREE.BoxGeometry(0.02, 0.62, 0.012).rotateZ(0.62).translate(0.0, 1.2, 0.11)]),
    // Hand-held: in the forearm frame, below the hand.
    briefcase: merge([new RoundedBoxGeometry(0.08, 0.3, 0.42, 2, 0.02).translate(0, -FORE - 0.24, 0)]),
    handbag: merge([new RoundedBoxGeometry(0.1, 0.2, 0.28, 2, 0.03).translate(0, -FORE - 0.2, 0.02)]),
    shopping: merge([new RoundedBoxGeometry(0.1, 0.34, 0.3, 1, 0.01).translate(0, -FORE - 0.26, 0.02)]),
    tote: merge([new RoundedBoxGeometry(0.08, 0.34, 0.34, 1, 0.01).translate(0.02, -FORE - 0.1, 0.02)]),
    parcel: merge([new RoundedBoxGeometry(0.42, 0.3, 0.32, 1, 0.01).translate(0, 1.08, 0.3)]),
  };
  // Baked details (vertex colours, drawn with a white instance colour).
  const detail = {
    tie: merge([colored(new THREE.PlaneGeometry(0.1, 0.2).translate(0, 1.36, 0).toNonIndexed(), "#f2f2f0"),
      colored(new THREE.BoxGeometry(0.035, 0.26, 0.01).translate(0, 1.3, 0.004).toNonIndexed(), "#7a1f2a")].map(g => { g.translate(0, 0, 0.132); return g; })),
    ribbon: merge([colored(new THREE.PlaneGeometry(0.1, 0.14).translate(0, 1.37, 0).toNonIndexed(), "#f2f2f0"),
      colored(new THREE.BoxGeometry(0.09, 0.035, 0.015).translate(0, 1.4, 0.006).toNonIndexed(), "#b3263a")].map(g => { g.translate(0, 0, 0.132); return g; })),
    collar: merge([colored(new THREE.PlaneGeometry(0.09, 0.12).translate(0, 1.38, 0.132).toNonIndexed(), "#f2f2f0")]),
    hivis: merge([colored(lathe([[0.172, 1.08], [0.174, 1.12]], 0.69, 18).toNonIndexed(), "#e8ff3a"), colored(lathe([[0.176, 1.22], [0.178, 1.26]], 0.69, 18).toNonIndexed(), "#e8ff3a"),
      colored(lathe([[0.17, 0.86], [0.172, 1.0]], 0.695, 18).toNonIndexed(), "#ff7a1a"), colored(lathe([[0.172, 1.0], [0.174, 1.08]], 0.695, 18).toNonIndexed(), "#ff7a1a"),
      colored(lathe([[0.174, 1.12], [0.176, 1.22]], 0.695, 18).toNonIndexed(), "#ff7a1a"), colored(lathe([[0.178, 1.26], [0.186, 1.4]], 0.695, 18).toNonIndexed(), "#ff7a1a")]),
  };
  return { torso, hips, skirt, thigh, shin, shoe, upper, fore, hand, head, hair, acc, detail };
}

/* ---------- The crowd ---------- */

/** A line people walk along (footprint frame): points, running length, whether it
 * closes on itself, how high above the ground it is (a raised sidewalk) and how far to
 * the right of the line each keeps (two-way foot traffic). */
export interface WalkPath { xs: Float32Array; ys: Float32Array; cum: Float32Array; closed: boolean; lift: number; lateral: number }

const toPath = (pts: [number, number][], closed: boolean, lift: number, lateral: number): WalkPath => {
  const n = pts.length + (closed ? 1 : 0), xs = new Float32Array(n), ys = new Float32Array(n), cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i % pts.length];
    xs[i] = x; ys[i] = y;
    if (i) cum[i] = cum[i - 1] + Math.hypot(x - xs[i - 1], y - ys[i - 1]);
  }
  return { xs, ys, cum, closed, lift, lateral };
};

/** The middle of each sidewalk run (raised, about 3/5 of the way out from the kerb). */
export function sidewalkPaths(runs: Run[]): WalkPath[] {
  return runs.filter(r => r.cum[r.cum.length - 1] > 14).map(r => {
    const pts: [number, number][] = [];
    for (let i = 0; i < r.cum.length; i++) pts.push(runPt(r, i, r.half + r.width * 0.64));
    return toPath(pts, false, KERB_H, r.width * 0.15);
  });
}

/** Lines `offset` metres inside (negative: outside) each ring — a parcel's edge walk,
 * the path round a tower — resampled every 2 m and cut wherever they would pass through
 * a building; a ring clear all round stays one closed loop. */
export function ringPaths(rings: Ring[], offset: number, blocked: (x: number, y: number) => boolean, lateral: number, minLen = 20): WalkPath[] {
  const out: WalkPath[] = [];
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    // Offset each vertex along its averaged inward normal (counter-clockwise rings: left is in).
    const off: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const [px, py] = ring[(i + n - 1) % n], [x, y] = ring[i], [qx, qy] = ring[(i + 1) % n];
      const l1 = Math.hypot(x - px, y - py) || 1, l2 = Math.hypot(qx - x, qy - y) || 1;
      let nx = -(y - py) / l1 - (qy - y) / l2, ny = (x - px) / l1 + (qx - x) / l2;
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const miter = Math.min(2, 1 / Math.max(0.5, (nx * -(y - py) + ny * (x - px)) / l1));
      off.push([x + nx * offset * miter, y + ny * offset * miter]);
    }
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = off[i], [bx, by] = off[(i + 1) % n], len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += 2) pts.push([ax + (bx - ax) * d / len, ay + (by - ay) * d / len]);
    }
    let cur: [number, number][] = [], cut = false;
    const flush = () => {
      if (cur.length > 2) { const p = toPath(cur, false, 0, lateral); if (p.cum[p.cum.length - 1] >= minLen) out.push(p); }
      cur = [];
    };
    for (const pt of pts) { if (blocked(pt[0], pt[1])) { cut = true; flush(); } else cur.push(pt); }
    if (!cut && cur.length > 4) { const p = toPath(cur, true, 0, lateral); if (p.cum[p.cum.length - 1] >= minLen) out.push(p); }
    else flush();
  }
  return out;
}

/** Cut paths wherever a walker (on the line, or keeping to either side of it) would be
 * somewhere people must not walk. */
export function cutPaths(paths: WalkPath[], blocked: (x: number, y: number) => boolean, minLen = 8): WalkPath[] {
  const out: WalkPath[] = [];
  for (const p of paths) {
    const n = p.xs.length;
    let cur: [number, number][] = [], cut = false;
    const flush = () => { if (cur.length > 2) { const q = toPath(cur, false, p.lift, p.lateral); if (q.cum[q.cum.length - 1] >= minLen) out.push(q); } cur = []; };
    for (let i = 0; i < n; i++) {
      const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1);
      const dx = p.xs[j] - p.xs[k], dy = p.ys[j] - p.ys[k], l = Math.hypot(dx, dy) || 1, ox = (dy / l) * p.lateral, oy = (-dx / l) * p.lateral;
      const x = p.xs[i], y = p.ys[i];
      if (blocked(x, y) || blocked(x + ox, y + oy) || blocked(x - ox, y - oy)) { cut = true; flush(); }
      else cur.push([x, y]);
    }
    if (!cut) out.push(p); else flush();
  }
  return out;
}

interface Walker {
  kind: Kind; path: WalkPath; s: number; dir: 1 | -1; speed: number; phase: number; scale: number; width: number;
  /** Near the view last time looked at (else walked on in larger steps), and the time owed. */
  around?: boolean; lag?: number;
  /** Instance slots: [mesh index, slot] per part, in pose order. */
  slots: [number, number][];
  /** Colours of the distant stand-in: top, legs, skin. */
  far: [THREE.Color, THREE.Color, THREE.Color];
  /** The slot of a bag carried in the right hand (follows that forearm), or -1. */
  held: number;
  /** Collapsed (out of view or far off). */
  hidden: boolean;
  x: number; y: number; hx: number; hy: number;
  /** Knocked down by a driven vehicle: thrown along (vx, vy), lying, up again after a while. */
  fall?: { t: number; vx: number; vy: number };
}

/** People on `paths`, about one per `spacing` metres of path, at most `cap`. */
export async function buildWalkers(paths: WalkPath[], terrain: Terrain, seed: number, spacing: number, cap: number) {
  const usable = paths.filter(r => r.cum[r.cum.length - 1] > 6);
  if (!usable.length) return null;
  const rnd = rng(seed + 97);
  // (the body parts are the same for every crowd: made once, kept for the session — each
  // crowd made them again, ~20 ms of a frame)
  const parts = partsCache ??= partGeometries();
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0 });
  const skin = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  const hairMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
  const gloss = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.08 });
  const baked = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });

  const total = usable.reduce((s, r) => s + r.cum[r.cum.length - 1], 0);
  const count = Math.min(cap, Math.round(total / spacing));
  const totalW = KINDS.reduce((s, k) => s + k.weight, 0);
  const pickKind = () => { let r = rnd() * totalW; for (const k of KINDS) { r -= k.weight; if (r <= 0) return k; } return KINDS[0]; };
  const pick = (list: string[]) => list[Math.floor(rnd() * list.length)];

  // Mesh registry: one InstancedMesh per (geometry, material); filled after counting.
  type Entry = { geo: THREE.BufferGeometry; mat: THREE.Material; colors: THREE.Color[]; shadow: boolean };
  const entries: Entry[] = [];
  const index = new Map<string, number>();
  const slot = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, color: string, shadow = false): [number, number] => {
    let i = index.get(key);
    if (i === undefined) { i = entries.length; index.set(key, i); entries.push({ geo, mat, colors: [], shadow }); }
    entries[i].colors.push(new THREE.Color(color));
    return [i, entries[i].colors.length - 1];
  };

  const walkers: Walker[] = [];
  // (a few ms at a time: 650 people at once held the page ~45 ms)
  let slice = performance.now();
  for (let n = 0; n < count; n++) {
    if (performance.now() - slice > 6) { await frameSlice(); slice = performance.now(); }
    // Longer runs get proportionally more people.
    let r = rnd() * total, path = usable[0];
    for (const u of usable) { r -= u.cum[u.cum.length - 1]; if (r <= 0) { path = u; break; } }
    const kind = pickKind(), dir = rnd() < 0.5 ? 1 : -1;
    const skinC = pick(SKIN), top = pick(kind.tops), bottom = kind.bottoms.length ? pick(kind.bottoms) : top;
    const legC = kind.bottom === "skirt" || kind.bottom === "none" ? (kind.legs ?? skinC) : kind.bottom === "shorts" ? skinC : bottom;
    const thighC = kind.bottom === "shorts" ? bottom : legC;
    const shoe = pick(kind.shoes), hairC = pick(kind.hairs), accC = kind.accs.length ? pick(kind.accs) : "#333";
    const sleeve = kind.top === "vest" ? pick(["#e8e4dc", "#5a6470"]) : top;
    const slots: [number, number][] = [
      slot("torso:" + kind.top, parts.torso[kind.top], cloth, top, true),
      slot("head", parts.head, skin, skinC, true),
      slot("hair:" + kind.hair, parts.hair[kind.hair], kind.hair === "cap" || kind.hair === "helmet" || kind.hair === "sunhat" ? cloth : hairMat, hairC),
      slot("thigh", parts.thigh, cloth, thighC, true), slot("thigh", parts.thigh, cloth, thighC, true),
      slot(legC === skinC ? "shin:skin" : "shin", parts.shin, legC === skinC ? skin : cloth, legC, true),
      slot(legC === skinC ? "shin:skin" : "shin", parts.shin, legC === skinC ? skin : cloth, legC, true),
      slot("shoe", parts.shoe, gloss, shoe), slot("shoe", parts.shoe, gloss, shoe),
      slot("upper", parts.upper, cloth, sleeve), slot("upper", parts.upper, cloth, sleeve),
      slot(kind.longSleeve ? "fore" : "fore:skin", parts.fore, kind.longSleeve ? cloth : skin, kind.longSleeve ? sleeve : skinC),
      slot(kind.longSleeve ? "fore" : "fore:skin", parts.fore, kind.longSleeve ? cloth : skin, kind.longSleeve ? sleeve : skinC),
      slot("hand", parts.hand, skin, skinC), slot("hand", parts.hand, skin, skinC),
    ];
    if (kind.bottom === "pants" || kind.bottom === "shorts") slots.push(slot("hips", parts.hips, cloth, bottom, true));
    if (kind.bottom === "skirt") slots.push(slot("skirt", parts.skirt, cloth, bottom, true));
    let held = -1;
    if (kind.acc !== "none") {
      if (HELD.has(kind.acc)) held = slots.length;
      slots.push(slot("acc:" + kind.acc, parts.acc[kind.acc], gloss, accC, true));
    }
    if (kind.detail) slots.push(slot("detail:" + kind.detail, parts.detail[kind.detail], baked, "#ffffff"));
    const len = path.cum[path.cum.length - 1];
    const speed = (kind.gait === "run" ? 2.7 : kind.gait === "slow" ? 0.85 : kind.gait === "stroll" ? 1.05 : 1.3) * (0.9 + rnd() * 0.2);
    walkers.push({ kind, path, s: rnd() * len, dir, speed, phase: rnd() * Math.PI * 2,
      scale: (kind.h / 1.7) * (0.96 + rnd() * 0.08), width: kind.build * (0.95 + rnd() * 0.1), slots, held, hidden: false, x: 0, y: 0, hx: 1, hy: 0,
      far: [new THREE.Color(top), new THREE.Color(thighC), new THREE.Color(skinC)] });
  }

  // Only people in view are drawn: each frame they are packed to the front of the
  // instance lists and the draw count set to them (a collapsed instance still costs its
  // vertices, in the main and every shadow pass). Near ones get the jointed figure; past
  // NEAR (a few pixels tall) a three-box stand-in in their colours, without a shadow.
  const group = new THREE.Group();
  const newMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    im.setColorAt(0, new THREE.Color());
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.count = 0;
    group.add(im);
    return im;
  };
  const meshes = entries.map(e => newMesh(e.geo, e.mat, e.colors.length, e.shadow));
  const box = (w: number, h: number, d: number, y: number) => new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
  const farGeos = [box(0.4, SHOULDER_Y - HIP_Y + 0.1, 0.24, (HIP_Y + SHOULDER_Y) / 2), box(0.3, HIP_Y, 0.2, HIP_Y / 2), box(0.2, 0.24, 0.22, NECK_Y + 0.12)];
  const farMeshes = farGeos.map(g => newMesh(g, cloth, walkers.length, false));
  // What each packed position holds (colour index / walker), to re-upload only changes.
  const held = meshes.map(m => new Int32Array(m.instanceMatrix.count).fill(-1));
  const farHeld = new Int32Array(walkers.length).fill(-1);
  const cursor = new Int32Array(meshes.length), colorFrom = new Int32Array(meshes.length), colorTo = new Int32Array(meshes.length);
  const NEAR = 90;

  // Pose: per walker a base matrix, then joints down each limb.
  const base = new THREE.Matrix4(), joint = new THREE.Matrix4(), tmp = new THREE.Matrix4(), tmp2 = new THREE.Matrix4();
  const q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const rotX = new THREE.Matrix4();
  const set = (w: Walker, k: number, m: THREE.Matrix4) => {
    const [mi, ci] = w.slots[k];
    const at = cursor[mi]++;
    meshes[mi].setMatrixAt(at, m);
    if (held[mi][at] !== ci) {
      held[mi][at] = ci;
      meshes[mi].setColorAt(at, entries[mi].colors[ci]);
      colorFrom[mi] = Math.min(colorFrom[mi], at); colorTo[mi] = Math.max(colorTo[mi], at);
    }
  };
  /** T(x, y, z) · Rx(a), post-multiplied onto `from` into `out`. */
  const chain = walkerJoint;
  const frustum = new THREE.Frustum(), vp = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 1.2), wide = new THREE.Sphere(new THREE.Vector3(), 15);
  let frameN = 0;
  const camPos = new THREE.Vector3();

  const advance = (w: Walker, dt: number) => {
    const r = w.path, len = r.cum[r.cum.length - 1];
    w.s += w.dir * w.speed * dt;
    // A loop goes on round; an open path turns back at its ends.
    if (r.closed) w.s = ((w.s % len) + len) % len;
    else if (w.s > len - 0.5) { w.s = len - 0.5; w.dir = -1; }
    else if (w.s < 0.5) { w.s = 0.5; w.dir = 1; }
    let lo = 0, hi = r.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (r.cum[mid] <= w.s) lo = mid; else hi = mid - 1; }
    const i = Math.min(lo, r.cum.length - 2);
    const t = (w.s - r.cum[i]) / Math.max(0.01, r.cum[i + 1] - r.cum[i]);
    const ax = r.xs[i], ay = r.ys[i], bx = r.xs[i + 1], by = r.ys[i + 1];
    const sx = bx - ax, sy = by - ay, sl = Math.hypot(sx, sy) || 1;
    // Keep to the right of the line in the direction of walking.
    const off = r.lateral * w.dir;
    w.x = ax + sx * t + (sy / sl) * off; w.y = ay + sy * t - (sx / sl) * off;
    const dx = sx * w.dir, dy = sy * w.dir, l = sl;
    // Turn smoothly rather than snapping at each sample.
    w.hx += (dx / l - w.hx) * Math.min(1, dt * 6); w.hy += (dy / l - w.hy) * Math.min(1, dt * 6);
    const stride = (w.kind.gait === "run" ? 2.5 : 1.45) * w.scale;
    w.phase += (w.speed * dt / stride) * Math.PI * 2;
  };

  const place = (w: Walker, bob: number) => {
    q.setFromAxisAngle(yAxis, Math.atan2(w.hx, -w.hy));
    pos.set(w.x, terrain.at(w.x, w.y) + w.path.lift + bob * w.scale, -w.y);
    scl.set(w.scale * w.width, w.scale, w.scale * w.width);
    base.compose(pos, q, scl);
  };
  let farAt = 0, farFrom = 0, farTo = -1;
  const poseFar = (w: Walker, wi: number) => {
    place(w, 0);
    const at = farAt++;
    farMeshes.forEach(m => m.setMatrixAt(at, base));
    if (farHeld[at] !== wi) {
      farHeld[at] = wi;
      farMeshes.forEach((m, k) => m.setColorAt(at, w.far[k]));
      farFrom = Math.min(farFrom, at); farTo = Math.max(farTo, at);
    }
  };
  const pose = (w: Walker) => {
    const g = w.kind.gait, φ = w.phase, run = g === "run";
    const swing = run ? 0.72 : g === "slow" ? 0.26 : g === "stroll" ? 0.32 : 0.4;
    place(w, (run ? 0.06 : 0.022) * Math.abs(Math.sin(φ)));
    // (knocked down: tipped over backwards from the feet, lying a while, then up again)
    if (w.fall) { const f = w.fall.t, k = f < 0.35 ? f / 0.35 : f > 4.4 ? Math.max(0, 1 - (f - 4.4) / 0.6) : 1; base.multiply(rotX.makeRotationX(-1.45 * k)); }
    if (run || g === "slow") base.multiply(rotX.makeRotationX(run ? 0.14 : 0.07));
    set(w, 0, base);
    // Head (hair shares its frame).
    chain(joint, base, 0, NECK_Y, 0, g === "slow" ? 0.12 : 0);
    set(w, 1, joint); set(w, 2, joint);
    // Legs: hip swing, knee flexing in the swing phase; the shoe rides the shin.
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1;
      const a = Math.sin(φ + (k ? Math.PI : 0)), da = Math.cos(φ + (k ? Math.PI : 0));
      chain(tmp, base, side * HIP_X, HIP_Y, 0, -swing * a);
      set(w, 3 + k, tmp);
      const knee = (run ? 0.25 : 0.06) + (run ? 1.3 : 0.62) * Math.max(0, da) * (0.6 + 0.4 * Math.max(0, a + 0.3));
      chain(tmp2, tmp, 0, -THIGH, 0, knee);
      set(w, 5 + k, tmp2); set(w, 7 + k, tmp2);
    }
    // Arms: opposite the legs; carrying holds both forward, hand-held bags swing less.
    const carry = g === "carry", held = w.held >= 0;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1;
      const a = Math.sin(φ + (k ? 0 : Math.PI));
      const loaded = held && k === 1;
      const sh = carry ? -0.75 : -(run ? 0.55 : loaded ? swing * 0.25 : swing * 0.85) * a;
      chain(tmp, base, side * SHOULDER_X, SHOULDER_Y, 0, sh);
      tmp.multiply(rotX.makeRotationZ(side * (carry ? 0.05 : 0.09)));
      set(w, 9 + k, tmp);
      const el = carry ? -1.05 : run ? -1.45 : loaded ? -0.05 : -(0.18 + 0.2 * Math.max(0, -a));
      chain(tmp2, tmp, 0, -UPPER, 0, el);
      set(w, 11 + k, tmp2); set(w, 13 + k, tmp2);
      if (loaded) set(w, w.held, tmp2);
    }
    for (let k = 15; k < w.slots.length; k++) if (k !== w.held) set(w, k, base);
  };
  group.userData.walkers = walkers; // inspection in dev tools
  const upload = (m: THREE.InstancedMesh, n: number, c0: number, c1: number) => {
    m.count = n;
    if (!n) return;
    flushInstanceAttribute(m.instanceMatrix,n);
    if (c1 >= c0) {
      const attr = m.instanceColor!;
      // A draw not yet made may not have consumed the last colour update: keep it.
      for (const r of attr.updateRanges) { c0 = Math.min(c0, r.start / 3); c1 = Math.max(c1, (r.start + r.count) / 3 - 1); }
      attr.clearUpdateRanges();
      attr.addUpdateRange(c0 * 3, (c1 - c0 + 1) * 3);
      attr.needsUpdate = true;
    }
  };

  return {
    group,
    /** Walk; draw those in view (jointed near, stand-ins far). */
    update(dt: number, camera: THREE.Camera) {
      dt = Math.min(0.1, dt);
      cursor.fill(0); colorFrom.fill(2147483647); colorTo.fill(-1);
      farAt = 0; farFrom = 2147483647; farTo = -1;
      vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(vp);
      camPos.setFromMatrixPosition(camera.matrixWorld);
      // Distances judged as seen: a zoomed-in view (a narrower field, the balloon's
      // binoculars) brings people as close as walking up to them would. 36° is the
      // view's own field.
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 36;
      const zoom = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.tan(THREE.MathUtils.degToRad(18));
      const zoom2 = zoom * zoom;
      frameN++;
      walkers.forEach((w, wi) => {
        // Those well out of view (or too far) walk on every sixth frame by the time owed: no one
        // sees them, and most of the crowd is out of view at any time. "Near the view" has a
        // 15 m margin, so anyone turning into it is already walking frame by frame.
        if (w.fall) {
          const f = w.fall; f.t += dt;
          const slow = Math.exp(-dt * 4); f.vx *= slow; f.vy *= slow; w.x += f.vx * dt; w.y += f.vy * dt;
          if (f.t > 5) w.fall = undefined;
        } else {
        if (w.around === false && (wi + frameN) % 6) { w.lag = (w.lag ?? 0) + dt; return; }
        advance(w, dt + (w.lag ?? 0)); w.lag = 0;
        }
        sphere.center.set(w.x, terrain.at(w.x, w.y) + 1, -w.y);
        const d2 = sphere.center.distanceToSquared(camPos) * zoom2;
        wide.center.copy(sphere.center);
        w.around = d2 <= 440 * 440 && frustum.intersectsSphere(wide);
        // Out of view or too far to make out: not drawn at all.
        if (d2 > 420 * 420 || !frustum.intersectsSphere(sphere)) return;
        if (d2 > NEAR * NEAR) poseFar(w, wi); else pose(w);
      });
      meshes.forEach((m, i) => upload(m, cursor[i], colorFrom[i], colorTo[i]));
      farMeshes.forEach(m => upload(m, farAt, farFrom, farTo));
    },
    /** The people standing within r of (x, y) (for a driven vehicle). */
    near(x: number, y: number, r: number) { return walkers.filter(w => !w.fall && Math.abs(w.x - x) < r && Math.abs(w.y - y) < r); },
    /** Knock one down, thrown along (vx, vy) m/s. */
    knock(w: { x: number; y: number }, vx: number, vy: number) { (w as Walker).fall = { t: 0, vx, vy }; },
    dispose() {
      meshes.forEach(m => m.dispose());
      // (the body parts stay: shared by every crowd, see partsCache)
      farGeos.forEach(g => g.dispose());
      [cloth, skin, hairMat, gloss, baked].forEach(m => m.dispose());
    },
  };
}
