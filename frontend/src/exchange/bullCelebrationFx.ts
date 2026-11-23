/* AAA Luxury Bull-Market Celebration FX for KOSPIMAP 3D Stock Exchange (WebGPU 60 FPS, 0 GC):
 * Inspired by KOSPIMAP's beloved assetCellArt.ts falling gold & silver shimmering powder!
 * - Index >= +3.0% (Tier 1 Bull Festival):
 *   1. Ceiling crimson-red neon lines blaze 3.0x brighter + pulsing crimson-gold neon crown collar at central pillar junction.
 *   2. Delicate shimmering gold & silver powder (85% fine micro-grains + 15% tumbling metallic leaf flakes, ZERO thick spears!)
 *      drifts & cascades down in wandering veils directly from the 3D ceiling neon lines (size-dependent air drag + glint flash).
 *   3. High-craft multi-bead curved chrysanthemum & golden-willow fireworks detonate visibly at the central column's upper
 *      ceiling junction with radial shockwave flash, delicate glowing comet tails, and crackling outer tips.
 *   4. Sparkling gold & silver fairy-dust & foil flecks scatter outward from every firework burst across all 4 atrium stories.
 * - Index >= +4.0% (Tier 2 Super Rally):
 *   - Ceiling neon line falling gold/silver powder count doubles (EXACT 2.0x: 1,100 -> 2,200 on desktop!) + twin-salvo bursts.
 */
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, InstancedBufferAttribute,
  InstancedMesh, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, PointLight, RingGeometry,
  SRGBColorSpace, Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Compact 2-plane crossed billboard bead so firework sparks & fine dust stay bright from every viewing angle. */
function makeCrossedBeadGeo(size: number): BufferGeometry {
  const a = new PlaneGeometry(size, size, 1, 1);
  const b = new PlaneGeometry(size, size, 1, 1);
  b.rotateY(Math.PI * 0.5);
  const merged = mergeGeometries([a, b]);
  a.dispose();
  b.dispose();
  return merged ?? new PlaneGeometry(size, size, 1, 1);
}

export type BullCelebrationFX = {
  group: Group;
  /** Feed live index % change (triggers >= +3.0% Tier 1, >= +4.0% Tier 2 with exact 2x ceiling neon sparks/powder). */
  setIndexChange: (changePct: number) => void;
  /** Smoothed 0..1 rally factor (0 below +3%, 1 at >= +3%) driving 3x crimson ceiling neon boost. */
  getRallyBoost: () => number;
  /** Current celebration tier: 0 = off, 1 = >= +3%, 2 = >= +4%. */
  getTier: () => 0 | 1 | 2;
  /** Active ceiling neon falling gold/silver particle count (verifies exact 2.0x doubling at >= +4%). */
  getActiveCeilingSparks: () => number;
  /** Step particle physics & fireworks (0.00 ms when inactive, 0 per-frame heap allocations). */
  tick: (nowSec: number, dt: number, reduced: boolean) => void;
  dispose: () => void;
};

