/* WebGPU / TSL live architectural effects, 3-mood atmosphere controller, and cinematic showcase tour
 * for KOSPIMAP Exchange v6 Grand Luminous Atrium.
 *
 * Total GPU overhead: 4 extra draw calls (WaterSurface shader, HoloCoreFX shader + 2 orbital telemetry
 * rings, merged Volumetric God-Rays, and Atmospheric Light Motes) — designed to hold locked 60 fps. */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide,
  Group, Mesh, MeshStandardMaterial, Object3D, PointLight, Points, RingGeometry, Vector3,
  type HemisphereLight, type Scene, type Texture,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, PointsNodeMaterial, type WebGPURenderer } from "three/webgpu";
import {
  abs, clamp, cos, dot, float, mix, normalView, positionLocal, positionViewDirection, positionWorld,
  pow, sin, smoothstep, uniform, uv, vec3,
} from "three/tsl";

export type AtriumMood = "daylight" | "golden" | "night";

type MoodSpec = {
  exposure: number;
  bg: string;
  sky: string;
  ground: string;
  hemi: number;
  envIntensity: number;
  lightmapMul: number;
  skylightColor: string;
  skylightEmit: number;
  windowColor: string;
  windowEmit: number;
  coveMul: number;
  godRayColor: string;
  godRayOpacity: number;
  holoBoost: number;
  moteColor: string;
  moteOpacity: number;
};

const MOODS: Record<AtriumMood, MoodSpec> = {
  daylight: {
    exposure: 0.78,
    bg: "#dfe4ec",
    sky: "#f7f3eb",
    ground: "#5c524a",
    hemi: 0.56,
    envIntensity: 0.58,
    lightmapMul: 1.0,
    skylightColor: "#e6f0ff",
    skylightEmit: 1.38,
    windowColor: "#ffffff",
    windowEmit: 0.92,
    coveMul: 0.85,
    godRayColor: "#fff2d8",
    godRayOpacity: 0.055,
    holoBoost: 1.0,
    moteColor: "#fff0d0",
    moteOpacity: 0.34,
  },
  golden: {
    exposure: 0.72,
    bg: "#d8b48c",
    sky: "#ffd9a8",
    ground: "#4d382a",
    hemi: 0.44,
    envIntensity: 0.52,
    lightmapMul: 0.78,
    skylightColor: "#ffc888",
    skylightEmit: 1.15,
    windowColor: "#ffcf96",
    windowEmit: 0.82,
    coveMul: 1.15,
    godRayColor: "#ffc470",
    godRayOpacity: 0.095,
    holoBoost: 1.18,
    moteColor: "#ffd896",
    moteOpacity: 0.48,
  },
  night: {
    exposure: 0.68,
    bg: "#070c18",
    sky: "#223b66",
    ground: "#101624",
    hemi: 0.24,
    envIntensity: 0.28,
    lightmapMul: 0.26,
    skylightColor: "#142646",
    skylightEmit: 0.42,
    windowColor: "#1a2f56",
    windowEmit: 0.26,
    coveMul: 1.55,
    godRayColor: "#48b8ff",
    godRayOpacity: 0.068,
    holoBoost: 1.65,
    moteColor: "#78e0ff",
    moteOpacity: 0.58,
  },
};

type TrackedLightmapMat = { mat: MeshStandardMaterial; base: number };
type TrackedEmitMat = { mat: MeshStandardMaterial; kind: "skylight" | "window" | "cove"; base: number };
type TrackedCoreMat = {
  mat: MeshStandardMaterial;
  role: "filament" | "filamentW" | "rod" | "well" | "accent" | "glass";
  baseEmit: number;
};

export type AtriumFX = {
  group: Group;
  setMood: (mood: AtriumMood) => void;
  getMood: () => AtriumMood;
  setIndexChange: (changePct: number | null | undefined) => void;
  setEnvironment: (env: Texture) => void;
  tick: (now: number, dt: number, reduced: boolean) => void;
  dispose: () => void;
};

