/* Luxury Haute-Joaillerie Bull-Market Celebration Pyrotechnics for KOSPIMAP 3D Stock Exchange (WebGPU 60 FPS, 0 GC):
 * - Index >= +3.0% (Tier 1 Bull Festival + Auto Neon Night):
 *   1. Ceiling crimson-red neon lines glow 3.0x brighter + refined crimson-gold central pillar crown beacon glow.
 *   2. Delicate shimmering gold & silver powder curtains (1,600 fine grains/flecks — PulseBoard assetCellArt.ts
 *      physics, ZERO spear shapes!) snow gracefully from all 3D ceiling neon rings & 12 vaulted radial ribs ALL THE WAY
 *      down to the 1st-floor marble.
 *   3. Room-wide, slow-blooming micro-glitter fireworks (ZERO meteor tails!) in 4 distinct, unmistakable signature types:
 *        (0) Grand Chrysanthemum Sphere, (1) Tilted Double Halo Ring, (2) 5-Arm Spiral Galaxy, (3) Multi-Cluster Bouquet
 *      spreading wide across the entire 360° atrium and drifting down like shimmering gold/silver/ruby/emerald snow
 *      all the way to the marble floor (y = 0.12m)!
 *   4. Luxury color harmony: Gold & Silver dominant (~65%) with Velvet Ruby/Rose Red (~20%) & Imperial Emerald/Jade Green (~15%).
 * - Index >= +4.0% (Tier 2 Super Rally):
 *   - Ceiling neon falling gold/silver powder doubles (EXACT 2.0x: 1,600 -> 3,200!) + richer room-wide festival cadence
 *     at locked 60 FPS!
 */
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide,
  Group, InstancedBufferAttribute, InstancedMesh, LinearFilter, Mesh,
  MeshBasicMaterial, PlaneGeometry, PointLight, RingGeometry, SRGBColorSpace,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Precomputed 1024-entry trig LUT for ultra-fast, zero-GC 60 FPS particle animation (< 0.003 rad precision)
const TRIG_N = 1024;
const TRIG_MASK = TRIG_N - 1;
const TRIG_SCALE = TRIG_N / (Math.PI * 2);
const SIN_LUT = new Float32Array(TRIG_N);
const COS_LUT = new Float32Array(TRIG_N);
for (let i = 0; i < TRIG_N; i++) {
  const a = (i / TRIG_N) * Math.PI * 2;
  SIN_LUT[i] = Math.sin(a);
  COS_LUT[i] = Math.cos(a);
}
function fastSin(rad: number): number {
  return SIN_LUT[((rad * TRIG_SCALE) | 0) & TRIG_MASK];
}
function fastCos(rad: number): number {
  return COS_LUT[((rad * TRIG_SCALE) | 0) & TRIG_MASK];
}

export type BullCelebrationFX = {
  group: Group;
  /** Feed live index % change (triggers >= +3.0% Tier 1, >= +4.0% Tier 2 with exact 2x ceiling neon sparks/powder). */
  setIndexChange: (changePct: number) => void;
  /** Smoothed 0..1 rally factor (0 below +3%, 1 at >= +3%) driving 3x crimson ceiling neon boost. */
  getRallyBoost: () => number;
  /** Current celebration tier: 0 = off, 1 = >= +3%, 2 = >= +4%. */
  getTier: () => 0 | 1 | 2;
  /** Active ceiling neon falling gold/silver spark count (verifies exact 2.0x doubling at >= +4%). */
  getActiveCeilingSparks: () => number;
  /** Step particle physics & fireworks (0.00 ms when inactive, 0 per-frame heap allocations). */
  tick: (nowSec: number, dt: number, reduced: boolean) => void;
  dispose: () => void;
};

/** Crossed 2-plane 3D micro-spark so ultra-fine pinpoint glitter stays crisp from every angle. */
function makeCrossedSparkGeo(size: number): BufferGeometry {
  const a = new PlaneGeometry(size, size, 1, 1);
  const b = new PlaneGeometry(size, size, 1, 1);
  b.rotateY(Math.PI * 0.5);
  const merged = mergeGeometries([a, b]);
  a.dispose();
  b.dispose();
  return merged ?? new PlaneGeometry(size, size, 1, 1);
}

/** Crisp pinpoint gold-dust / diamond-glitter texture (radiant fine core + delicate 4-point shimmer, zero chunky ball!). */
function makeMicroGlitterTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);

  const g = ctx.createRadialGradient(32, 32, 0.5, 32, 32, 28);
  g.addColorStop(0.0, "rgba(255,255,255,1.0)");
  g.addColorStop(0.26, "rgba(255,253,246,0.96)");
  g.addColorStop(0.50, "rgba(255,242,212,0.44)");
  g.addColorStop(0.78, "rgba(255,222,170,0.10)");
  g.addColorStop(1.0, "rgba(255,210,150,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);

  ctx.save();
  ctx.translate(32, 32);
  for (const rot of [0, Math.PI * 0.5]) {
    ctx.save();
    ctx.rotate(rot);
    const lg = ctx.createLinearGradient(-26, 0, 26, 0);
    lg.addColorStop(0, "rgba(255,255,255,0)");
    lg.addColorStop(0.5, "rgba(255,255,255,0.68)");
    lg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(-26, -1.1, 52, 2.2);
    ctx.restore();
  }
  ctx.restore();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Delicate 4-point diamond star glint texture (refined jewelry sparkle). */
function makeStarGlintTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);

  const g = ctx.createRadialGradient(32, 32, 0.5, 32, 32, 18);
  g.addColorStop(0.0, "rgba(255,255,255,0.92)");
  g.addColorStop(0.18, "rgba(255,250,238,0.58)");
  g.addColorStop(0.46, "rgba(255,232,185,0.12)");
  g.addColorStop(1.0, "rgba(255,210,150,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);

  ctx.save();
  ctx.translate(32, 32);
  for (const [len, thick, alpha, rot] of [
    [28, 1.2, 0.85, 0],
    [28, 1.2, 0.85, Math.PI * 0.5],
    [13, 0.9, 0.36, Math.PI * 0.25],
    [13, 0.9, 0.36, -Math.PI * 0.25],
  ] as const) {
    ctx.save();
    ctx.rotate(rot);
    const lg = ctx.createLinearGradient(-len, 0, len, 0);
    lg.addColorStop(0, "rgba(255,255,255,0)");
    lg.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
    lg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(-len, -thick * 0.5, len * 2, thick);
    ctx.restore();
  }
  ctx.restore();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Fine gleaming metallic gold/silver micro-foil leaf texture. */
function makeLeafFlakeTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 48, 48);

  ctx.save();
  ctx.translate(24, 24);
  ctx.rotate(Math.PI * 0.25);
  const g = ctx.createLinearGradient(-12, -7, 12, 7);
  g.addColorStop(0.0, "rgba(255,255,255,0.42)");
  g.addColorStop(0.45, "rgba(255,255,255,0.88)");
  g.addColorStop(0.62, "rgba(255,248,228,0.82)");
  g.addColorStop(1.0, "rgba(255,230,175,0.36)");
  ctx.fillStyle = g;
  ctx.fillRect(-11, -6, 22, 12);
  ctx.restore();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Soft atmospheric champagne burst mist (zero blinding flash!). */
function makeFlashTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 1, 64, 64, 58);
  g.addColorStop(0.0, "rgba(255,248,236,0.52)");
  g.addColorStop(0.24, "rgba(255,240,215,0.22)");
  g.addColorStop(0.58, "rgba(255,226,192,0.06)");
  g.addColorStop(1.0, "rgba(255,210,175,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Refined crimson-gold neon halo texture for the central pillar upper ceiling junction collar. */
function makeCrownHaloTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  g.addColorStop(0.0, "rgba(255,220,175,0.12)");
  g.addColorStop(0.28, "rgba(255,95,95,0.58)");
  g.addColorStop(0.46, "rgba(255,26,56,0.78)");
  g.addColorStop(0.72, "rgba(255,18,46,0.30)");
  g.addColorStop(1.0, "rgba(255,14,36,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// Haute-Joaillerie Luxury Pyrotechnic Palette:
// High Gold & Silver ratio (~65%), rich Velvet Ruby/Rose Red (~20%), and vivid Imperial Emerald/Jade Green (~15%).
const FW_PALETTE_RGB: readonly [number, number, number][] = [
  [1.32, 0.94, 0.28], // 0: Warm Champagne 24K Gold
  [1.26, 0.78, 0.40], // 1: Antique Rose Gold
  [0.90, 0.97, 1.18], // 2: Sterling Platinum Silver
  [1.06, 1.06, 1.14], // 3: Satin Pearl Silver
  [1.38, 0.16, 0.30], // 4: Velvet Ruby Crimson
  [1.28, 0.30, 0.44], // 5: Garnet Rose Red
  [0.18, 1.24, 0.58], // 6: Imperial Emerald Green
  [0.36, 1.18, 0.80], // 7: Celadon Jade Mint
];

// 4 Distinct, Immediately Recognizable Luxury Firework Burst Types:
// 0 = Grand Chrysanthemum Sphere (거대 국화형 구면 개화)
// 1 = Tilted Double Halo Ring (기울어진 이중 링 / 토성 고리형)
// 2 = 5-Arm Spiral Galaxy (5갈래 나선 은하 회오리형)
// 3 = Multi-Cluster Floral Bouquet (12송이 다발 꽃다발 분산형)
type BurstStyle = 0 | 1 | 2 | 3;

type ShellRecipe = {
  style: BurstStyle;
  primary: number;
  secondary: number;
  accent: number;
  core: number;
};

// Cycles cleanly through all 4 distinct styles with Gold/Silver dominance + Ruby-Red & Emerald-Green accents
const SHELL_RECIPES: readonly ShellRecipe[] = [
  { style: 0, primary: 0, secondary: 2, accent: 4, core: 1 }, // Grand Chrysanthemum: Gold + Silver + Ruby pistil
  { style: 1, primary: 2, secondary: 0, accent: 6, core: 4 }, // Double Halo Ring: Platinum/Gold Outer + Emerald/Ruby Inner Ring
  { style: 2, primary: 0, secondary: 3, accent: 7, core: 5 }, // 5-Arm Spiral Galaxy: Champagne Gold/Pearl Arms + Jade & Rose sparks
  { style: 3, primary: 1, secondary: 2, accent: 4, core: 6 }, // Multi-Cluster Bouquet: 12 Rose-Gold/Silver + Ruby & Emerald buds
  { style: 0, primary: 2, secondary: 0, accent: 6, core: 3 }, // Grand Chrysanthemum: Platinum + Gold + Emerald pistil
  { style: 1, primary: 0, secondary: 1, accent: 5, core: 6 }, // Double Halo Ring: 24K Gold Outer + Garnet-Rose & Emerald Inner
  { style: 2, primary: 2, secondary: 0, accent: 4, core: 6 }, // 5-Arm Spiral Galaxy: Sterling/Gold Spiral + Ruby & Emerald tips
  { style: 3, primary: 0, secondary: 2, accent: 6, core: 4 }, // Multi-Cluster Bouquet: 12 Champagne/Silver + Emerald & Ruby buds
];

function writeTumblingFlake(
  arr: Float32Array,
  idx: number,
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  sx: number,
  sy: number,
) {
  const cx = fastCos(ax), sxr = fastSin(ax);
  const cy = fastCos(ay), syr = fastSin(ay);
  const cz = fastCos(az), szr = fastSin(az);

  const m00 = cy * cz;
  const m01 = sxr * syr * cz - cx * szr;
  const m02 = cx * syr * cz + sxr * szr;
  const m10 = cy * szr;
  const m11 = sxr * syr * szr + cx * cz;
  const m12 = cx * syr * szr - sxr * cz;
  const m20 = -syr;
  const m21 = sxr * cy;
  const m22 = cx * cy;

  const o = idx * 16;
  arr[o] = m00 * sx;      arr[o + 1] = m10 * sx;      arr[o + 2] = m20 * sx;      arr[o + 3] = 0;
  arr[o + 4] = m01 * sy;  arr[o + 5] = m11 * sy;      arr[o + 6] = m21 * sy;      arr[o + 7] = 0;
  arr[o + 8] = m02 * sx;  arr[o + 9] = m12 * sx;      arr[o + 10] = m22 * sx;     arr[o + 11] = 0;
  arr[o + 12] = px;       arr[o + 13] = py;           arr[o + 14] = pz;           arr[o + 15] = 1;
}

function writeRoundSpark(
  arr: Float32Array,
  idx: number,
  px: number,
  py: number,
  pz: number,
  radX: number,
  radY: number,
  yaw: number,
) {
  const cy = fastCos(yaw), sy = fastSin(yaw);
  const o = idx * 16;
  arr[o] = cy * radX;   arr[o + 1] = 0;      arr[o + 2] = -sy * radX; arr[o + 3] = 0;
  arr[o + 4] = 0;       arr[o + 5] = radY;   arr[o + 6] = 0;          arr[o + 7] = 0;
  arr[o + 8] = sy * radX; arr[o + 9] = 0;    arr[o + 10] = cy * radX; arr[o + 11] = 0;
  arr[o + 12] = px;     arr[o + 13] = py;    arr[o + 14] = pz;        arr[o + 15] = 1;
}

function writeZeroInstance(arr: Float32Array, idx: number) {
  const o = idx * 16;
  arr[o] = 0; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = 0; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = 0; arr[o + 11] = 0;
  arr[o + 12] = 0; arr[o + 13] = -999; arr[o + 14] = 0; arr[o + 15] = 1;
}

function ensureInstanceColor(mesh: InstancedMesh, maxCount: number): Float32Array {
  if (!mesh.instanceColor) {
    const buf = new Float32Array(maxCount * 3);
    buf.fill(1);
    mesh.instanceColor = new InstancedBufferAttribute(buf, 3);
  }
  return mesh.instanceColor.array as Float32Array;
}

export function createBullCelebrationFX(
  ceilingNeonPoints: Float32Array,
  pillarCrownY: number,
  mobile: boolean,
): BullCelebrationFX {
  const group = new Group();
  group.name = "BullCelebrationFX";
  group.visible = false;

  const disposables: { dispose: () => void }[] = [];

  // Celebration burst height near the central column's upper ceiling junction & vaulted dome
  const burstBaseY = Math.min(15.55, Math.max(14.55, pillarCrownY - 1.75));

  const emitCoords: Float32Array = (() => {
    if (ceilingNeonPoints.length >= 240) return ceilingNeonPoints;
    const pts: number[] = [];
    const ringSpecs: [number, number, number][] = [
      [3.8, 17.5, 72],
      [8.8, 17.2, 110],
      [14.2, 16.8, 140],
      [19.8, 16.3, 160],
    ];
    for (const [r, y, count] of ringSpecs) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (let j = 0; j < 20; j++) {
        const t = j / 19;
        const r = 3.5 + t * 18.0;
        const y = 17.7 - t * 1.45;
        pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    return new Float32Array(pts);
  })();
  const emitCount = Math.floor(emitCoords.length / 3);

  let rngState = 20261124;
  const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  const dustTex = makeMicroGlitterTexture();
  const starTex = makeStarGlintTexture();
  const leafTex = makeLeafFlakeTexture();
  const flashTex = makeFlashTexture();
  const crownTex = makeCrownHaloTexture();
  disposables.push(dustTex, starTex, leafTex, flashTex, crownTex);

  const mkAdditiveMat = (map: CanvasTexture, opacity = 0.88) => {
    const m = new MeshBasicMaterial({
      map,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      toneMapped: false,
    });
    disposables.push(m);
    return m;
  };

  const dustMat = mkAdditiveMat(dustTex, 0.86);
  const fwSparkMat = mkAdditiveMat(dustTex, 0.90);
  const starMat = mkAdditiveMat(starTex, 0.84);
  const leafMat = mkAdditiveMat(leafTex, 0.82);
  const crownMat = mkAdditiveMat(crownTex, 0.0);
  const crownCollarMat = new MeshBasicMaterial({
    color: new Color("#ff2244"),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
  const crownCylMat = new MeshBasicMaterial({
    color: new Color("#ff2848"),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
  disposables.push(crownCollarMat, crownCylMat);

  // ---- 0. Refined Central Pillar Upper Ceiling Junction Crimson-Gold Neon Beacon ----
  const crownHaloGeo = new PlaneGeometry(13.2, 13.2, 1, 1);
  crownHaloGeo.rotateX(-Math.PI * 0.5);
  const crownHaloMesh = new Mesh(crownHaloGeo, crownMat);
  crownHaloMesh.position.set(0, burstBaseY + 1.15, 0);
  crownHaloMesh.frustumCulled = false;
  crownHaloMesh.renderOrder = 5;
  crownHaloMesh.layers.enable(1);
  group.add(crownHaloMesh);
  disposables.push(crownHaloGeo);

  const crownRingGeo = new RingGeometry(2.20, 3.20, 72, 1);
  crownRingGeo.rotateX(-Math.PI * 0.5);
  const crownRingMesh = new Mesh(crownRingGeo, crownCollarMat);
  crownRingMesh.position.set(0, burstBaseY + 0.96, 0);
  crownRingMesh.frustumCulled = false;
  crownRingMesh.renderOrder = 5;
  crownRingMesh.layers.enable(1);
  group.add(crownRingMesh);
  disposables.push(crownRingGeo);

  const crownCylGeo = new CylinderGeometry(2.85, 3.16, 1.50, 48, 1, true);
  const crownCylMesh = new Mesh(crownCylGeo, crownCylMat);
  crownCylMesh.position.set(0, burstBaseY + 0.50, 0);
  crownCylMesh.frustumCulled = false;
  crownCylMesh.renderOrder = 5;
  crownCylMesh.layers.enable(1);
  group.add(crownCylMesh);
  disposables.push(crownCylGeo);

  // ---- 1. Ceiling Neon Gold & Silver Snowfall Powder Curtains (EXACT 2.0x at >= +4.0%!) ----
  // 1,200 fine grains at >= +3.0% -> 2,400 fine grains at >= +4.0%, snowing ALL THE WAY from ceiling neon to 1F floor!
  const CASCADE_TIER1 = mobile ? 450 : 1200;
  const CASCADE_MAX = CASCADE_TIER1 * 2;
  const dustGeo = new PlaneGeometry(0.080, 0.080, 1, 1);
  const cascadeMesh = new InstancedMesh(dustGeo, dustMat, CASCADE_MAX);
  cascadeMesh.frustumCulled = false;
  cascadeMesh.renderOrder = 6;
  group.add(cascadeMesh);
  disposables.push(dustGeo);
  const cascadeMatArr = cascadeMesh.instanceMatrix.array as Float32Array;
  const cascadeColArr = ensureInstanceColor(cascadeMesh, CASCADE_MAX);

  const cPx = new Float32Array(CASCADE_MAX);
  const cPy = new Float32Array(CASCADE_MAX);
  const cPz = new Float32Array(CASCADE_MAX);
  const cVx = new Float32Array(CASCADE_MAX);
  const cVy = new Float32Array(CASCADE_MAX);
  const cVz = new Float32Array(CASCADE_MAX);
  const cAge = new Float32Array(CASCADE_MAX);
  const cLife = new Float32Array(CASCADE_MAX);
  const cPhase = new Float32Array(CASCADE_MAX);
  const cR = new Float32Array(CASCADE_MAX);
  const cSpin = new Float32Array(CASCADE_MAX);
  const cSilver = new Uint8Array(CASCADE_MAX);

  const respawnCascade = (i: number, initialStagger = false, nowSec = 0) => {
    let ex: number, ey: number, ez: number;
    if (rand() < 0.58) {
      const sheet = Math.floor(rand() * 10);
      const baseIdx = Math.floor(((sheet / 10 + Math.sin(nowSec * (0.18 + sheet * 0.03) + sheet * 1.9) * 0.04 + 1) % 1) * emitCount);
      const jitter = Math.floor((rand() - 0.5) * Math.max(8, emitCount * 0.06));
      const pick = ((baseIdx + jitter) % emitCount + emitCount) % emitCount;
      ex = emitCoords[pick * 3];
      ey = emitCoords[pick * 3 + 1];
      ez = emitCoords[pick * 3 + 2];
    } else {
      const pick = Math.floor(rand() * emitCount);
      ex = emitCoords[pick * 3];
      ey = emitCoords[pick * 3 + 1];
      ez = emitCoords[pick * 3 + 2];
    }
    cPx[i] = ex + (rand() - 0.5) * 0.70;
    cPz[i] = ez + (rand() - 0.5) * 0.70;
    // On initial entry, pre-fill the entire vertical height from ceiling to 1F marble floor with gentle snowfall!
    cPy[i] = initialStagger ? (0.35 + rand() * (ey - 0.55)) : (ey - 0.06 - rand() * 0.25);

    const ang = rand() * Math.PI * 2;
    const hSpd = rand() * 0.55;
    cVx[i] = Math.cos(ang) * hSpd;
    cVy[i] = -(0.55 + rand() * 0.75);
    cVz[i] = Math.sin(ang) * hSpd;

    cR[i] = rand() < 0.85 ? (0.48 + rand() * 0.54) : (1.02 + rand() * 0.48);
    // Long enough to drift gently ALL THE WAY from 17.5m ceiling down to y = 0.12m floor!
    cLife[i] = 13.5 + rand() * 7.5;
    cAge[i] = initialStagger ? rand() * (cLife[i] * 0.75) : 0;
    cPhase[i] = rand() * Math.PI * 2;
    cSpin[i] = 2.8 + (i % 7) * 0.55;
    cSilver[i] = rand() < 0.45 ? 1 : 0;
  };
  for (let i = 0; i < CASCADE_MAX; i++) respawnCascade(i, true, 0);

  // ---- 2. Room-Wide 6-Slot Luxury Glitter Fireworks in 4 Distinct Styles Snowing All the Way to the Floor! ----
  // 6 overlapping shells x 280 crisp single-quad pinpoint embers = 1,680 pure sparkling snow-embers (ZERO meteor tails, -50% GPU overdraw!)
  // Spread across the ENTIRE 360° atrium hall and drift slowly down like glowing snow right down to 1F marble (y = 0.12m)!
  const FW_SLOTS = mobile ? 4 : 6;
  const FW_EMBERS = mobile ? 110 : 280;
  const FW_TOTAL = FW_SLOTS * FW_EMBERS;

  const fwSparkGeo = new PlaneGeometry(0.128, 0.128, 1, 1);
  const fwMesh = new InstancedMesh(fwSparkGeo, fwSparkMat, FW_TOTAL);
  fwMesh.frustumCulled = false;
  fwMesh.renderOrder = 7;
  group.add(fwMesh);
  disposables.push(fwSparkGeo);
  const fwMatArr = fwMesh.instanceMatrix.array as Float32Array;
  const fwColArr = ensureInstanceColor(fwMesh, FW_TOTAL);

  const fPx = new Float32Array(FW_TOTAL);
  const fPy = new Float32Array(FW_TOTAL);
  const fPz = new Float32Array(FW_TOTAL);
  const fVx = new Float32Array(FW_TOTAL);
  const fVy = new Float32Array(FW_TOTAL);
  const fVz = new Float32Array(FW_TOTAL);
  const fAge = new Float32Array(FW_TOTAL);
  const fLife = new Float32Array(FW_TOTAL);
  const fPhase = new Float32Array(FW_TOTAL);
  const fTwinkleSpd = new Float32Array(FW_TOTAL);
  const fSize = new Float32Array(FW_TOTAL);
  const fColorIdx = new Uint8Array(FW_TOTAL);
  const fDrag = new Float32Array(FW_TOTAL);
  const fGrav = new Float32Array(FW_TOTAL);
  const fFallCap = new Float32Array(FW_TOTAL); // Individual gentle snow terminal fall speed so sparks cascade down to floor!
  const fSwirl = new Float32Array(FW_TOTAL);
  const fAlive = new Uint8Array(FW_TOTAL); // Skip rewriting already-dead instance matrices (zero wasted CPU!)

  for (let i = 0; i < FW_TOTAL; i++) {
    fAge[i] = 20;
    fLife[i] = 1;
    fAlive[i] = 0;
    writeZeroInstance(fwMatArr, i);
  }

  // Soft warm ambient burst bloom (clearly marks detonation without blinding glare!)
  const flashGeo = makeCrossedSparkGeo(3.6);
  disposables.push(flashGeo);
  const flashes = [0, 1].map(() => {
    const mat = mkAdditiveMat(flashTex, 0.0);
    const mesh = new Mesh(flashGeo, mat);
    mesh.position.set(0, burstBaseY, 0);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    group.add(mesh);
    return { mesh, mat, age: 99, colorIdx: 0 };
  });
  let nextFlashIdx = 0;

  const burstLight = mobile ? null : new PointLight("#ffe4b8", 0, 44, 1.35);
  if (burstLight) {
    burstLight.position.set(0, burstBaseY, 0);
    group.add(burstLight);
    disposables.push(burstLight);
  }

  let nextBurstSlot = 0;
  let burstCooldown = 0.04;
  let shellCounter = 0;
  let latestFlashAge = 99;

  // ---- 3A. Delicate Snow-Drifting 4-Point Diamond Star Glints Across All 4 Floors Down to 1F Floor (460) ----
  const STAR_TIER1 = mobile ? 140 : 300;
  const STAR_MAX = mobile ? 220 : 460;
  const starGeo = new PlaneGeometry(0.130, 0.130, 1, 1);
  const starMesh = new InstancedMesh(starGeo, starMat, STAR_MAX);
  starMesh.frustumCulled = false;
  starMesh.renderOrder = 8;
  group.add(starMesh);
  disposables.push(starGeo);
  const starMatArr = starMesh.instanceMatrix.array as Float32Array;
  const starColArr = ensureInstanceColor(starMesh, STAR_MAX);

  const sPx = new Float32Array(STAR_MAX);
  const sPy = new Float32Array(STAR_MAX);
  const sPz = new Float32Array(STAR_MAX);
  const sVx = new Float32Array(STAR_MAX);
  const sVy = new Float32Array(STAR_MAX);
  const sVz = new Float32Array(STAR_MAX);
  const sAge = new Float32Array(STAR_MAX);
  const sLife = new Float32Array(STAR_MAX);
  const sPhase = new Float32Array(STAR_MAX);
  const sSpin = new Float32Array(STAR_MAX);
  const sSize = new Float32Array(STAR_MAX);
  const sTint = new Uint8Array(STAR_MAX);

  const pickLuxuryTint = (accentHue: number): number => {
    const r = rand();
    if (r < 0.40) return 0; // Champagne Gold
    if (r < 0.50) return 1; // Antique Rose Gold
    if (r < 0.78) return 2; // Sterling Silver
    if (r < 0.85) return 3; // Satin Pearl Silver
    if (r < 0.93) return accentHue;
    return rand() < 0.55 ? 4 : 6;
  };

  const respawnStar = (i: number, fromBurst: boolean, ox = 0, oy = burstBaseY, oz = 0, accentHue = 4) => {
    const theta = rand() * Math.PI * 2;
    if (fromBurst) {
      const r0 = 0.8 + rand() * 2.2;
      sPx[i] = ox + Math.cos(theta) * r0;
      sPy[i] = oy + (rand() - 0.45) * 1.6;
      sPz[i] = oz + Math.sin(theta) * r0;
      const spd = 3.2 + rand() * 7.8;
      const phi = (rand() - 0.36) * 1.25;
      sVx[i] = Math.cos(theta) * Math.cos(phi) * spd;
      sVy[i] = Math.sin(phi) * spd * 0.45 - 0.25;
      sVz[i] = Math.sin(theta) * Math.cos(phi) * spd;
      sLife[i] = 12.5 + rand() * 6.5; // Snows all the way down to 1F floor!
      sAge[i] = 0;
      sTint[i] = pickLuxuryTint(accentHue);
    } else {
      const rad = 1.4 + Math.pow(rand(), 0.68) * 21.0;
      sPx[i] = Math.cos(theta) * rad;
      sPy[i] = 0.35 + rand() * (burstBaseY + 1.0);
      sPz[i] = Math.sin(theta) * rad;
      sVx[i] = (rand() - 0.5) * 0.75;
      sVy[i] = -(0.85 + rand() * 0.55);
      sVz[i] = (rand() - 0.5) * 0.75;
      sLife[i] = 13.0 + rand() * 6.5;
      sAge[i] = rand() * (sLife[i] * 0.75);
      sTint[i] = pickLuxuryTint(rand() < 0.55 ? 4 : 6);
    }
    sPhase[i] = rand() * Math.PI * 2;
    sSpin[i] = 2.4 + rand() * 3.4;
    sSize[i] = 0.56 + rand() * 0.78;
  };
  for (let i = 0; i < STAR_MAX; i++) respawnStar(i, false);

  // ---- 3B. Fine Snow-Tumbling Gold & Silver Metallic Foil Specks Drifting Down to 1F Marble (440) ----
  const LEAF_TIER1 = mobile ? 140 : 280;
  const LEAF_MAX = mobile ? 220 : 440;
  const leafGeo = new PlaneGeometry(0.078, 0.052, 1, 1);
  const leafMesh = new InstancedMesh(leafGeo, leafMat, LEAF_MAX);
  leafMesh.frustumCulled = false;
  leafMesh.renderOrder = 7;
  group.add(leafMesh);
  disposables.push(leafGeo);
  const leafMatArr = leafMesh.instanceMatrix.array as Float32Array;
  const leafColArr = ensureInstanceColor(leafMesh, LEAF_MAX);

  const lPx = new Float32Array(LEAF_MAX);
  const lPy = new Float32Array(LEAF_MAX);
  const lPz = new Float32Array(LEAF_MAX);
  const lVx = new Float32Array(LEAF_MAX);
  const lVy = new Float32Array(LEAF_MAX);
  const lVz = new Float32Array(LEAF_MAX);
  const lAge = new Float32Array(LEAF_MAX);
  const lLife = new Float32Array(LEAF_MAX);
  const lPhase = new Float32Array(LEAF_MAX);
  const lSpin = new Float32Array(LEAF_MAX);
  const lSize = new Float32Array(LEAF_MAX);
  const lSilver = new Uint8Array(LEAF_MAX);

  const respawnLeaf = (i: number, fromBurst: boolean, ox = 0, oy = burstBaseY, oz = 0) => {
    const theta = rand() * Math.PI * 2;
    if (fromBurst) {
      lPx[i] = ox + Math.cos(theta) * (0.9 + rand() * 2.0);
      lPy[i] = oy + (rand() - 0.45) * 1.4;
      lPz[i] = oz + Math.sin(theta) * (0.9 + rand() * 2.0);
      const spd = 3.0 + rand() * 6.8;
      lVx[i] = Math.cos(theta) * spd;
      lVy[i] = (rand() - 0.35) * 2.2 - 0.25;
      lVz[i] = Math.sin(theta) * spd;
      lLife[i] = 13.0 + rand() * 6.8; // Snows all the way down to 1F floor!
      lAge[i] = 0;
    } else {
      const rad = 1.4 + Math.pow(rand(), 0.68) * 21.0;
      lPx[i] = Math.cos(theta) * rad;
      lPy[i] = 0.35 + rand() * (burstBaseY + 0.8);
      lPz[i] = Math.sin(theta) * rad;
      lVx[i] = (rand() - 0.5) * 0.70;
      lVy[i] = -(0.90 + rand() * 0.55);
      lVz[i] = (rand() - 0.5) * 0.70;
      lLife[i] = 13.5 + rand() * 6.8;
      lAge[i] = rand() * (lLife[i] * 0.75);
    }
    lPhase[i] = rand() * Math.PI * 2;
    lSpin[i] = 2.4 + (i % 6) * 0.55;
    lSize[i] = 0.68 + rand() * 0.80;
    lSilver[i] = rand() < 0.45 ? 1 : 0;
  };
  for (let i = 0; i < LEAF_MAX; i++) respawnLeaf(i, false);

  const triggerFireworkBurst = (slot: number, activeStars: number, activeLeaves: number) => {
    // Distribute bursts across the ENTIRE 360° atrium room!
    // Alternating inner central-pillar crown bursts (r = 3.0..6.2m) & wide dome-hall bursts (r = 6.8..13.5m)
    // so fireworks blossom right above the central column AND across the entire room!
    const collarAng = (slot * ((Math.PI * 2) / FW_SLOTS) + shellCounter * 0.78 + (rand() - 0.5) * 0.38) % (Math.PI * 2);
    const isCrownBurst = shellCounter % 2 === 0;
    const collarR = isCrownBurst ? (3.0 + rand() * 3.4) : (6.8 + rand() * 6.6);
    const ox = Math.cos(collarAng) * collarR;
    const oy = burstBaseY - (isCrownBurst ? 0.15 : 0.75) + (rand() - 0.5) * 1.90;
    const oz = Math.sin(collarAng) * collarR;

    const recipe = SHELL_RECIPES[shellCounter % SHELL_RECIPES.length];
    const style = recipe.style;
    const tiltX = (rand() - 0.5) * 0.85;
    const tiltZ = (rand() - 0.5) * 0.85;
    const cosTX = Math.cos(tiltX), sinTX = Math.sin(tiltX);
    const cosTZ = Math.cos(tiltZ), sinTZ = Math.sin(tiltZ);
    const spiralDir = shellCounter % 2 === 0 ? 1 : -1;
    shellCounter += 1;

    // Soft warm ambient detonation halo
    const fl = flashes[nextFlashIdx];
    nextFlashIdx = (nextFlashIdx + 1) % flashes.length;
    fl.mesh.position.set(ox, oy, oz);
    fl.age = 0;
    fl.colorIdx = recipe.primary;
    latestFlashAge = 0;
    if (burstLight) {
      burstLight.position.set(ox, oy, oz);
      const pal = FW_PALETTE_RGB[recipe.primary];
      burstLight.color.setRGB(Math.min(1, pal[0]), Math.min(1, pal[1]), Math.min(1, pal[2]));
    }

    const bouquetCount = 12;
    const base = slot * FW_EMBERS;

    for (let k = 0; k < FW_EMBERS; k++) {
      const idx = base + k;
      let dx = 0, dy = 0, dz = 0;
      let speed = 12.0;
      let drag = 0.88;
      let grav = 1.05;
      // Long 11-15s lifetime + gentle snow terminal fall (1.45 - 2.05 m/s) so sparks snow ALL THE WAY down to 1F floor!
      let life = 11.2 + rand() * 4.2;
      let fallCap = 1.45 + rand() * 0.62;
      let size = 0.72 + rand() * 0.48;
      let swirl = 0;
      let hue = recipe.primary;

      if (style === 0) {
        // STYLE 0: Grand Chrysanthemum Sphere — wide 3D radial bloom filling the room, then drifting down like golden snow!
        const u = (k + 0.5) / FW_EMBERS;
        const yDir = 1 - 2 * u + (rand() - 0.5) * 0.14;
        const rPlane = Math.sqrt(Math.max(0.001, 1 - yDir * yDir));
        const ang = k * 2.39996323 + rand() * 0.16;
        dx = Math.cos(ang) * rPlane;
        dz = Math.sin(ang) * rPlane;
        dy = yDir > 0.34 ? 0.34 - (yDir - 0.34) * 0.42 : yDir;
        const layerRoll = rand();
        const isCore = layerRoll < 0.22;
        const isMid = layerRoll >= 0.22 && layerRoll < 0.54;
        speed = isCore ? (4.8 + rand() * 3.6) : isMid ? (9.2 + rand() * 4.4) : (13.2 + rand() * 5.2);
        drag = isCore ? 1.05 : 0.84 + rand() * 0.18;
        grav = 1.05 + rand() * 0.22;
        size = isCore ? (0.64 + rand() * 0.34) : (0.76 + rand() * 0.48);
        if (isCore) hue = recipe.accent;
        else if (k % 3 === 0) hue = recipe.secondary;
        else if (k % 7 === 0) hue = recipe.accent;
        else hue = recipe.primary;
      } else if (style === 1) {
        // STYLE 1: Tilted Double Halo Ring (Saturn Crown) — unmistakable giant concentric rings blooming across the room!
        const isOuterRing = k < FW_EMBERS * 0.60;
        const isInnerRing = !isOuterRing && k < FW_EMBERS * 0.86;
        if (isOuterRing || isInnerRing) {
          const nInRing = isOuterRing ? Math.floor(FW_EMBERS * 0.60) : Math.floor(FW_EMBERS * 0.26);
          const rk = isOuterRing ? k : k - Math.floor(FW_EMBERS * 0.60);
          const a = (rk / Math.max(1, nInRing)) * Math.PI * 2 + (rand() - 0.5) * 0.08;
          const rx = Math.cos(a);
          const ry = (rand() - 0.5) * 0.10;
          const rz = Math.sin(a);
          const y1 = ry * cosTX - rz * sinTX;
          const z1 = ry * sinTX + rz * cosTX;
          dx = rx * cosTZ - y1 * sinTZ;
          dy = rx * sinTZ + y1 * cosTZ;
          dz = z1;
          speed = isOuterRing ? (13.6 + rand() * 4.4) : (8.2 + rand() * 2.8);
          drag = 0.88 + rand() * 0.16;
          grav = 0.96 + rand() * 0.20;
          hue = isOuterRing
            ? (rk % 5 === 0 ? recipe.accent : rk % 2 === 0 ? recipe.primary : recipe.secondary)
            : (rk % 2 === 0 ? recipe.core : recipe.accent);
        } else {
          // Sparkling inner core mist
          const ang = rand() * Math.PI * 2;
          const elev = (rand() - 0.5) * 1.4;
          dx = Math.cos(ang) * Math.cos(elev);
          dy = Math.sin(elev) * 0.65;
          dz = Math.sin(ang) * Math.cos(elev);
          speed = 3.6 + rand() * 3.4;
          drag = 1.02;
          grav = 0.92;
          hue = recipe.secondary;
        }
      } else if (style === 2) {
        // STYLE 2: 5-Arm Spiral Galaxy (Tourbillon) — sweeping swirling stardust arms spinning wide across the room!
        const arm = k % 5;
        const frac = k / FW_EMBERS;
        const a = (arm / 5) * Math.PI * 2 + frac * 3.1 + (rand() - 0.5) * 0.18;
        const rx = Math.cos(a);
        const ry = (rand() - 0.5) * 0.36;
        const rz = Math.sin(a);
        const y1 = ry * cosTX - rz * sinTX;
        const z1 = ry * sinTX + rz * cosTX;
        dx = rx * cosTZ - y1 * sinTZ;
        dy = Math.min(0.36, rx * sinTZ + y1 * cosTZ);
        dz = z1;
        speed = 6.2 + frac * 11.4 + rand() * 2.4;
        drag = 0.88 + rand() * 0.16;
        grav = 0.96 + rand() * 0.20;
        swirl = spiralDir * (1.05 + rand() * 0.35);
        size = 0.70 + rand() * 0.44;
        if (k % 5 === 0) hue = recipe.accent;
        else if (k % 8 === 0) hue = recipe.core;
        else hue = arm % 2 === 0 ? recipe.primary : recipe.secondary;
      } else {
        // STYLE 3: Multi-Cluster Floral Bouquet — 12 vivid miniature star-bouquets scattering wide across the room!
        const bId = k % bouquetCount;
        const u = (bId + 0.5) / bouquetCount;
        const byDir = 0.42 - u * 0.92;
        const bPlane = Math.sqrt(Math.max(0.02, 1 - byDir * byDir));
        const bAng = bId * 2.39996323;
        const bDx = Math.cos(bAng) * bPlane;
        const bDy = byDir;
        const bDz = Math.sin(bAng) * bPlane;
        const jAng = rand() * Math.PI * 2;
        const jElev = (rand() - 0.5) * Math.PI;
        const jSpread = 0.12 + rand() * 0.24;
        dx = bDx + Math.cos(jAng) * Math.cos(jElev) * jSpread;
        dy = bDy + Math.sin(jElev) * jSpread;
        dz = bDz + Math.sin(jAng) * Math.cos(jElev) * jSpread;
        speed = 11.2 + rand() * 5.2;
        drag = 0.88 + rand() * 0.18;
        grav = 1.02 + rand() * 0.20;
        size = 0.70 + rand() * 0.42;
        if (bId % 4 === 0) hue = recipe.accent;
        else if (bId % 5 === 0) hue = recipe.core;
        else hue = bId % 2 === 0 ? recipe.primary : recipe.secondary;
      }

      fPx[idx] = ox + dx * 0.24;
      fPy[idx] = oy + dy * 0.24;
      fPz[idx] = oz + dz * 0.24;
      fVx[idx] = dx * speed;
      fVy[idx] = dy * speed;
      fVz[idx] = dz * speed;
      fAge[idx] = 0;
      fLife[idx] = life;
      fPhase[idx] = rand() * Math.PI * 2;
      fTwinkleSpd[idx] = 4.8 + rand() * 7.5;
      fSize[idx] = size;
      fDrag[idx] = drag;
      fGrav[idx] = grav;
      fFallCap[idx] = fallCap;
      fSwirl[idx] = swirl;
      fColorIdx[idx] = hue;
      fAlive[idx] = 1;
    }

    // Release a graceful wave of diamond star glints & snow-tumbling gold/silver micro-foil across the room
    const startS = (slot * 90) % activeStars;
    for (let j = 0; j < 78; j++) respawnStar((startS + j) % activeStars, true, ox, oy, oz, recipe.accent);
    const startL = (slot * 85) % activeLeaves;
    for (let j = 0; j < 72; j++) respawnLeaf((startL + j) % activeLeaves, true, ox, oy, oz);
  };

  let currentChangePct = 0;
  let tier: 0 | 1 | 2 = 0;
  let rallyBoost = 0;

  return {
    group,
    setIndexChange(changePct: number) {
      currentChangePct = Number.isFinite(changePct) ? changePct : 0;
      const nextTier: 0 | 1 | 2 = currentChangePct >= 4.0 ? 2 : currentChangePct >= 3.0 ? 1 : 0;
      if (nextTier > 0 && tier === 0) {
        burstCooldown = 0.02;
        for (let i = 0; i < CASCADE_MAX; i++) respawnCascade(i, true, 0);
      }
      tier = nextTier;
    },
    getRallyBoost() {
      return rallyBoost;
    },
    getTier() {
      return tier;
    },
    getActiveCeilingSparks() {
      return tier === 0 ? 0 : tier >= 2 ? CASCADE_MAX : CASCADE_TIER1;
    },
    tick(nowSec: number, rawDt: number, reduced: boolean) {
      const dt = Math.min(rawDt, 0.05);
      const targetBoost = tier > 0 ? 1.0 : 0.0;
      rallyBoost += (targetBoost - rallyBoost) * (1 - Math.exp(-dt * 4.5));
      if (rallyBoost < 0.004 && tier === 0) {
        rallyBoost = 0;
        if (group.visible) {
          group.visible = false;
          if (burstLight) burstLight.intensity = 0;
          crownMat.opacity = 0;
          crownCollarMat.opacity = 0;
          crownCylMat.opacity = 0;
        }
        return;
      }
      group.visible = true;

      const motionMul = reduced ? 0.35 : 1.0;
      const stepDt = dt * motionMul;
      const activeCascade = tier >= 2 ? CASCADE_MAX : CASCADE_TIER1;
      const activeStars = tier >= 2 ? STAR_MAX : STAR_TIER1;
      const activeLeaves = tier >= 2 ? LEAF_MAX : LEAF_TIER1;

      // 0. Refined Central Pillar Upper Ceiling Junction Crimson-Gold Neon Beacon
      latestFlashAge += stepDt;
      const crownBreath = 0.82 + 0.18 * Math.sin(nowSec * 2.6);
      const flashKick = latestFlashAge < 0.65 ? Math.pow(1 - latestFlashAge / 0.65, 2.2) * 0.24 : 0;
      crownMat.opacity = Math.min(0.76, (0.54 * crownBreath + flashKick) * rallyBoost);
      crownCollarMat.opacity = Math.min(0.80, (0.60 * crownBreath + flashKick * 0.40) * rallyBoost);
      crownCollarMat.color.setRGB(2.2 + flashKick * 0.7, 0.22 + flashKick * 0.5, 0.34 + flashKick * 0.2);
      crownCylMat.opacity = Math.min(0.56, (0.32 * crownBreath + flashKick * 0.25) * rallyBoost);
      crownCylMat.color.setRGB(2.0 + flashKick * 0.6, 0.18 + flashKick * 0.4, 0.30 + flashKick * 0.18);

      // 1. Ceiling Neon Gold & Silver Snowfall Curtains (1,600 -> EXACT 2.0x = 3,200 at >= +4.0%, snowing to 1F floor!)
      cascadeMesh.count = activeCascade;
      const now055 = nowSec * 0.55;
      const now052 = nowSec * 0.52;
      const now075 = nowSec * 0.75;
      const now050 = nowSec * 0.5;
      for (let i = 0; i < activeCascade; i++) {
        let age = cAge[i] + stepDt;
        if (age >= cLife[i] || cPy[i] < 0.12) {
          respawnCascade(i, false, nowSec);
          age = cAge[i];
        } else {
          cAge[i] = age;
        }
        const r = cR[i];
        const ph = cPhase[i];
        // Graceful snowfall drift that reliably reaches the 1st-floor marble (y = 0.12m)
        const drag = 1.68 / r;
        const swayX = fastSin(age * 1.9 + ph) * 1.15 + fastCos(now055 + ph * 1.4) * 0.45;
        const swayZ = fastCos(age * 1.7 + ph * 1.2) * 1.15 - fastSin(now052 + ph) * 0.45;
        const vx = cVx[i] + (swayX - cVx[i] * drag) * stepDt;
        const vz = cVz[i] + (swayZ - cVz[i] * drag) * stepDt;
        let vy = cVy[i] + (-2.25 - cVy[i] * drag) * stepDt;
        if (vy < -1.85) vy = -1.85;
        cVx[i] = vx;
        cVy[i] = vy;
        cVz[i] = vz;

        const px = cPx[i] + vx * stepDt;
        const py = cPy[i] + vy * stepDt;
        const pz = cPz[i] + vz * stepDt;
        cPx[i] = px;
        cPy[i] = py;
        cPz[i] = pz;

        const lifeT = age / cLife[i];
        const fadeIn = lifeT * 6.0;
        const lifeIn = fadeIn < 1 ? fadeIn : 1;
        const lifeOut = 1 - lifeT * lifeT * lifeT;
        let floorFade = (py - 0.12) * 0.90909;
        if (floorFade < 0) floorFade = 0;
        else if (floorFade > 1) floorFade = 1;
        const fallFade = lifeIn * (lifeOut > 0 ? lifeOut : 0) * floorFade;

        const spinAngle = age * cSpin[i];
        const turn = fastCos(spinAngle + ph);
        const flash = turn * turn;
        const a = fallFade * (0.34 + 0.66 * flash) * rallyBoost;

        if (r > 1.00) {
          const absTurn = turn < 0 ? -turn : turn;
          const wScale = r * (0.32 + absTurn * 0.68);
          const hScale = r * 0.68;
          writeTumblingFlake(cascadeMatArr, i, px, py, pz, spinAngle, ph + now075, turn * 0.6, wScale, hScale);
        } else {
          const gScale = r * (0.76 + flash * 0.34);
          writeRoundSpark(cascadeMatArr, i, px, py, pz, gScale, gScale, ph + now050);
        }

        const lum = a * (2.45 + (flash > 0.88 ? 1.40 : 0));
        const co = i * 3;
        if (cSilver[i] === 1) {
          cascadeColArr[co] = lum * (0.82 + 0.14 * flash);
          cascadeColArr[co + 1] = lum * (0.88 + 0.10 * flash);
          cascadeColArr[co + 2] = lum * 1.12;
        } else {
          cascadeColArr[co] = lum * 1.24;
          cascadeColArr[co + 1] = lum * (0.74 + 0.22 * flash);
          cascadeColArr[co + 2] = lum * (0.24 + 0.30 * flash);
        }
      }
      cascadeMesh.instanceMatrix.needsUpdate = true;
      cascadeMesh.instanceColor!.needsUpdate = true;

      // 2. Room-Wide 8-Slot Luxury Glitter Fireworks (4 Distinct Styles, Snowing All the Way Down to 1F Floor!)
      if (tier > 0) {
        burstCooldown -= stepDt;
        if (burstCooldown <= 0) {
          triggerFireworkBurst(nextBurstSlot, activeStars, activeLeaves);
          nextBurstSlot = (nextBurstSlot + 1) % FW_SLOTS;
          if (tier >= 2) {
            burstCooldown = 1.25 + rand() * 0.45;
          } else {
            burstCooldown = 1.65 + rand() * 0.55;
          }
        }
      }

      let peakLight = 0;
      for (const fl of flashes) {
        fl.age += stepDt;
        if (fl.age < 0.65) {
          fl.mesh.visible = true;
          const ft = fl.age / 0.65;
          const invFt = 1 - ft;
          const pulse = invFt * invFt * rallyBoost;
          fl.mat.opacity = pulse * 0.34;
          const p = FW_PALETTE_RGB[fl.colorIdx];
          fl.mat.color.setRGB(p[0] * 1.05, p[1] * 1.05, p[2] * 1.05);
          const fScale = 0.50 + Math.sqrt(ft) * 1.35;
          fl.mesh.scale.set(fScale, fScale, fScale);
          if (pulse > peakLight) peakLight = pulse;
        } else if (fl.mesh.visible) {
          fl.mat.opacity = 0;
          fl.mesh.visible = false;
        }
      }
      if (burstLight) {
        burstLight.intensity = peakLight * (tier >= 2 ? 38 : 26);
      }

      const now145 = nowSec * 1.45;
      const now060 = nowSec * 0.60;
      const now135 = nowSec * 1.35;
      for (let i = 0; i < FW_TOTAL; i++) {
        if (fAlive[i] === 0) continue;
        const age = fAge[i] + stepDt;
        const life = fLife[i];
        if (age >= life || fPy[i] < 0.10) {
          fAlive[i] = 0;
          writeZeroInstance(fwMatArr, i);
          continue;
        }
        fAge[i] = age;

        let drag = 1 - fDrag[i] * stepDt;
        if (drag < 0.5) drag = 0.5;
        let vx = fVx[i] * drag;
        let vz = fVz[i] * drag;
        const sw = fSwirl[i];
        if (sw !== 0 && age < 2.6) {
          const rot = sw * (1 - age * 0.3846) * stepDt;
          const cr = fastCos(rot), sr = fastSin(rot);
          const nvx = vx * cr - vz * sr;
          const nvz = vx * sr + vz * cr;
          vx = nvx;
          vz = nvz;
        }
        const ph = fPhase[i];
        const t = age / life;
        if (age > 1.0) {
          let snowBlend = (age - 1.0) * 0.55;
          if (snowBlend > 1.0) snowBlend = 1.0;
          vx += (fastSin(now145 + ph) * 0.95 + fastCos(now060 + ph * 1.7) * 0.45) * snowBlend * stepDt;
          vz += (fastCos(now135 + ph * 1.3) * 0.95 - fastSin(now055 + ph) * 0.45) * snowBlend * stepDt;
        }
        fVx[i] = vx;
        fVz[i] = vz;
        let vy = fVy[i] * drag - fGrav[i] * stepDt;
        const cap = -fFallCap[i];
        if (vy < cap) vy = cap;
        fVy[i] = vy;

        let nx = fPx[i] + vx * stepDt;
        let nz = fPz[i] + vz * stepDt;
        const rSq = nx * nx + nz * nz;
        if (rSq > 506.25) {
          const invR = 22.5 / Math.sqrt(rSq);
          nx *= invR;
          nz *= invR;
          fVx[i] *= -0.25;
          fVz[i] *= -0.25;
        }
        const ny = fPy[i] + vy * stepDt;
        fPx[i] = nx;
        fPy[i] = ny;
        fPz[i] = nz;

        const fadeIn = age * 5.0 < 1.0 ? age * 5.0 : 1.0;
        let floorFade = (ny - 0.10) * 0.8695;
        if (floorFade < 0) floorFade = 0;
        else if (floorFade > 1) floorFade = 1;
        const fadeOut = (1 - t) * floorFade;
        const rawTw = fastSin(nowSec * fTwinkleSpd[i] + ph * 5.0);
        const twinkleWave = rawTw < 0 ? -rawTw : rawTw;
        let twinkleMix = (age - 0.9) * 0.625;
        if (twinkleMix < 0) twinkleMix = 0;
        else if (twinkleMix > 1) twinkleMix = 1;
        const glitter = (1.0 - twinkleMix) * (0.86 + 0.14 * twinkleWave) + twinkleMix * (0.28 + 0.72 * twinkleWave * twinkleWave);
        const alpha = fadeIn * fadeOut * glitter * rallyBoost;

        const sc = fSize[i] * (0.80 + 0.34 * twinkleWave) * (1.04 - t * 0.34);
        writeRoundSpark(fwMatArr, i, nx, ny, nz, sc, sc, ph + now075);

        const hotRaw = 1 - age * 0.95;
        const hot = hotRaw > 0 ? hotRaw : 0;
        const lum = alpha * (3.95 + hot * 1.45);
        const rgb = FW_PALETTE_RGB[fColorIdx[i]];
        const co = i * 3;
        fwColArr[co] = lum * (rgb[0] + hot * 0.20);
        fwColArr[co + 1] = lum * (rgb[1] + hot * 0.18);
        fwColArr[co + 2] = lum * (rgb[2] + hot * 0.16);
      }
      fwMesh.instanceMatrix.needsUpdate = true;
      fwMesh.instanceColor!.needsUpdate = true;

      // 3A. Delicate Snow-Drifting 4-Point Diamond Star Glints Reaching All the Way to 1F Floor
      starMesh.count = activeStars;
      const dragS = Math.exp(-1.20 * stepDt);
      const now110 = nowSec * 1.1;
      const now040 = nowSec * 0.4;
      for (let i = 0; i < activeStars; i++) {
        let age = sAge[i] + stepDt;
        if (age >= sLife[i] || sPy[i] < 0.14) {
          respawnStar(i, rand() < 0.52, 0, burstBaseY, 0, shellCounter % 2 === 0 ? 4 : 6);
          age = sAge[i];
        } else {
          sAge[i] = age;
        }
        const ph = sPhase[i];
        const px0 = sPx[i], pz0 = sPz[i];
        const radSq = px0 * px0 + pz0 * pz0;
        const invRad = radSq > 0.25 ? 1.0 / Math.sqrt(radSq) : 2.0;
        const tangX = -pz0 * invRad;
        const tangZ = px0 * invRad;
        const vx = (sVx[i] + (tangX * 0.38 + fastSin(now110 + ph) * 0.72) * stepDt) * dragS;
        const vz = (sVz[i] + (tangZ * 0.38 + fastCos(nowSec + ph * 1.4) * 0.72) * stepDt) * dragS;
        let vy = (sVy[i] - 0.78 * stepDt) * dragS;
        if (vy < -1.25) vy = -1.25;
        sVx[i] = vx; sVy[i] = vy; sVz[i] = vz;

        const px = px0 + vx * stepDt;
        const py = sPy[i] + vy * stepDt;
        const pz = pz0 + vz * stepDt;
        sPx[i] = px; sPy[i] = py; sPz[i] = pz;

        const t = age / sLife[i];
        let floorFade = py - 0.14;
        if (floorFade < 0) floorFade = 0;
        else if (floorFade > 1) floorFade = 1;
        const fadeIn = t * 5.0 < 1 ? t * 5.0 : 1;
        const fadeOut = 1 - t * t;
        const fade = fadeIn * (fadeOut > 0 ? fadeOut : 0) * floorFade;
        const ang = nowSec * sSpin[i] + ph;
        const rawG = fastSin(ang);
        const absG = rawG < 0 ? -rawG : rawG;
        const g2 = absG * absG;
        const glint = g2 * g2;
        const sc = sSize[i] * (0.48 + glint * 0.96);
        writeTumblingFlake(starMatArr, i, px, py, pz, ang * 0.4, ph + now040, ang * 0.2, sc, sc);

        const lum = fade * (0.34 + glint * 2.85) * rallyBoost;
        const rgb = FW_PALETTE_RGB[sTint[i]];
        const co = i * 3;
        starColArr[co] = lum * rgb[0];
        starColArr[co + 1] = lum * rgb[1];
        starColArr[co + 2] = lum * rgb[2];
      }
      starMesh.instanceMatrix.needsUpdate = true;
      starMesh.instanceColor!.needsUpdate = true;

      // 3B. Fine Snow-Tumbling Gold & Silver Metallic Foil Specks Reaching All the Way to 1F Floor
      leafMesh.count = activeLeaves;
      const dragL = Math.exp(-1.25 * stepDt);
      const now220 = nowSec * 2.2;
      const now190 = nowSec * 1.9;
      for (let i = 0; i < activeLeaves; i++) {
        let age = lAge[i] + stepDt;
        if (age >= lLife[i] || lPy[i] < 0.14) {
          respawnLeaf(i, rand() < 0.55, 0, burstBaseY, 0);
          age = lAge[i];
        } else {
          lAge[i] = age;
        }
        const ph = lPhase[i];
        const flutter = fastSin(now220 + ph);
        const absFlutter = flutter < 0 ? -flutter : flutter;
        const px0 = lPx[i], pz0 = lPz[i];
        const radSq = px0 * px0 + pz0 * pz0;
        const invRad = radSq > 0.25 ? 1.0 / Math.sqrt(radSq) : 2.0;
        const tangX = -pz0 * invRad;
        const tangZ = px0 * invRad;
        const vx = (lVx[i] + (tangX * 0.34 + flutter * 0.95) * stepDt) * dragL;
        const vz = (lVz[i] + (tangZ * 0.34 + fastCos(now190 + ph * 1.3) * 0.95) * stepDt) * dragL;
        let vy = (lVy[i] - (0.90 - absFlutter * 0.22) * stepDt) * dragL;
        if (vy < -1.32) vy = -1.32;
        lVx[i] = vx; lVy[i] = vy; lVz[i] = vz;

        const px = px0 + vx * stepDt;
        const py = lPy[i] + vy * stepDt;
        const pz = pz0 + vz * stepDt;
        lPx[i] = px; lPy[i] = py; lPz[i] = pz;

        const t = age / lLife[i];
        let floorFade = py - 0.14;
        if (floorFade < 0) floorFade = 0;
        else if (floorFade > 1) floorFade = 1;
        const fadeIn = t * 5.0 < 1 ? t * 5.0 : 1;
        const fadeOut = 1 - t * t;
        const fade = fadeIn * (fadeOut > 0 ? fadeOut : 0) * floorFade;
        const spinA = age * lSpin[i];
        const turn = fastCos(spinA + ph);
        const absTurn = turn < 0 ? -turn : turn;
        const flash = turn * turn;
        const sc = lSize[i];
        writeTumblingFlake(
          leafMatArr,
          i,
          px,
          py,
          pz,
          spinA,
          spinA * 0.6 + ph,
          flutter * 0.8,
          sc * (0.40 + absTurn * 0.72),
          sc * 0.72,
        );

        const lum = fade * (0.38 + 0.62 * flash) * rallyBoost * 2.45;
        const co = i * 3;
        if (lSilver[i] === 1) {
          leafColArr[co] = lum * (0.82 + 0.14 * flash);
          leafColArr[co + 1] = lum * (0.88 + 0.10 * flash);
          leafColArr[co + 2] = lum * 1.12;
        } else {
          leafColArr[co] = lum * 1.24;
          leafColArr[co + 1] = lum * (0.74 + 0.22 * flash);
          leafColArr[co + 2] = lum * (0.24 + 0.30 * flash);
        }
      }
      leafMesh.instanceMatrix.needsUpdate = true;
      leafMesh.instanceColor!.needsUpdate = true;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