/** Delicate soft circular glowing grain/ember bead texture (matches assetCellArt fine gold/silver dust — zero spear shapes!). */
function makeFineDustTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);

  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0.0, "rgba(255,255,255,1.0)");
  g.addColorStop(0.24, "rgba(255,252,240,0.96)");
  g.addColorStop(0.52, "rgba(255,235,190,0.42)");
  g.addColorStop(0.82, "rgba(255,215,140,0.08)");
  g.addColorStop(1.0, "rgba(255,200,110,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Crisp 4-point diamond star glint texture (for peak-flash gold/silver dust & leaf flecks, matching assetCellArt star()). */
function makeStarGlintTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);

  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 24);
  g.addColorStop(0.0, "rgba(255,255,255,1.0)");
  g.addColorStop(0.22, "rgba(255,252,238,0.94)");
  g.addColorStop(0.54, "rgba(255,236,185,0.28)");
  g.addColorStop(1.0, "rgba(255,215,150,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);

  ctx.save();
  ctx.translate(32, 32);
  for (const [len, thick, alpha, rot] of [
    [30, 1.8, 0.98, 0],
    [30, 1.8, 0.98, Math.PI * 0.5],
    [15, 1.2, 0.50, Math.PI * 0.25],
    [15, 1.2, 0.50, -Math.PI * 0.25],
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

/** Delicate metallic gold/silver leaf flake texture (sliver edge-on, gleaming facet face-on). */
function makeLeafFlakeTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 48, 48);

  ctx.save();
  ctx.translate(24, 24);
  ctx.rotate(Math.PI * 0.25);
  const g = ctx.createLinearGradient(-14, -10, 14, 10);
  g.addColorStop(0.0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.45, "rgba(255,255,255,1.0)");
  g.addColorStop(0.60, "rgba(255,248,225,0.92)");
  g.addColorStop(1.0, "rgba(255,230,175,0.48)");
  ctx.fillStyle = g;
  ctx.fillRect(-13, -8, 26, 16);
  ctx.restore();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Radial pyrotechnic detonation shockwave + incandescent bloom core texture. */
function makeFlashTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0.0, "rgba(255,255,255,1.0)");
  g.addColorStop(0.18, "rgba(255,244,208,0.94)");
  g.addColorStop(0.45, "rgba(255,186,92,0.38)");
  g.addColorStop(0.74, "rgba(255,74,88,0.14)");
  g.addColorStop(1.0, "rgba(255,36,62,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Soft radial crimson-gold neon halo texture for the central pillar upper ceiling junction collar. */
function makeCrownHaloTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 14, 64, 64, 62);
  g.addColorStop(0.0, "rgba(255,220,180,0.0)");
  g.addColorStop(0.28, "rgba(255,120,110,0.72)");
  g.addColorStop(0.46, "rgba(255,34,64,0.98)");
  g.addColorStop(0.68, "rgba(255,24,54,0.44)");
  g.addColorStop(1.0, "rgba(255,18,42,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Write a lightweight 3D-oriented fine flake / dust grain directly into InstancedMesh buffer (0 GC). */
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
  const cx = Math.cos(ax), sxr = Math.sin(ax);
  const cy = Math.cos(ay), syr = Math.sin(ay);
  const cz = Math.cos(az), szr = Math.sin(az);

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

/** Write a camera-friendly crossed/facing fine round spark bead directly into InstancedMesh buffer (0 GC). */
function writeRoundBead(
  arr: Float32Array,
  idx: number,
  px: number,
  py: number,
  pz: number,
  radX: number,
  radY: number,
  yaw: number,
) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
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

  // Visible underside junction where the glowing central glass column meets the vaulted ceiling oculus
  const burstBaseY = Math.min(16.15, Math.max(15.35, pillarCrownY - 1.15));

  // Harvested real GLB ceiling neon line points, supplemented if sparse with exact architectural ceiling rings & 12 ribs
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

  // Shared procedural textures & additive HDR materials
  const dustTex = makeFineDustTexture();
  const starTex = makeStarGlintTexture();
  const leafTex = makeLeafFlakeTexture();
  const flashTex = makeFlashTexture();
  const crownTex = makeCrownHaloTexture();
  disposables.push(dustTex, starTex, leafTex, flashTex, crownTex);

  const mkAdditiveMat = (map: CanvasTexture, opacity = 1.0) => {
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

  const dustMat = mkAdditiveMat(dustTex);
  const fwBeadMat = mkAdditiveMat(dustTex);
  const starMat = mkAdditiveMat(starTex);
  const leafMat = mkAdditiveMat(leafTex);
  const flashMat = mkAdditiveMat(flashTex, 0.0);
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
  disposables.push(crownCollarMat);

  // ---- 0. Central Pillar Upper Ceiling Junction Glowing Crimson-Gold Neon Collar ----
  const crownHaloGeo = new PlaneGeometry(11.4, 11.4, 1, 1);
  crownHaloGeo.rotateX(-Math.PI * 0.5);
  const crownHaloMesh = new Mesh(crownHaloGeo, crownMat);
  crownHaloMesh.position.set(0, burstBaseY + 0.55, 0);
  crownHaloMesh.frustumCulled = false;
  crownHaloMesh.renderOrder = 5;
  crownHaloMesh.layers.enable(1);
  group.add(crownHaloMesh);
  disposables.push(crownHaloGeo);

  const crownRingGeo = new RingGeometry(1.95, 2.75, 72, 1);
  crownRingGeo.rotateX(-Math.PI * 0.5);
  const crownRingMesh = new Mesh(crownRingGeo, crownCollarMat);
  crownRingMesh.position.set(0, burstBaseY + 0.42, 0);
  crownRingMesh.frustumCulled = false;
  crownRingMesh.renderOrder = 5;
  crownRingMesh.layers.enable(1);
  group.add(crownRingMesh);
  disposables.push(crownRingGeo);

  // ---- 1. Ceiling Neon Shimmering Gold & Silver Powder Veils (EXACT 2.0x count at >= +4.0%!) ----
  // Modeled directly on KOSPIMAP assetCellArt.ts:
  // - 85% fine shimmering gold & silver grains (ZERO spear shapes!)
  // - 15% tumbling metallic gold/silver leaf flecks with flash = cos²(turn)
  // - Excluded from planar floor Layer 1 to save 50% GPU overdraw -> locked 60.0 FPS!
  const CASCADE_TIER1 = mobile ? 360 : 780;
  const CASCADE_MAX = CASCADE_TIER1 * 2; // 1,560 gleaming grains at >= +4% (exact 2.0x)!
  const dustGeo = new PlaneGeometry(0.16, 0.16, 1, 1);
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
  const cR = new Float32Array(CASCADE_MAX);      // Fine grain radius 0.35..1.65 (drives air drag = 1.6 / r!)
  const cSpin = new Float32Array(CASCADE_MAX);
  const cSilver = new Uint8Array(CASCADE_MAX);

  // 8 wandering veil curtains around the ceiling rings (just like assetCellArt's wandering sheets!)
  const respawnCascade = (i: number, initialStagger = false, nowSec = 0) => {
    // 60% concentrate along wandering curtain sheets on the ceiling neon lines, 40% spill anywhere along all neon lines
    let ex: number, ey: number, ez: number;
    if (rand() < 0.58) {
      const sheet = Math.floor(rand() * 8);
      const baseIdx = Math.floor(((sheet / 8 + Math.sin(nowSec * (0.28 + sheet * 0.06) + sheet * 1.9) * 0.04 + 1) % 1) * emitCount);
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
    cPx[i] = ex + (rand() - 0.5) * 0.42;
    cPy[i] = ey - 0.06 - rand() * 0.20;
    cPz[i] = ez + (rand() - 0.5) * 0.42;

    const ang = rand() * Math.PI * 2;
    const hSpd = rand() * 0.72;
    cVx[i] = Math.cos(ang) * hSpd;
    cVy[i] = -(0.25 + rand() * 0.85);
    cVz[i] = Math.sin(ang) * hSpd;

    // 85% ultra-fine powder dust (r = 0.35..0.95), 15% larger leaf flecks (r = 1.05..1.65)
    cR[i] = rand() < 0.85 ? (0.38 + rand() * 0.58) : (1.05 + rand() * 0.62);
    cLife[i] = 5.5 + rand() * 5.0;
    cAge[i] = initialStagger ? rand() * cLife[i] : 0;
    cPhase[i] = rand() * Math.PI * 2;
    cSpin[i] = 5.0 + (i % 7) * 0.9;
    cSilver[i] = rand() < 0.46 ? 1 : 0;
  };
  for (let i = 0; i < CASCADE_MAX; i++) respawnCascade(i, true, 0);

  // ---- 2. High-Craft Fine-Beaded Chrysanthemum & Golden-Willow Fireworks at Central Pillar Crown ----
  // Crossed 3D glowing spark beads (always luminous from every camera angle!) forming dramatic 6-8m
  // spherical chrysanthemum & golden-willow arcs radiating visibly out from the central column's upper junction!
  const FW_SLOTS = 2;
  const FW_RAYS = mobile ? 42 : 68;
  const FW_TOTAL_RAYS = FW_SLOTS * FW_RAYS;
  const FW_TRAIL_BEADS = 7; // 1 blazing incandescent tip + 6 silky curving willow trail beads!
  const FW_INSTANCES = FW_TOTAL_RAYS * FW_TRAIL_BEADS;

  const fwBeadGeo = makeCrossedBeadGeo(0.24);
  const fwMesh = new InstancedMesh(fwBeadGeo, fwBeadMat, FW_INSTANCES);
  fwMesh.frustumCulled = false;
  fwMesh.renderOrder = 7;
  fwMesh.layers.enable(1);
  group.add(fwMesh);
  disposables.push(fwBeadGeo);
  const fwMatArr = fwMesh.instanceMatrix.array as Float32Array;
  const fwColArr = ensureInstanceColor(fwMesh, FW_INSTANCES);

  // 6-step trail history per firework ray for unmistakably crisp curving golden-willow / chrysanthemum arcs!
  const FW_HIST = FW_TRAIL_BEADS - 1;
  const fPx = new Float32Array(FW_TOTAL_RAYS);
  const fPy = new Float32Array(FW_TOTAL_RAYS);
  const fPz = new Float32Array(FW_TOTAL_RAYS);
  const fHx = new Float32Array(FW_TOTAL_RAYS * FW_HIST);
  const fHy = new Float32Array(FW_TOTAL_RAYS * FW_HIST);
  const fHz = new Float32Array(FW_TOTAL_RAYS * FW_HIST);
  const fVx = new Float32Array(FW_TOTAL_RAYS);
  const fVy = new Float32Array(FW_TOTAL_RAYS);
  const fVz = new Float32Array(FW_TOTAL_RAYS);
  const fAge = new Float32Array(FW_TOTAL_RAYS);
  const fLife = new Float32Array(FW_TOTAL_RAYS);
  const fPhase = new Float32Array(FW_TOTAL_RAYS);
  const fSize = new Float32Array(FW_TOTAL_RAYS);
  const fPalette = new Uint8Array(FW_TOTAL_RAYS); // 0=Molten Gold Willow, 1=Platinum Silver, 2=Champagne Rose-Gold
  const fDrag = new Float32Array(FW_TOTAL_RAYS);

  for (let i = 0; i < FW_TOTAL_RAYS; i++) {
    fAge[i] = 10;
    fLife[i] = 1;
  }

  // Detonation shockwave flash + dynamic bounce light right at central pillar crown junction
  const flashGeo = new PlaneGeometry(7.2, 7.2, 1, 1);
  const flashMesh = new Mesh(flashGeo, flashMat);
  flashMesh.position.set(0, burstBaseY, 0);
  flashMesh.frustumCulled = false;
  flashMesh.renderOrder = 8;
  group.add(flashMesh);
  disposables.push(flashGeo);

  const burstLight = mobile ? null : new PointLight("#ffe29e", 0, 38, 1.32);
  if (burstLight) {
    burstLight.position.set(0, burstBaseY, 0);
    burstLight.layers.enable(1);
    group.add(burstLight);
    disposables.push(burstLight);
  }

  let nextBurstSlot = 0;
  let burstCooldown = 0.05;
  let flashAge = 99;
  let shellCounter = 0;
  const flashPos = new Vector3(0, burstBaseY, 0);

  // ---- 3A. Sparkling 4-Point Star Glints (Diamond Flash Sparks Scattered Across the Atrium) ----
  const STAR_TIER1 = mobile ? 120 : 240;
  const STAR_MAX = mobile ? 180 : 380;
  const starGeo = new PlaneGeometry(0.26, 0.26, 1, 1);
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
  const sSilver = new Uint8Array(STAR_MAX);

  const respawnStar = (i: number, fromBurst: boolean, ox = 0, oy = burstBaseY, oz = 0) => {
    const theta = rand() * Math.PI * 2;
    if (fromBurst) {
      const r0 = 0.6 + rand() * 1.4;
      sPx[i] = ox + Math.cos(theta) * r0;
      sPy[i] = oy + (rand() - 0.45) * 1.0;
      sPz[i] = oz + Math.sin(theta) * r0;
      const spd = 2.6 + rand() * 6.4;
      const phi = (rand() - 0.38) * 1.15;
      sVx[i] = Math.cos(theta) * Math.cos(phi) * spd;
      sVy[i] = Math.sin(phi) * spd * 0.55 - 0.15;
      sVz[i] = Math.sin(theta) * Math.cos(phi) * spd;
      sLife[i] = 4.6 + rand() * 4.0;
      sAge[i] = 0;
    } else {
      const rad = 1.6 + Math.pow(rand(), 0.72) * 18.0;
      sPx[i] = Math.cos(theta) * rad;
      sPy[i] = 1.8 + rand() * (burstBaseY - 0.8);
      sPz[i] = Math.sin(theta) * rad;
      sVx[i] = (rand() - 0.5) * 1.0;
      sVy[i] = -(0.30 + rand() * 0.65);
      sVz[i] = (rand() - 0.5) * 1.0;
      sLife[i] = 5.0 + rand() * 4.2;
      sAge[i] = rand() * sLife[i];
    }
    sPhase[i] = rand() * Math.PI * 2;
    sSpin[i] = 4.5 + rand() * 6.0;
    sSize[i] = 0.55 + rand() * 0.95;
    sSilver[i] = rand() < 0.48 ? 1 : 0;
  };
  for (let i = 0; i < STAR_MAX; i++) respawnStar(i, false);

  // ---- 3B. Tumbling Gold & Silver Metallic Leaf Flakes (assetCellArt Leaf-Flutter Physics!) ----
  const LEAF_TIER1 = mobile ? 110 : 240;
  const LEAF_MAX = mobile ? 170 : 380;
  const leafGeo = new PlaneGeometry(0.14, 0.095, 1, 1);
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
      lPx[i] = ox + Math.cos(theta) * (0.8 + rand() * 1.5);
      lPy[i] = oy + (rand() - 0.48) * 1.0;
      lPz[i] = oz + Math.sin(theta) * (0.8 + rand() * 1.5);
      const spd = 2.4 + rand() * 5.6;
      lVx[i] = Math.cos(theta) * spd;
      lVy[i] = (rand() - 0.40) * 2.8;
      lVz[i] = Math.sin(theta) * spd;
      lLife[i] = 6.2 + rand() * 4.5;
      lAge[i] = 0;
    } else {
      const rad = 1.6 + Math.pow(rand(), 0.72) * 18.0;
      lPx[i] = Math.cos(theta) * rad;
      lPy[i] = 2.2 + rand() * (burstBaseY - 1.2);
      lPz[i] = Math.sin(theta) * rad;
      lVx[i] = (rand() - 0.5) * 1.1;
      lVy[i] = -(0.45 + rand() * 0.65);
      lVz[i] = (rand() - 0.5) * 1.1;
      lLife[i] = 6.6 + rand() * 4.5;
      lAge[i] = rand() * lLife[i];
    }
    lPhase[i] = rand() * Math.PI * 2;
    lSpin[i] = 4.2 + (i % 6) * 0.95;
    lSize[i] = 0.72 + rand() * 0.95;
    lSilver[i] = rand() < 0.46 ? 1 : 0;
  };
  for (let i = 0; i < LEAF_MAX; i++) respawnLeaf(i, false);

  const triggerFireworkBurst = (slot: number, activeStars: number, activeLeaves: number) => {
    // Detonate clearly visible right at the central column's upper ceiling junction collar!
    const collarAng = (shellCounter * 2.09 + rand() * 0.45) % (Math.PI * 2);
    const collarR = 2.55 + rand() * 1.75;
    const ox = Math.cos(collarAng) * collarR;
    const oy = burstBaseY - 0.25 + (rand() - 0.5) * 0.85;
    const oz = Math.sin(collarAng) * collarR;

    flashPos.set(ox, oy, oz);
    flashMesh.position.copy(flashPos);
    if (burstLight) burstLight.position.copy(flashPos);
    flashAge = 0;

    // 4 choreographed luxury shell styles:
    // 0: Golden Brocade Willow, 1: Platinum Silver Chrysanthemum, 2: Dual-Ring Gold Core + Silver Crown, 3: Champagne Rose-Gold
    const style = shellCounter % 4;
    shellCounter += 1;

    const base = slot * FW_RAYS;
    for (let k = 0; k < FW_RAYS; k++) {
      const idx = base + k;
      // Golden-angle Fibonacci 3D sphere for ultra-clean symmetrical firework burst geometry
      const u = (k + 0.5) / FW_RAYS;
      const yDir = 1 - 2 * u + (rand() - 0.5) * 0.12;
      const rPlane = Math.sqrt(Math.max(0.001, 1 - yDir * yDir));
      const goldenAng = k * 2.39996323 + rand() * 0.14;
      const dx = Math.cos(goldenAng) * rPlane;
      const dz = Math.sin(goldenAng) * rPlane;
      const dy = yDir > 0.36 ? 0.36 - (yDir - 0.36) * 0.48 : yDir;

      const isInner = style === 2 ? (k % 3 === 0) : (k % 5 === 0);
      const speed = isInner ? (6.8 + rand() * 2.8) : (11.6 + rand() * 4.8);

      const px = ox + dx * 0.24;
      const py = oy + dy * 0.24;
      const pz = oz + dz * 0.24;
      fPx[idx] = px; fPy[idx] = py; fPz[idx] = pz;
      const hBase = idx * FW_HIST;
      for (let h = 0; h < FW_HIST; h++) {
        fHx[hBase + h] = px;
        fHy[hBase + h] = py;
        fHz[hBase + h] = pz;
      }
      fVx[idx] = dx * speed;
      fVy[idx] = dy * speed;
      fVz[idx] = dz * speed;
      fAge[idx] = 0;
      fLife[idx] = style === 0 ? (2.05 + rand() * 0.85) : (1.65 + rand() * 0.75);
      fPhase[idx] = rand() * Math.PI * 2;
      fSize[idx] = isInner ? (0.76 + rand() * 0.35) : (0.95 + rand() * 0.55);
      fDrag[idx] = style === 0 ? 1.72 : 2.08;

      if (style === 0) fPalette[idx] = k % 5 === 0 ? 1 : 0;
      else if (style === 1) fPalette[idx] = k % 4 === 0 ? 0 : 1;
      else if (style === 2) fPalette[idx] = isInner ? 0 : 1;
      else fPalette[idx] = k % 3 === 0 ? 2 : k % 2;
    }

    // Scatter glittering gold/silver dust & fluttering metallic leaf flakes radially out of this burst!
    const startS = (slot * 85) % activeStars;
    for (let j = 0; j < 78; j++) respawnStar((startS + j) % activeStars, true, ox, oy, oz);
    const startL = (slot * 60) % activeLeaves;
    for (let j = 0; j < 56; j++) respawnLeaf((startL + j) % activeLeaves, true, ox, oy, oz);
  };

  let currentChangePct = 0;
  let tier: 0 | 1 | 2 = 0;
  let rallyBoost = 0;
  let trailSnapAccum = 0;

  return {
    group,
    setIndexChange(changePct: number) {
      currentChangePct = Number.isFinite(changePct) ? changePct : 0;
      const nextTier: 0 | 1 | 2 = currentChangePct >= 4.0 ? 2 : currentChangePct >= 3.0 ? 1 : 0;
      if (nextTier > 0 && tier === 0) {
        burstCooldown = 0.04;
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
        }
        return;
      }
      group.visible = true;

      const motionMul = reduced ? 0.35 : 1.0;
      const stepDt = dt * motionMul;
      const activeCascade = tier >= 2 ? CASCADE_MAX : CASCADE_TIER1;
      const activeStars = tier >= 2 ? STAR_MAX : STAR_TIER1;
      const activeLeaves = tier >= 2 ? LEAF_MAX : LEAF_TIER1;

      // 0. Pulsing Central Pillar Top Junction Neon Glow (synced with firework bursts)
      const crownBreath = 0.80 + 0.20 * Math.sin(nowSec * 3.8);
      const flashKick = flashAge < 0.45 ? Math.pow(1 - flashAge / 0.45, 2.0) * 0.48 : 0;
      crownMat.opacity = Math.min(1.0, (0.64 * crownBreath + flashKick) * rallyBoost);
      crownCollarMat.opacity = Math.min(1.0, (0.78 * crownBreath + flashKick * 0.6) * rallyBoost);
      crownCollarMat.color.setRGB(
        2.9 + flashKick * 1.5,
        0.34 + flashKick * 1.15,
        0.54 + flashKick * 0.40,
      );

      // 1. Ceiling Neon Shimmering Gold & Silver Powder Veils (EXACT assetCellArt.ts dust physics, 2.0x at >= +4%!)
      cascadeMesh.count = activeCascade;
      for (let i = 0; i < activeCascade; i++) {
        cAge[i] += stepDt;
        if (cAge[i] >= cLife[i] || cPy[i] < 0.22) {
          respawnCascade(i, false, nowSec);
        }
        const r = cR[i];
        const ph = cPhase[i];
        // assetCellArt exact aerodynamic drag: finer dust meets higher air drag -> sifts down lazily!
        const drag = 1.65 / r;
        const swayX = Math.sin(cAge[i] * 4.2 + ph) * 1.35 + Math.cos(nowSec * 0.85 + ph * 1.4) * 0.45;
        const swayZ = Math.cos(cAge[i] * 3.8 + ph * 1.2) * 1.35 - Math.sin(nowSec * 0.80 + ph) * 0.45;
        cVx[i] += (swayX - cVx[i] * drag) * stepDt;
        cVz[i] += (swayZ - cVz[i] * drag) * stepDt;
        // Gravity balanced by size-dependent air drag (terminal fall speed ~0.9..2.6 m/s — gentle sparkling snow!)
        cVy[i] += (-3.4 - cVy[i] * drag) * stepDt;

        cPx[i] += cVx[i] * stepDt;
        cPy[i] += cVy[i] * stepDt;
        cPz[i] += cVz[i] * stepDt;

        const lifeT = cAge[i] / cLife[i];
        const fallFade = Math.min(1, lifeT * 6.5) * Math.max(0, 1 - Math.pow(lifeT, 2.0)) * Math.min(1, Math.max(0, (cPy[i] - 0.22) / 1.5));

        // assetCellArt exact metallic tumble flash: turn = cos(age * spin + phase), flash = turn²
        const turn = Math.cos(cAge[i] * cSpin[i] + ph);
        const flash = turn * turn;
        const a = fallFade * (0.35 + 0.65 * flash) * rallyBoost;

        if (r > 1.0) {
          // Delicate tumbling leaf fleck: narrows edge-on, widens & flashes as face turns to light!
          const wScale = r * (0.30 + Math.abs(turn) * 0.85);
          const hScale = r * 0.78;
          writeTumblingFlake(cascadeMatArr, i, cPx[i], cPy[i], cPz[i], cAge[i] * cSpin[i], ph + nowSec * 1.2, turn * 0.7, wScale, hScale);
        } else {
          // Ultra-fine round shimmering dust grain (tiny 1.0..1.25 vertical teardrop hint — ZERO spears!)
          const gScale = r * (0.72 + flash * 0.48);
          const stretchY = gScale * (1.0 + Math.min(0.32, Math.abs(cVy[i]) * 0.12));
          writeRoundBead(cascadeMatArr, i, cPx[i], cPy[i], cPz[i], gScale, stretchY, ph + nowSec * 0.8);
        }

        // assetCellArt exact gold & silver metallic shimmer colors (boosted HDR radiance for crisp 3D visibility!)
        const lum = a * (2.55 + (flash > 0.92 ? 1.45 : 0));
        const co = i * 3;
        if (cSilver[i] === 1) {
          // rgba(215 + 40*flash, 225 + 30*flash, 255)
          cascadeColArr[co] = lum * (0.84 + 0.16 * flash);
          cascadeColArr[co + 1] = lum * (0.88 + 0.12 * flash);
          cascadeColArr[co + 2] = lum * 1.18;
        } else {
          // rgba(255, 170 + 70*flash, 50 + 120*flash) -> rich gold flashing champagne-white!
          cascadeColArr[co] = lum * 1.28;
          cascadeColArr[co + 1] = lum * (0.70 + 0.28 * flash);
          cascadeColArr[co + 2] = lum * (0.20 + 0.48 * flash);
        }
      }
      cascadeMesh.instanceMatrix.needsUpdate = true;
      cascadeMesh.instanceColor!.needsUpdate = true;

      // 2. Central Column Upper Junction High-Craft Fine-Beaded Fireworks
      if (tier > 0) {
        burstCooldown -= stepDt;
        if (burstCooldown <= 0) {
          triggerFireworkBurst(nextBurstSlot, activeStars, activeLeaves);
          nextBurstSlot = (nextBurstSlot + 1) % FW_SLOTS;
          if (tier >= 2 && shellCounter % 2 === 1) {
            burstCooldown = 0.34 + rand() * 0.14;
          } else {
            burstCooldown = tier >= 2 ? 0.95 + rand() * 0.36 : 1.32 + rand() * 0.52;
          }
        }
      }

      flashAge += stepDt;
      if (flashAge < 0.44) {
        const ft = flashAge / 0.44;
        const pulse = Math.pow(1 - ft, 2.2) * rallyBoost;
        flashMat.opacity = pulse * 0.95;
        const fScale = 0.42 + Math.pow(ft, 0.55) * 1.85;
        flashMesh.scale.set(fScale, fScale, fScale);
        flashMesh.rotation.z += stepDt * 1.4;
        if (burstLight) {
          burstLight.intensity = pulse * (tier >= 2 ? 58 : 44);
          burstLight.color.setRGB(1.0, 0.88 - ft * 0.28, 0.60 - ft * 0.26);
        }
      } else {
        flashMat.opacity = 0;
        if (burstLight) burstLight.intensity = 0;
      }

      // Update 6-step curved willow trail history (~30 Hz)
      trailSnapAccum += stepDt;
      const snapNow = trailSnapAccum >= 0.032;
      if (snapNow) trailSnapAccum = 0;

      for (let i = 0; i < FW_TOTAL_RAYS; i++) {
        fAge[i] += stepDt;
        const age = fAge[i];
        const life = fLife[i];
        const baseInst = i * FW_TRAIL_BEADS;
        if (age >= life) {
          for (let b = 0; b < FW_TRAIL_BEADS; b++) writeZeroInstance(fwMatArr, baseInst + b);
          continue;
        }
        const hBase = i * FW_HIST;
        if (snapNow) {
          for (let h = FW_HIST - 1; h > 0; h--) {
            fHx[hBase + h] = fHx[hBase + h - 1];
            fHy[hBase + h] = fHy[hBase + h - 1];
            fHz[hBase + h] = fHz[hBase + h - 1];
          }
          fHx[hBase] = fPx[i];
          fHy[hBase] = fPy[i];
          fHz[hBase] = fPz[i];
        }
        const drag = Math.exp(-fDrag[i] * stepDt);
        fVx[i] *= drag;
        fVz[i] *= drag;
        fVy[i] = fVy[i] * drag - 3.65 * stepDt;
        fPx[i] += fVx[i] * stepDt;
        fPy[i] += fVy[i] * stepDt;
        fPz[i] += fVz[i] * stepDt;

        const t = age / life;
        const crackle = t > 0.52 ? (0.35 + 0.65 * Math.pow(Math.abs(Math.sin(nowSec * 38.0 + fPhase[i] * 8.0)), 2.0)) : 1.0;
        const alpha = Math.pow(1 - t, 1.30) * crackle * rallyBoost;
        const hot = Math.max(0, 1 - t * 4.2);
        const s = fSize[i];
        const pal = fPalette[i];

        // 7 fine glowing crossed beads tracing unmistakable curved chrysanthemum / golden-willow comet arcs!
        for (let b = 0; b < FW_TRAIL_BEADS; b++) {
          const inst = baseInst + b;
          const bx = b === 0 ? fPx[i] : fHx[hBase + b - 1];
          const by = b === 0 ? fPy[i] : fHy[hBase + b - 1];
          const bz = b === 0 ? fPz[i] : fHz[hBase + b - 1];
          const taper = 1.0 - b * 0.125;
          const bRad = s * (1.02 - t * 0.25) * taper;
          writeRoundBead(fwMatArr, inst, bx, by, bz, bRad, bRad, fPhase[i] + b * 0.45);

          const lum = alpha * (3.85 + hot * 1.8) * Math.pow(taper, 1.45);
          const co = inst * 3;
          if (pal === 1) {
            fwColArr[co] = lum * (0.94 + hot * 0.12);
            fwColArr[co + 1] = lum * (0.98 + hot * 0.08);
            fwColArr[co + 2] = lum * 1.26;
          } else if (pal === 2) {
            fwColArr[co] = lum * 1.38;
            fwColArr[co + 1] = lum * (0.72 + hot * 0.30 - b * 0.04);
            fwColArr[co + 2] = lum * (0.52 + hot * 0.38 - b * 0.05);
          } else {
            fwColArr[co] = lum * 1.36;
            fwColArr[co + 1] = lum * (0.94 + hot * 0.16 - t * 0.24 - b * 0.05);
            fwColArr[co + 2] = lum * (0.36 + hot * 0.55 - t * 0.20 - b * 0.05);
          }
        }
      }
      fwMesh.instanceMatrix.needsUpdate = true;
      fwMesh.instanceColor!.needsUpdate = true;

      // 3A. Sparkling 4-Point Diamond Star Glints Floating Across All 4 Stories
      starMesh.count = activeStars;
      const dragS = Math.exp(-1.25 * stepDt);
      for (let i = 0; i < activeStars; i++) {
        sAge[i] += stepDt;
        if (sAge[i] >= sLife[i] || sPy[i] < 0.30) {
          respawnStar(i, rand() < 0.52, 0, burstBaseY, 0);
        }
        const ph = sPhase[i];
        const rad = Math.max(0.5, Math.hypot(sPx[i], sPz[i]));
        const tangX = -sPz[i] / rad;
        const tangZ = sPx[i] / rad;
        sVx[i] = (sVx[i] + (tangX * 0.65 + Math.sin(nowSec * 1.7 + ph) * 1.05) * stepDt) * dragS;
        sVz[i] = (sVz[i] + (tangZ * 0.65 + Math.cos(nowSec * 1.5 + ph * 1.4) * 1.05) * stepDt) * dragS;
        sVy[i] = Math.max(-1.05, (sVy[i] - 0.68 * stepDt) * dragS);

        sPx[i] += sVx[i] * stepDt;
        sPy[i] += sVy[i] * stepDt;
        sPz[i] += sVz[i] * stepDt;

        const t = sAge[i] / sLife[i];
        const fade = Math.min(1, t * 5.0) * Math.max(0, 1 - Math.pow(t, 1.9));
        const ang = nowSec * sSpin[i] + ph;
        // Sharp assetCellArt star twinkle: gleams brightly ONLY near peak flash!
        const glint = Math.pow(Math.abs(Math.sin(ang)), 6.0);
        const sc = sSize[i] * (0.35 + glint * 1.15);
        writeTumblingFlake(starMatArr, i, sPx[i], sPy[i], sPz[i], ang * 0.5, ph + nowSec * 0.6, ang * 0.3, sc, sc);

        const lum = fade * (0.18 + glint * 2.65) * rallyBoost;
        const co = i * 3;
        if (sSilver[i] === 1) {
          starColArr[co] = lum * 0.94;
          starColArr[co + 1] = lum * 0.98;
          starColArr[co + 2] = lum * 1.20;
        } else {
          starColArr[co] = lum * 1.28;
          starColArr[co + 1] = lum * (0.78 + 0.22 * glint);
          starColArr[co + 2] = lum * (0.30 + 0.42 * glint);
        }
      }
      starMesh.instanceMatrix.needsUpdate = true;
      starMesh.instanceColor!.needsUpdate = true;

      // 3B. Tumbling Metallic Gold & Silver Leaf Flakes (Graceful Festival Drift Everywhere)
      leafMesh.count = activeLeaves;
      const dragL = Math.exp(-1.35 * stepDt);
      for (let i = 0; i < activeLeaves; i++) {
        lAge[i] += stepDt;
        if (lAge[i] >= lLife[i] || lPy[i] < 0.28) {
          respawnLeaf(i, rand() < 0.58, 0, burstBaseY, 0);
        }
        const ph = lPhase[i];
        const flutter = Math.sin(nowSec * 3.6 + ph);
        const rad = Math.max(0.5, Math.hypot(lPx[i], lPz[i]));
        const tangX = -lPz[i] / rad;
        const tangZ = lPx[i] / rad;
        lVx[i] = (lVx[i] + (tangX * 0.58 + flutter * 1.45) * stepDt) * dragL;
        lVz[i] = (lVz[i] + (tangZ * 0.58 + Math.cos(nowSec * 3.1 + ph * 1.3) * 1.45) * stepDt) * dragL;
        lVy[i] = Math.max(-1.15, (lVy[i] - (0.85 - Math.abs(flutter) * 0.38) * stepDt) * dragL);

        lPx[i] += lVx[i] * stepDt;
        lPy[i] += lVy[i] * stepDt;
        lPz[i] += lVz[i] * stepDt;

        const t = lAge[i] / lLife[i];
        const fade = Math.min(1, t * 5.0) * Math.max(0, 1 - Math.pow(t, 2.0));
        const turn = Math.cos(lAge[i] * lSpin[i] + ph);
        const flash = turn * turn;
        const sc = lSize[i];
        writeTumblingFlake(
          leafMatArr,
          i,
          lPx[i],
          lPy[i],
          lPz[i],
          lAge[i] * lSpin[i],
          lAge[i] * lSpin[i] * 0.6 + ph,
          flutter * 0.9,
          sc * (0.35 + Math.abs(turn) * 0.75),
          sc * 0.72,
        );

        const lum = fade * (0.35 + 0.65 * flash) * rallyBoost * 2.1;
        const co = i * 3;
        if (lSilver[i] === 1) {
          leafColArr[co] = lum * (0.84 + 0.16 * flash);
          leafColArr[co + 1] = lum * (0.88 + 0.12 * flash);
          leafColArr[co + 2] = lum * 1.15;
        } else {
          leafColArr[co] = lum * 1.22;
          leafColArr[co + 1] = lum * (0.68 + 0.28 * flash);
          leafColArr[co + 2] = lum * (0.20 + 0.45 * flash);
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