// Pre-allocated color constants: zero heap/GC allocations during live quote ticks.
const C_NEUTRAL_PRI = new Color("#5ee4ff");
const C_NEUTRAL_HI = new Color("#d2f8ff");
const C_NEUTRAL_GLASS = new Color("#94d8ec");
const C_RISE_MILD = new Color("#ff7c92");
const C_RISE_MID = new Color("#ff2442");
const C_RISE_DEEP = new Color("#e60022");
const C_RISE_HI_MILD = new Color("#ffd4dc");
const C_RISE_HI_DEEP = new Color("#ff6b7a");
const C_RISE_GLASS_A = new Color("#f2b6be");
const C_RISE_GLASS_B = new Color("#ff687c");
const C_DROP_MILD = new Color("#5cbfff");
const C_DROP_MID = new Color("#1672ff");
const C_DROP_DEEP = new Color("#0838ff");
const C_DROP_HI_MILD = new Color("#cbeeff");
const C_DROP_HI_DEEP = new Color("#66b4ff");
const C_DROP_GLASS_A = new Color("#a6d8f8");
const C_DROP_GLASS_B = new Color("#4b98ff");
const C_WARM_CEILING = new Color("#ffce8c");

/** Compute central neon core color, highlight color, and intensity multiplier from index % change.
 *  Korean market convention:
 *   - Rise (> 0): warm rose-coral -> vivid crimson -> blazing deep ruby red (stronger glow as gain grows)
 *   - Drop (< 0): clear sky-blue -> electric cobalt -> blazing deep royal sapphire blue (stronger glow as drop deepens)
 *   - Flat (0):   serene luminous ice-cyan neutral */
function coreSignalForChange(pct: number, outPrimary: Color, outHighlight: Color, outGlass: Color) {
  const absPct = Math.abs(pct);
  const raw = clampVal(absPct / 3.5, 0, 1);
  const strength = Math.pow(raw, 0.72);
  const intensity = 1.0 + Math.pow(raw, 0.85) * 1.55;

  if (absPct < 0.01) {
    outPrimary.copy(C_NEUTRAL_PRI);
    outHighlight.copy(C_NEUTRAL_HI);
    outGlass.copy(C_NEUTRAL_GLASS);
    return { intensity: 1.0, strength: 0 };
  }

  if (pct > 0) {
    if (strength < 0.5) outPrimary.copy(C_RISE_MILD).lerp(C_RISE_MID, strength * 2);
    else outPrimary.copy(C_RISE_MID).lerp(C_RISE_DEEP, (strength - 0.5) * 2);
    outHighlight.copy(C_RISE_HI_MILD).lerp(C_RISE_HI_DEEP, strength);
    outGlass.copy(C_RISE_GLASS_A).lerp(C_RISE_GLASS_B, strength * 0.65);
  } else {
    if (strength < 0.5) outPrimary.copy(C_DROP_MILD).lerp(C_DROP_MID, strength * 2);
    else outPrimary.copy(C_DROP_MID).lerp(C_DROP_DEEP, (strength - 0.5) * 2);
    outHighlight.copy(C_DROP_HI_MILD).lerp(C_DROP_HI_DEEP, strength);
    outGlass.copy(C_DROP_GLASS_A).lerp(C_DROP_GLASS_B, strength * 0.65);
  }
  return { intensity, strength };
}

export function createAtriumFX(
  model: Object3D,
  scene: Scene,
  renderer: WebGPURenderer,
  hemiLight: HemisphereLight,
  lightmapped: TrackedLightmapMat[],
  mobile: boolean,
): AtriumFX {
  const group = new Group();
  group.name = "AtriumV6FX";
  const disposables: { dispose: () => void }[] = [];

  const uTime = uniform(0);
  const uGodRayColor = uniform(new Color(MOODS.daylight.godRayColor));
  const uGodRayOpacity = uniform(MOODS.daylight.godRayOpacity);
  const uHoloBoost = uniform(MOODS.daylight.holoBoost);
  const uMoteColor = uniform(new Color(MOODS.daylight.moteColor));
  const uMoteOpacity = uniform(MOODS.daylight.moteOpacity);
  // Live index-reactive central neon uniforms (blends smoothly: Blue on drop <-> Ice-Cyan flat <-> Red on rise)
  const uCoreColor = uniform(new Color("#5ee4ff"));
  const uCoreHighlight = uniform(new Color("#d2f8ff"));
  const uCoreIntensity = uniform(1.0);
  const uCoreStrength = uniform(0.0);
  const uCoveWarmMul = uniform(MOODS.daylight.coveMul);
  const uCeilingColor = uniform(new Color("#ffcc88"));
  const uCeilingIntensity = uniform(4.4);
  const uPulseSpeed = uniform(1.0);

  // Track architectural emitter & central neon core materials for smooth real-time transitions
  const trackedEmits: TrackedEmitMat[] = [];
  const trackedCore: TrackedCoreMat[] = [];
  const seenEmit = new Set<string>();
  const seenCore = new Set<string>();
  const coveNodeCache = new Map<string, MeshStandardNodeMaterial>();

  const makeCeilingReactiveCove = (src: MeshStandardMaterial, baseEmit: number) => {
    const cached = coveNodeCache.get(src.uuid);
    if (cached) return cached;
    const nm = new MeshStandardNodeMaterial({
      color: src.color.clone(),
      roughness: src.roughness,
      metalness: src.metalness,
    });
    // Mask strictly to the vaulted atrium ceiling: oculus halos + 12 radial roof ribs + 12 vaulted arches
    // (y >= 15.5m and inside the column ring r <= 23.2m), keeping all 1F-4F gallery/lounge/art coves warm 3000K!
    const yMask = smoothstep(float(15.4), float(16.1), positionWorld.y);
    const rDist = positionWorld.xz.length();
    const rMask = smoothstep(float(23.6), float(22.0), rDist);
    const ceilingMask = yMask.mul(rMask);

    const warmRgb = vec3(src.emissive.r, src.emissive.g, src.emissive.b).mul(float(baseEmit)).mul(uCoveWarmMul);
    const ceilRgb = uCeilingColor.mul(uCeilingIntensity);
    nm.emissiveNode = mix(warmRgb, ceilRgb, ceilingMask);
    // Dispose both the new NodeMaterial and the detached original GLTF material on cleanup (zero leak!)
    disposables.push(nm, src);
    coveNodeCache.set(src.uuid, nm);
    return nm;
  };

  model.traverse(child => {
    if (!(child instanceof Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    let replaced = false;
    const nextMats = mats.map(m => {
      if (!(m instanceof MeshStandardMaterial)) return m;
      if (/warm 3000k cove|soft warm accent/i.test(m.name)) {
        replaced = true;
        return makeCeilingReactiveCove(m, Math.max(m.emissiveIntensity, 3.2));
      }
      if (!seenEmit.has(m.uuid)) {
        if (/daylight glazing/i.test(m.name)) {
          seenEmit.add(m.uuid);
          trackedEmits.push({ mat: m, kind: "skylight", base: m.emissiveIntensity });
        } else if (/perimeter daylight window/i.test(m.name)) {
          seenEmit.add(m.uuid);
          trackedEmits.push({ mat: m, kind: "window", base: m.emissiveIntensity });
        } else if (/downlight/i.test(m.name)) {
          seenEmit.add(m.uuid);
          trackedEmits.push({ mat: m, kind: "cove", base: m.emissiveIntensity });
        }
      }
      if (!seenCore.has(m.uuid)) {
        if (/core cyan filament/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "filament", baseEmit: Math.max(m.emissiveIntensity, 6.0) });
        } else if (/core white filament/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "filamentW", baseEmit: Math.max(m.emissiveIntensity, 8.0) });
        } else if (/core energy rod/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "rod", baseEmit: Math.max(m.emissiveIntensity, 3.0) });
        } else if (/core floor light well/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "well", baseEmit: Math.max(m.emissiveIntensity, 5.0) });
        } else if (/cyan accent led/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "accent", baseEmit: Math.max(m.emissiveIntensity, 3.8) });
        } else if (/core crystal glass/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "glass", baseEmit: 0 });
        }
      }
      return m;
    });
    if (replaced) child.material = Array.isArray(child.material) ? nextMats : nextMats[0];
  });

  // Live non-shadow central & ceiling bounce lights: 3 on desktop, 1 consolidated light on mobile for fragment speed.
  const coreLightLow = new PointLight("#5ee4ff", 14, 15, 1.7);
  coreLightLow.position.set(0, mobile ? 4.2 : 2.2, 0);
  coreLightLow.matrixAutoUpdate = false;
  coreLightLow.updateMatrix();
  group.add(coreLightLow);
  disposables.push(coreLightLow);

  const coreLightMid = mobile ? null : new PointLight("#5ee4ff", 22, 18, 1.6);
  if (coreLightMid) {
    coreLightMid.position.set(0, 6.2, 0);
    coreLightMid.matrixAutoUpdate = false;
    coreLightMid.updateMatrix();
    group.add(coreLightMid);
    disposables.push(coreLightMid);
  }
  const ceilingLight = mobile ? null : new PointLight("#ffcf92", 18, 28, 1.4);
  if (ceilingLight) {
    ceilingLight.position.set(0, 17.6, 0);
    ceilingLight.matrixAutoUpdate = false;
    ceilingLight.updateMatrix();
    group.add(ceilingLight);
    disposables.push(ceilingLight);
  }

  // 1. Living Reflecting Pool Water Shader (upgrades `WaterSurface` node from GLB)
  let waterMat: MeshStandardNodeMaterial | undefined;
  const waterNode = model.getObjectByName("WaterSurface");
  if (waterNode) {
    waterMat = new MeshStandardNodeMaterial({
      color: new Color("#092832"),
      metalness: 0.16,
      roughness: 0.05,
    });
    waterMat.envMapIntensity = 1.9;
    const wp = positionWorld.xz;
    const waveA = sin(wp.x.mul(3.4).add(wp.y.mul(2.1)).add(uTime.mul(1.65)));
    const waveB = cos(wp.x.mul(-2.7).add(wp.y.mul(3.8)).sub(uTime.mul(1.25)));
    const waveC = sin(wp.x.mul(6.2).sub(wp.y.mul(5.4)).add(uTime.mul(2.3)));
    const ripple = waveA.mul(0.45).add(waveB.mul(0.35)).add(waveC.mul(0.20));
    const caustic = pow(ripple.mul(0.5).add(0.5), float(3.2));
    waterMat.roughnessNode = float(0.045).add(ripple.abs().mul(0.055));
    waterMat.emissiveNode = vec3(0.08, 0.42, 0.56).mul(caustic.mul(0.42).add(0.08)).mul(uHoloBoost);
    disposables.push(waterMat);
    const detachedWater = new Set<MeshStandardMaterial>();
    waterNode.traverse(o => {
      if (!(o instanceof Mesh)) return;
      if (o.material instanceof MeshStandardMaterial) detachedWater.add(o.material);
      o.material = waterMat!;
    });
    for (const m of detachedWater) disposables.push(m);
  }

  // 2. Living Holographic Data Core Collar Shader (upgrades `HoloCoreFX` node from GLB)
  const holoNode = model.getObjectByName("HoloCoreFX");
  if (holoNode) {
    const holoMat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const st = uv();
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(normalView, positionViewDirection))), 0.0, 1.0), float(1.35));
    const scanline = sin(st.y.mul(84.0).sub(uTime.mul(5.0).mul(uPulseSpeed))).mul(0.5).add(0.5);
    const cols = pow(sin(st.x.mul(76.0).add(uTime.mul(0.85).mul(uPulseSpeed))).mul(0.5).add(0.5), float(2.4));
    const pulse = pow(sin(st.y.mul(3.14159).sub(uTime.mul(0.75).mul(uPulseSpeed))).abs(), float(2.8));
    const edgeFade = smoothstep(float(0.0), float(0.14), st.y).mul(smoothstep(float(1.0), float(0.86), st.y));
    const holoCol = mix(uCoreColor, uCoreHighlight, pulse.mul(0.55).add(fresnel.mul(0.30)));
    const alpha = edgeFade.mul(fresnel.mul(0.46).add(scanline.mul(cols).mul(0.28)).add(pulse.mul(0.22)).add(0.10)).mul(uHoloBoost).mul(uCoreIntensity);
    holoMat.colorNode = holoCol.mul(float(1.15).add(pulse.mul(0.65))).mul(uCoreIntensity);
    holoMat.opacityNode = clamp(alpha, 0.0, 0.88);
    disposables.push(holoMat);
    const detachedHolo = new Set<MeshStandardMaterial>();
    holoNode.traverse(o => {
      if (!(o instanceof Mesh)) return;
      if (o.material instanceof MeshStandardMaterial) detachedHolo.add(o.material);
      o.material = holoMat;
    });
    for (const m of detachedHolo) disposables.push(m);
  }

  // Two delicate counter-rotating holographic telemetry rings orbiting the central core
  const ringMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const rUv = uv();
  const dash = smoothstep(float(0.25), float(0.65), sin(rUv.x.mul(36.0).add(uTime.mul(1.8).mul(uPulseSpeed))).mul(0.5).add(0.5));
  ringMat.colorNode = mix(uCoreColor, uCoreHighlight, float(0.22)).mul(uHoloBoost).mul(uCoreIntensity);
  ringMat.opacityNode = clamp(dash.mul(0.34).add(0.10).mul(uCoreIntensity), 0.0, 0.85);
  disposables.push(ringMat);

  const orbitalRings: { mesh: Mesh; speed: number }[] = [];
  for (const [rIn, rOut, y, speed] of [[2.88, 2.94, 6.32, 0.24], [3.58, 3.63, 10.18, -0.18]] as const) {
    const geo = new RingGeometry(rIn, rOut, 96, 1);
    geo.rotateX(-Math.PI / 2);
    // Replace planar UVs with polar angle UV so dashes wrap cleanly around the ring
    const pos = geo.getAttribute("position");
    const uvs = geo.getAttribute("uv");
    for (let i = 0; i < pos.count; i++) {
      const ang = (Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI) / (2 * Math.PI);
      uvs.setXY(i, ang, i % 2);
    }
    const mesh = new Mesh(geo, ringMat);
    mesh.position.y = y;
    group.add(mesh);
    disposables.push(geo);
    orbitalRings.push({ mesh, speed });
  }

  // 3. Volumetric Skylight God-Rays (single merged draw call, Fresnel edge-softened!)
  if (!mobile) {
    const shafts: BufferGeometry[] = [];
    // Main grand oculus sun-cone + 4 subtle outer skylight sunbeams tilted along Nishita sun angle
    const specs: [number, number, number, number, number, number, number][] = [
      // topR, botR, height, cx, cy, cz, tiltZ
      [4.55, 7.6, 16.5, 0.4, 10.6, -0.5, 0.14],
      [2.2, 4.4, 15.8, -6.4, 11.2, -5.2, 0.22],
      [2.2, 4.4, 15.8, 6.2, 11.2, -5.4, 0.22],
      [2.0, 4.1, 15.8, -5.8, 11.2, 5.8, 0.22],
      [2.0, 4.1, 15.8, 5.8, 11.2, 5.6, 0.22],
    ];
    for (const [topR, botR, h, cx, cy, cz, tilt] of specs) {
      const cyl = new CylinderGeometry(topR, botR, h, 36, 1, true);
      cyl.rotateZ(-tilt);
      cyl.rotateX(tilt * 0.65);
      cyl.translate(cx, cy, cz);
      shafts.push(cyl);
    }
    const mergedShafts = mergeGeometries(shafts);
    shafts.forEach(g => g.dispose());
    if (mergedShafts) {
      const rayMat = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      const ruv = uv();
      const vFade = smoothstep(float(0.0), float(0.32), ruv.y).mul(smoothstep(float(1.0), float(0.76), ruv.y));
      const softEdge = pow(abs(dot(normalView, positionViewDirection)), float(2.1));
      const shimmer = sin(ruv.x.mul(18.0).add(uTime.mul(0.28))).mul(0.14).add(0.86);
      rayMat.colorNode = uGodRayColor;
      rayMat.opacityNode = vFade.mul(softEdge).mul(shimmer).mul(uGodRayOpacity);
      const rayMesh = new Mesh(mergedShafts, rayMat);
      rayMesh.matrixAutoUpdate = false;
      rayMesh.updateMatrix();
      rayMesh.frustumCulled = false;
      rayMesh.renderOrder = 3;
      group.add(rayMesh);
      disposables.push(mergedShafts, rayMat);
    }
  }

  // 4. Floating Atmospheric Light Motes (single draw call GPU points drifting in the sunlit void)
  {
    const count = mobile ? 120 : 320;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 2.2 + Math.sqrt(Math.random()) * 17.5;
      positions[i * 3] = Math.sin(ang) * rad;
      positions[i * 3 + 1] = 1.4 + Math.random() * 17.2;
      positions[i * 3 + 2] = Math.cos(ang) * rad;
    }
    const moteGeo = new BufferGeometry();
    moteGeo.setAttribute("position", new BufferAttribute(positions, 3));
    const moteMat = new PointsNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      size: mobile ? 3.0 : 4.2,
      sizeAttenuation: true,
    });
    const localPos = positionLocal;
    const driftY = localPos.y.add(uTime.mul(0.24)).mod(float(17.5)).add(1.2);
    const swayX = localPos.x.add(sin(uTime.mul(0.45).add(localPos.y.mul(0.7))).mul(0.22));
    const swayZ = localPos.z.add(cos(uTime.mul(0.38).add(localPos.x.mul(0.7))).mul(0.22));
    moteMat.positionNode = vec3(swayX, driftY, swayZ);
    const twinkle = sin(uTime.mul(1.8).add(localPos.x.mul(2.1)).add(localPos.z.mul(1.7))).mul(0.35).add(0.65);
    moteMat.colorNode = uMoteColor;
    moteMat.opacityNode = twinkle.mul(uMoteOpacity);
    const motes = new Points(moteGeo, moteMat);
    motes.matrixAutoUpdate = false;
    motes.updateMatrix();
    motes.frustumCulled = false;
    group.add(motes);
    disposables.push(moteGeo, moteMat);
  }

  // Smooth Atmosphere Mood & Index-Reactive Central Neon Controller
  let targetMood: AtriumMood = "daylight";
  let targetChangePct = 0;
  const targetCorePrimary = new Color("#5ee4ff");
  const targetCoreHighlight = new Color("#d2f8ff");
  const targetCoreGlass = new Color("#94d8ec");
  const curCorePrimary = new Color("#5ee4ff");
  const curCoreHighlight = new Color("#d2f8ff");
  const curCoreGlass = new Color("#94d8ec");
  let targetCoreIntensity = 1.0;
  let targetCoreStrength = 0.0;
  let curCoreIntensity = 1.0;
  let curCoreStrength = 0.0;

  const curBg = new Color(MOODS.daylight.bg);
  const curSky = new Color(MOODS.daylight.sky);
  const curGround = new Color(MOODS.daylight.ground);
  const curSkylight = new Color(MOODS.daylight.skylightColor);
  const curWindow = new Color(MOODS.daylight.windowColor);
  const curGodRay = new Color(MOODS.daylight.godRayColor);
  const curMote = new Color(MOODS.daylight.moteColor);
  let curExposure = MOODS.daylight.exposure;
  let curHemi = MOODS.daylight.hemi;
  let curEnv = MOODS.daylight.envIntensity;
  let curLmMul = MOODS.daylight.lightmapMul;
  let curSkyEmit = MOODS.daylight.skylightEmit;
  let curWinEmit = MOODS.daylight.windowEmit;
  let curCoveMul = MOODS.daylight.coveMul;
  let curGodOp = MOODS.daylight.godRayOpacity;
  let curHolo = MOODS.daylight.holoBoost;
  let curMoteOp = MOODS.daylight.moteOpacity;
  const tmpColor = new Color();

  let moodDirty = true;

  function refreshTargetSignal() {
    const res = coreSignalForChange(targetChangePct, targetCorePrimary, targetCoreHighlight, targetCoreGlass);
    targetCoreIntensity = res.intensity;
    targetCoreStrength = res.strength;
    moodDirty = true;
  }

  function applyMood(blend: number, nowSec: number) {
    const spec = MOODS[targetMood];
    const k = clampVal(blend, 0, 1);

    // Only touch the 35+ lightmapped/emitter materials while transitioning between moods/quotes (~0.6s);
    // once converged, skip them completely for 0.00ms steady-state CPU overhead!
    if (moodDirty) {
      curExposure += (spec.exposure - curExposure) * k;
      curHemi += (spec.hemi - curHemi) * k;
      curEnv += (spec.envIntensity - curEnv) * k;
      curLmMul += (spec.lightmapMul - curLmMul) * k;
      curSkyEmit += (spec.skylightEmit - curSkyEmit) * k;
      curWinEmit += (spec.windowEmit - curWinEmit) * k;
      curCoveMul += (spec.coveMul - curCoveMul) * k;
      curGodOp += (spec.godRayOpacity - curGodOp) * k;
      curHolo += (spec.holoBoost - curHolo) * k;
      curMoteOp += (spec.moteOpacity - curMoteOp) * k;

      curCoreIntensity += (targetCoreIntensity - curCoreIntensity) * k;
      curCoreStrength += (targetCoreStrength - curCoreStrength) * k;
      curCorePrimary.lerp(targetCorePrimary, k);
      curCoreHighlight.lerp(targetCoreHighlight, k);
      curCoreGlass.lerp(targetCoreGlass, k);

      curBg.lerp(tmpColor.set(spec.bg), k);
      curSky.lerp(tmpColor.set(spec.sky), k);
      curGround.lerp(tmpColor.set(spec.ground), k);
      curSkylight.lerp(tmpColor.set(spec.skylightColor), k);
      curWindow.lerp(tmpColor.set(spec.windowColor), k);
      curGodRay.lerp(tmpColor.set(spec.godRayColor), k);
      curMote.lerp(tmpColor.set(spec.moteColor), k);

      renderer.toneMappingExposure = curExposure;
      if (scene.background instanceof Color) scene.background.copy(curBg);
      hemiLight.color.copy(curSky);
      hemiLight.groundColor.copy(curGround);
      hemiLight.intensity = curHemi;
      scene.environmentIntensity = curEnv;

      for (const item of lightmapped) item.mat.lightMapIntensity = item.base * curLmMul;
      for (const item of trackedEmits) {
        if (item.kind === "skylight") {
          item.mat.emissive.copy(curSkylight);
          item.mat.emissiveIntensity = curSkyEmit;
        } else if (item.kind === "window") {
          item.mat.emissive.copy(curWindow);
          item.mat.emissiveIntensity = curWinEmit;
        } else {
          item.mat.emissiveIntensity = item.base * curCoveMul;
        }
      }

      uCoveWarmMul.value = curCoveMul;
      uCoreColor.value.copy(curCorePrimary);
      uCoreHighlight.value.copy(curCoreHighlight);
      uCoreStrength.value = curCoreStrength;
      uPulseSpeed.value = 1.0 + curCoreStrength * 1.15;
      uGodRayColor.value.copy(curGodRay).lerp(curCorePrimary, curCoreStrength * (targetMood === "night" ? 0.65 : 0.25));
      uGodRayOpacity.value = curGodOp * (1.0 + curCoreStrength * 0.25);
      uHoloBoost.value = curHolo;
      uMoteColor.value.copy(curMote).lerp(curCorePrimary, curCoreStrength * 0.55);
      uMoteOpacity.value = curMoteOp;

      if (
        Math.abs(spec.exposure - curExposure) < 0.0008 &&
        Math.abs(spec.lightmapMul - curLmMul) < 0.0008 &&
        Math.abs(targetCoreIntensity - curCoreIntensity) < 0.001 &&
        Math.abs(targetCoreStrength - curCoreStrength) < 0.001
      ) {
        moodDirty = false;
      }
    }

    // Subtle organic breathing pulse whose amplitude & tempo respond to index move strength
    const breath = 1.0 + Math.sin(nowSec * (1.8 + curCoreStrength * 2.4)) * (0.04 + curCoreStrength * 0.12);
    const liveEmitMul = curCoreIntensity * curHolo * breath;

    for (const item of trackedCore) {
      if (item.role === "glass") {
        item.mat.color.copy(curCoreGlass);
      } else if (item.role === "filamentW") {
        item.mat.color.copy(curCoreHighlight);
        item.mat.emissive.copy(curCoreHighlight);
        item.mat.emissiveIntensity = item.baseEmit * (0.9 + (liveEmitMul - 1.0) * 0.85);
      } else {
        item.mat.color.copy(curCorePrimary);
        item.mat.emissive.copy(curCorePrimary);
        item.mat.emissiveIntensity = item.baseEmit * liveEmitMul;
      }
    }

    const spillBoost = 0.65 + curCoreStrength * 2.4;
    coreLightLow.color.copy(curCorePrimary);
    coreLightLow.intensity = (mobile ? 22 : 12) * spillBoost * curHolo * breath;
    if (coreLightMid) {
      coreLightMid.color.copy(curCorePrimary);
      coreLightMid.intensity = 18 * spillBoost * curHolo * breath;
    }

    // Ceiling coves (oculus halos + 12 radial roof ribs + 12 vaulted arches) shift smoothly from warm 3000K
    // at 0% flat into rich crimson (rise) or electric cobalt blue (drop), intensifying with move size!
    const ceilBlend = clampVal(0.28 + curCoreStrength * 0.72, 0, 1);
    if (curCoreStrength < 0.02) {
      uCeilingColor.value.copy(C_WARM_CEILING);
      uCeilingIntensity.value = 4.4 * curCoveMul;
      if (ceilingLight) {
        ceilingLight.color.copy(C_WARM_CEILING);
        ceilingLight.intensity = 10 * curCoveMul;
      }
    } else {
      uCeilingColor.value.copy(C_WARM_CEILING).lerp(curCorePrimary, ceilBlend);
      uCeilingIntensity.value = 4.4 * curCoveMul * curCoreIntensity * breath;
      if (ceilingLight) {
        ceilingLight.color.copy(curCorePrimary);
        ceilingLight.intensity = (14 + curCoreStrength * 42) * curHolo * breath;
      }
    }
    uCoreIntensity.value = curCoreIntensity * breath;
  }

  refreshTargetSignal();
  applyMood(1, 0);

  return {
    group,
    setMood(mood: AtriumMood) {
      if (mood === targetMood) return;
      targetMood = mood;
      moodDirty = true;
    },
    getMood() {
      return targetMood;
    },
    setIndexChange(changePct: number | null | undefined) {
      const next = typeof changePct === "number" && Number.isFinite(changePct) ? changePct : 0;
      if (Math.abs(next - targetChangePct) < 1e-4) return;
      targetChangePct = next;
      refreshTargetSignal();
    },
    setEnvironment(env: Texture) {
      if (waterMat) {
        waterMat.envMap = env;
        waterMat.needsUpdate = true;
      }
    },
    tick(now: number, dt: number, reduced: boolean) {
      const nowSec = now * 0.001;
      if (!reduced) {
        uTime.value = nowSec;
        const speedMul = 1.0 + curCoreStrength * 0.85;
        for (const ring of orbitalRings) ring.mesh.rotation.y += ring.speed * speedMul * dt;
      }
      applyMood(1 - Math.exp(-dt * 4.2), reduced ? 0 : nowSec);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

function clampVal(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Smooth Catmull-Rom Architectural Showcase Camera Tour around the Grand Atrium. */
export class ShowcaseTour {
  private posCurve: CatmullRomCurve3;
  private tgtCurve: CatmullRomCurve3;
  private elapsed = 0;
  private readonly duration = 42; // 42-second serene cinematic architectural orbit
  private active = false;
  private readonly pos = new Vector3();
  private readonly tgt = new Vector3();

  constructor() {
    this.posCurve = new CatmullRomCurve3([
      new Vector3(0.0, 2.2, 22.4),     // 1. Grand Entrance axial vista
      new Vector3(11.8, 7.2, 18.8),    // 2. 2F Concept-board sweeping panorama
      new Vector3(16.2, 2.5, 4.5),     // 3. Gliding past sunlit trading pods & reflecting pool
      new Vector3(5.4, 2.6, -9.8),     // 4. Intimate low-angle orbit around holographic core & north big-board
      new Vector3(-13.8, 11.4, -14.2), // 5. 3F gallery vault & diamond champagne-gold feature wall sweep
      new Vector3(-16.0, 15.8, 12.6),  // 6. 4F cathedral skylight & 3-tier oculus dome vista
    ], true, "centripetal", 0.5);

    this.tgtCurve = new CatmullRomCurve3([
      new Vector3(0.0, 6.8, 0.0),
      new Vector3(-0.5, 6.4, -1.2),
      new Vector3(0.0, 5.2, 0.0),
      new Vector3(0.0, 8.2, 0.0),
      new Vector3(0.0, 7.6, 0.0),
      new Vector3(0.0, 11.2, 0.0),
    ], true, "centripetal", 0.5);
  }

  start() { this.active = true; }
  stop() { this.active = false; }
  isActive() { return this.active; }

  step(dt: number): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    if (!this.active) return null;
    this.elapsed = (this.elapsed + dt) % this.duration;
    const u = this.elapsed / this.duration;
    this.posCurve.getPointAt(u, this.pos);
    this.tgtCurve.getPointAt(u, this.tgt);
    const dx = this.tgt.x - this.pos.x;
    const dy = this.tgt.y - this.pos.y;
    const dz = this.tgt.z - this.pos.z;
    const horiz = Math.max(1e-4, Math.hypot(dx, dz));
    // Camera looks along -Z in local frame: yaw = atan2(-dx, -dz)
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, horiz);
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw, pitch };
  }
}
