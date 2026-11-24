/* WebGPU / TSL photorealistic architectural materials, real-time planar marble & pool reflections,
 * 360° parallax Seoul financial-district skyline windows, optical Fresnel glass, 48 rotating index-reactive
 * central neon rods, 3-mood atmosphere controller, and cinematic showcase tour for KOSPIMAP Exchange v6-Ultra. */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color,
  CylinderGeometry, DoubleSide, Group, InstancedMesh, Mesh, MeshStandardMaterial,
  Object3D, PlaneGeometry, PointLight, Points, RingGeometry, Vector3,
  type HemisphereLight, type Scene, type Texture,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PointsNodeMaterial,
  type Node, type WebGPURenderer,
} from "three/webgpu";
import {
  abs, cameraPosition, clamp, cos, dFdx, dFdy, dot, equirectUV, float, fract, log2, max, min, mix,
  mx_fractal_noise_float, mx_noise_float, normalView, normalWorld, normalize, positionLocal, positionViewDirection,
  atan, floor as tslFloor, fwidth, hash, positionWorld, pow, sin, smoothstep, sqrt, step, texture, uniform, uv, vec2, vec3, vec4,
} from "three/tsl";
import { FLOOR } from "./market";
import { createBullCelebrationFX } from "./bullCelebrationFx";

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
  windowGoldenMix: number;
  windowNightMix: number;
  windowExposure: number;
  coveMul: number;
  godRayColor: string;
  godRayOpacity: number;
  holoBoost: number;
  moteColor: string;
  moteOpacity: number;
  reflectBoost: number;
};

const MOODS: Record<AtriumMood, MoodSpec> = {
  daylight: {
    exposure: 0.68,
    bg: "#26303d",
    sky: "#d2d8e0",
    ground: "#342d26",
    hemi: 0.28,
    envIntensity: 0.48,
    lightmapMul: 0.78,
    skylightColor: "#9eb8d4",
    skylightEmit: 0.58,
    windowGoldenMix: 0.0,
    windowNightMix: 0.0,
    windowExposure: 1.22,
    coveMul: 0.68,
    godRayColor: "#e6d8be",
    godRayOpacity: 0.024,
    holoBoost: 0.76,
    moteColor: "#e6d9c0",
    moteOpacity: 0.18,
    reflectBoost: 0.88,
  },
  golden: {
    exposure: 0.64,
    bg: "#282018",
    sky: "#d6a87a",
    ground: "#281c14",
    hemi: 0.24,
    envIntensity: 0.42,
    lightmapMul: 0.60,
    skylightColor: "#c8905c",
    skylightEmit: 0.50,
    windowGoldenMix: 1.0,
    windowNightMix: 0.0,
    windowExposure: 1.16,
    coveMul: 0.82,
    godRayColor: "#dda25a",
    godRayOpacity: 0.038,
    holoBoost: 0.86,
    moteColor: "#deb882",
    moteOpacity: 0.24,
    reflectBoost: 0.94,
  },
  night: {
    exposure: 0.60,
    bg: "#050810",
    sky: "#162848",
    ground: "#090d16",
    hemi: 0.15,
    envIntensity: 0.30,
    lightmapMul: 0.23,
    skylightColor: "#0e1c36",
    skylightEmit: 0.24,
    windowGoldenMix: 0.0,
    windowNightMix: 1.0,
    windowExposure: 1.38,
    coveMul: 0.98,
    godRayColor: "#3c8ed0",
    godRayOpacity: 0.028,
    holoBoost: 1.02,
    moteColor: "#64b6dc",
    moteOpacity: 0.26,
    reflectBoost: 1.0,
  },
};

export type TrackedLightmapMat = { mat: MeshStandardMaterial | MeshPhysicalNodeMaterial; base: number };
type TrackedEmitMat = { mat: MeshStandardMaterial; kind: "skylight" | "cove"; base: number };
type TrackedCoreMat = {
  mat: MeshStandardMaterial | MeshPhysicalNodeMaterial;
  role: "filament" | "filamentW" | "rod" | "well" | "accent" | "glass";
  baseEmit: number;
};

export type AtriumFX = {
  group: Group;
  setMood: (mood: AtriumMood) => void;
  getMood: () => AtriumMood;
  /** Upgrade 1-texture instant-boot skyline material to full 3-mood crossfade fallback once inactive moods load. */
  setFallbackSkylines: (day: Texture, golden: Texture, night: Texture) => void;
  /** Attach (or clear with null) on-demand effective-16K dual-hemisphere skyline textures for the active mood. */
  setHiResSkyline: (mood: AtriumMood | null, texL?: Texture, texR?: Texture) => void;
  setIndexChange: (changePct: number | null | undefined) => void;
  /** Telemetry for >= +3% / >= +4% bull rally celebration pyrotechnics. */
  getCelebrationState: () => { tier: 0 | 1 | 2; activeCeilingSparks: number; rallyBoost: number };
  setEnvironment: (env: Texture) => void;
  /** 2 = full analytical luster, 1 = balanced, 0 = off. */
  setReflectionLevel: (level: 0 | 1 | 2) => void;
  tick: (now: number, dt: number, reduced: boolean) => void;
  dispose: () => void;
};

// Pre-allocated understated luxury color palette (refined architectural sapphire & burgundy — zero eye-strain glare!).
const C_NEUTRAL_PRI = new Color("#5ca6cc");
const C_NEUTRAL_HI = new Color("#b8dce8");
const C_NEUTRAL_GLASS = new Color("#8ab8cc");
const C_RISE_MILD = new Color("#d47482");
const C_RISE_MID = new Color("#c43a4e");
const C_RISE_DEEP = new Color("#a42438");
const C_RISE_HI_MILD = new Color("#e8b8c0");
const C_RISE_HI_DEEP = new Color("#d86e7e");
const C_RISE_GLASS_A = new Color("#c89aa2");
const C_RISE_GLASS_B = new Color("#b85868");
const C_DROP_MILD = new Color("#64a6d8");
const C_DROP_MID = new Color("#3474cc");
const C_DROP_DEEP = new Color("#2256a8");
const C_DROP_HI_MILD = new Color("#b8d4ea");
const C_DROP_HI_DEEP = new Color("#6ea4dc");
const C_DROP_GLASS_A = new Color("#94b8d4");
const C_DROP_GLASS_B = new Color("#5288c4");
const C_WARM_CEILING = new Color("#e8be86");
const C_RALLY_CRIMSON = new Color("#ff1e42");

/** Compute calm, understated central neon core color & intensity multiplier from index % change. */
function coreSignalForChange(pct: number, outPrimary: Color, outHighlight: Color, outGlass: Color) {
  const absPct = Math.abs(pct);
  const raw = clampVal(absPct / 3.5, 0, 1);
  const strength = Math.pow(raw, 0.78);
  const intensity = 0.85 + Math.pow(raw, 0.90) * 0.65;

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
  skyline: { initial: Texture; day?: Texture; golden?: Texture; night?: Texture },
  mainCamera: Object3D,
  screensGroup: Object3D,
): AtriumFX {
  const group = new Group();
  group.name = "AtriumV6FX";
  const disposables: { dispose: () => void }[] = [];
  const envMats: (MeshStandardNodeMaterial | MeshPhysicalNodeMaterial)[] = [];

  const uTime = uniform(0);
  const uGodRayColor = uniform(new Color(MOODS.daylight.godRayColor));
  const uGodRayOpacity = uniform(MOODS.daylight.godRayOpacity);
  const uHoloBoost = uniform(MOODS.daylight.holoBoost);
  const uMoteColor = uniform(new Color(MOODS.daylight.moteColor));
  const uMoteOpacity = uniform(MOODS.daylight.moteOpacity);
  // Real-time analytical marble luster & core floor bounce intensity (0 extra scene passes -> eliminates 333-1117ms freezes!)
  const uReflectStrength = uniform(mobile ? 0.0 : MOODS.daylight.reflectBoost);
  let reflectTierMul = 1.0;

  // Live index-reactive central neon uniforms (Blue on drop <-> Ice-Cyan flat <-> Red on rise)
  const uCoreColor = uniform(new Color("#5ee4ff"));
  const uCoreHighlight = uniform(new Color("#d2f8ff"));
  const uCoreIntensity = uniform(1.0);
  const uCoreStrength = uniform(0.0);
  const uCoveWarmMul = uniform(MOODS.daylight.coveMul);
  const uCeilingColor = uniform(new Color("#ffcc88"));
  const uCeilingIntensity = uniform(4.4);
  const uPulseSpeed = uniform(1.0);

  // Living vaulted skylight & 3-mood futuristic Seoul 360° parallax skyline uniforms
  const uWindowGoldenMix = uniform(MOODS.daylight.windowGoldenMix);
  const uWindowNightMix = uniform(MOODS.daylight.windowNightMix);
  const uWindowExposure = uniform(MOODS.daylight.windowExposure);
  const uSkylightColor = uniform(new Color(MOODS.daylight.skylightColor));
  const uSkylightEmit = uniform(MOODS.daylight.skylightEmit);

  // Keep unused constructor refs clean (zero-pass analytical marble reflection replaces double-render reflector!)
  void mainCamera;
  void screensGroup;

  // ---- B. True 3D Viewing-Angle & Position Parallax 360° Panoramas (Single-Tex Instant Boot + Lazy 3-Mood + 16K) ----
  let skyDayTex = skyline.day ?? skyline.initial;
  let skyGoldenTex = skyline.golden ?? skyline.initial;
  let skyNightTex = skyline.night ?? skyline.initial;
  const windowMeshes: Mesh[] = [];
  let currentEnvMap: Texture | null = null;
  let hiResMood: AtriumMood | null = null;
  let hiResMat: MeshStandardNodeMaterial | null = null;
  let usingHiRes = false;

  const buildWindowSkyCoords = () => {
    // True 1:1 undistorted optical cylindrical/spherical VR projection:
    // Horizontal: 360° -> 16,380 px (45.5 px/deg), Vertical: 90° (-45°..+45°) -> 4,096 px (45.5 px/deg).
    // Exact 1.000 : 1.000 angular pixel scale across the entire skyline (-21°..+32°) -> ZERO stretch up close!
    // Steep downward (-21°..-89.9°) smoothly hands off to a TRUE 3D ray-plane intersected river surface with
    // live wave-perturbed 16K skyline reflections (ZERO waterfall/barcode clamping even looking straight down!).
    // Steep upward (+32°..+89.9°) smoothly hands off to a true 3D Rayleigh zenith sky dome!
    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const eq = equirectUV(viewDir);
    const uSky = eq.x;
    const vRaw = float(0.50).sub(eq.y.sub(0.5).mul(2.0));
    // Soft asymptotic tail outside [0.10, 0.88] guarantees smooth C1 derivatives everywhere on the sphere
    const overBot = max(vRaw.sub(0.88), float(0.0));
    const vBotSoft = float(0.88).add(overBot.div(float(1.0).add(overBot.mul(9.5))));
    const overTop = max(float(0.10).sub(vRaw), float(0.0));
    const vTopSoft = float(0.10).sub(overTop.div(float(1.0).add(overTop.mul(9.5))));
    const vSky = clamp(
      mix(mix(vRaw, vBotSoft, step(float(0.88), vRaw)), vTopSoft, step(vRaw, float(0.10))),
      float(0.008),
      float(0.992),
    );
    return { uSky, vSky, vRaw, viewDir };
  };

  type WindowSkyCoords = ReturnType<typeof buildWindowSkyCoords>;

  const buildVrWaterWave = (viewDir: WindowSkyCoords["viewDir"]) => {
    // True 3D ray-plane intersection with the Hudson River directly beneath the exchange tower:
    // worldXZ = viewDir.xz / max(0.08, -viewDir.y) -> 100% physically foreshortened VR perspective even at -89° straight down!
    const downDenom = max(float(0.08), viewDir.y.negate());
    const wp = viewDir.xz.div(downDenom).mul(9.5);
    // Organic 4-octave 3D fractal noise river ripples (matches real Hudson River wind chop — zero plastic sine stripes!)
    const tDrift = uTime.mul(0.22);
    const nLarge = mx_fractal_noise_float(vec3(wp.x.mul(0.85), wp.y.mul(1.65), tDrift), 3);
    const nFine = mx_noise_float(vec3(wp.x.mul(3.4).add(tDrift), wp.y.mul(6.8).sub(tDrift.mul(0.7)), tDrift.mul(0.6)));
    const h = nLarge.mul(0.70).add(nFine.mul(0.30));
    // Finite-difference-free directional wave slope perturbation for live 16K skyline reflection shimmer
    const dx = mx_noise_float(vec3(wp.x.mul(2.1).add(11.3), wp.y.mul(4.2), tDrift));
    const dz = mx_noise_float(vec3(wp.x.mul(2.1), wp.y.mul(4.2).add(23.7), tDrift.mul(1.15)));
    const nearFade = smoothstep(float(0.38), float(0.78), viewDir.y.negate());
    return { h, dx: dx.mul(nearFade), dz: dz.mul(nearFade), nearFade };
  };

  const applyWindowOutput = (
    wm: MeshStandardNodeMaterial,
    blended: ReturnType<typeof texture>["rgb"],
    reflCol: ReturnType<typeof texture>["rgb"],
    vRaw: WindowSkyCoords["vRaw"],
    viewDir: WindowSkyCoords["viewDir"],
    wave: ReturnType<typeof buildVrWaterWave>,
  ) => {
    // 1. Keep -36°..+45° 100% PURE 125MP REAL PHOTOGRAPHY (zero CG water over the real Hudson River!).
    //    ONLY for steep downward gazes (-36°..-89.9°, vRaw > 0.89) right against the glass, hand off smoothly
    //    to true 3D ray-plane fractal-noise river + live 16K skyline reflections -> ZERO waterfall/barcode clamping!
    const downBlend = smoothstep(float(0.87), float(1.10), vRaw);
    const cosTheta = clamp(viewDir.y.negate(), float(0.0), float(1.0));
    const waterFresnel = float(0.10).add(float(0.90).mul(pow(float(1.0).sub(cosTheta), float(3.0))));
    const deepDay = vec3(0.062, 0.118, 0.178);
    const deepGold = vec3(0.092, 0.106, 0.148);
    const deepNight = vec3(0.010, 0.026, 0.062);
    const deepWater = mix(mix(deepDay, deepGold, uWindowGoldenMix), deepNight, uWindowNightMix);
    const waveShadedDeep = deepWater.mul(float(0.88).add(wave.h.mul(0.26)));
    const crestGlint = pow(clamp(wave.h.mul(0.55).add(0.5), float(0.0), float(1.0)), float(6.0));
    const glintCol = mix(
      mix(vec3(0.28, 0.36, 0.46), vec3(0.42, 0.32, 0.24), uWindowGoldenMix),
      vec3(0.09, 0.16, 0.28),
      uWindowNightMix,
    );
    const vrRiver = mix(waveShadedDeep, reflCol.mul(0.90), waterFresnel).add(glintCol.mul(crestGlint.mul(0.22)));
    const withRiver = mix(blended, vrRiver, downBlend);

    // 2. True 3D VR Rayleigh Zenith Sky Dome ONLY above +42° (vRaw < 0.04) — keeps 100% real 125MP sky & clouds!
    const upBlend = smoothstep(float(0.05), float(-0.22), vRaw);
    const zenDay = vec3(0.110, 0.315, 0.640);
    const zenGold = vec3(0.220, 0.295, 0.510);
    const zenNight = vec3(0.014, 0.042, 0.120);
    const zenithCol = mix(mix(zenDay, zenGold, uWindowGoldenMix), zenNight, uWindowNightMix);
    const sceneCol = mix(withRiver, zenithCol, upBlend.mul(0.85));

    // 3. Ultra-clear low-iron architectural glass: 96%+ crystal-clear straight-on transmission with subtle oblique Fresnel!
    const ndv = clamp(abs(dot(normalView, positionViewDirection)), float(0.0), float(1.0));
    const glassRim = pow(float(1.0).sub(ndv), float(4.6)).mul(0.030);
    const exposed = sceneCol.mul(uWindowExposure);
    // Keep bright night skyscraper lights vivid & razor-sharp while softly capping right under bloom threshold -> ZERO bloom smudge!
    const nightSafe = exposed.div(float(1.0).add(exposed.mul(0.22))).mul(1.20);
    const crispOut = mix(exposed, nightSafe, uWindowNightMix);
    wm.emissiveNode = crispOut.add(vec3(0.66, 0.78, 0.92).mul(glassRim));
  };

  const makeParallaxSkylineWindow = (src?: MeshStandardMaterial, singleTex?: Texture) => {
    // Single-tex instant boot (only 1 skyline downloaded before reveal!) or full 3-mood crossfade material.
    const wm = new MeshStandardNodeMaterial({
      color: new Color("#020408"),
      roughness: 0.03,
      metalness: 0.02,
      envMapIntensity: 0.05,
      side: DoubleSide,
    });
    if (currentEnvMap) wm.envMap = currentEnvMap;
    const { uSky, vSky, vRaw, viewDir } = buildWindowSkyCoords();
    const wave = buildVrWaterWave(viewDir);
    const skyUv = vec2(uSky, vSky);
    // Reflected skyline UV mirrored cleanly across waterline (v = 0.571) with organic wave-slope perturbation
    const uRefl = fract(uSky.add(wave.dx.mul(0.0055)));
    const vRefl = clamp(float(0.571).sub(abs(vRaw.sub(0.571)).mul(0.56)).add(wave.dz.mul(0.026)), float(0.04), float(0.565));
    const reflUv = vec2(uRefl, vRefl);
    if (singleTex) {
      applyWindowOutput(wm, texture(singleTex, skyUv).rgb, texture(singleTex, reflUv).rgb, vRaw, viewDir, wave);
    } else {
      const dayCol = texture(skyDayTex, skyUv).rgb;
      const goldCol = texture(skyGoldenTex, skyUv).rgb;
      const nightCol = texture(skyNightTex, skyUv).rgb;
      const blended = mix(mix(dayCol, goldCol, uWindowGoldenMix), nightCol, uWindowNightMix);
      const rDay = texture(skyDayTex, reflUv).rgb;
      const rGold = texture(skyGoldenTex, reflUv).rgb;
      const rNight = texture(skyNightTex, reflUv).rgb;
      const reflCol = mix(mix(rDay, rGold, uWindowGoldenMix), rNight, uWindowNightMix);
      applyWindowOutput(wm, blended, reflCol, vRaw, viewDir, wave);
    }
    envMats.push(wm);
    if (src) disposables.push(src);
    disposables.push(wm);
    return wm;
  };

  const makeParallaxSkylineWindow16k = (texL: Texture, texR: Texture) => {
    // Dedicated WebGPU MeshStandardNodeMaterial with fresh immutable GPUBindGroup for effective-16K (2x 8192x4096):
    // Continuous analytical seam-free LOD eliminates both u=0 and u=0.5 mip seams while enabling crisp 16K trilinear supersampling!
    const wm = new MeshStandardNodeMaterial({
      color: new Color("#020408"),
      roughness: 0.03,
      metalness: 0.02,
      envMapIntensity: 0.05,
      side: DoubleSide,
    });
    if (currentEnvMap) wm.envMap = currentEnvMap;
    const { uSky, vSky, vRaw, viewDir } = buildWindowSkyCoords();
    const wave = buildVrWaterWave(viewDir);
    const uWrapped = fract(uSky);
    const isRight = step(float(0.5), uWrapped);
    const uLocal = mix(uWrapped.mul(2.0), uWrapped.sub(0.5).mul(2.0), isRight);
    // Exact 1px circular overlap gutter mapping (8190 unique cols + 2px gutter = 8192):
    const uTile = uLocal.mul(8190.0 / 8192.0).add(1.0 / 8192.0);
    const tileUv = vec2(uTile, vSky);

    // 100% continuous screen-space derivatives across BOTH u=0 (-X) and u=0.5 (+X) -> zero mip seam anywhere in 360°!
    const uA = uSky;
    const uB = fract(uSky.add(0.5));
    const dUdx = min(abs(dFdx(uA)), abs(dFdx(uB))).mul(16380.0);
    const dUdy = min(abs(dFdy(uA)), abs(dFdy(uB))).mul(16380.0);
    const dVdx = abs(dFdx(vSky)).mul(4096.0);
    const dVdy = abs(dFdy(vSky)).mul(4096.0);
    const rho = max(
      sqrt(dUdx.mul(dUdx).add(dVdx.mul(dVdx))),
      sqrt(dUdy.mul(dUdy).add(dVdy.mul(dVdy))),
    );
    // -0.72 crisp negative mip bias: tack-sharp skyscraper window mullions & bridge cables up close with smooth anti-shimmering!
    const lod = clamp(log2(max(rho, float(1.0))).sub(0.72), float(0.0), float(4.0));

    const hiL = texture(texL, tileUv, lod).rgb;
    const hiR = texture(texR, tileUv, lod).rgb;
    const blended = mix(hiL, hiR, isRight);

    // Soft wave-perturbed live 16K reflection tap for steep downward VR river view (waterline v = 0.571)
    const uReflW = fract(uSky.add(wave.dx.mul(0.0055)));
    const isReflR = step(float(0.5), uReflW);
    const uReflLocal = mix(uReflW.mul(2.0), uReflW.sub(0.5).mul(2.0), isReflR);
    const uReflTile = uReflLocal.mul(8190.0 / 8192.0).add(1.0 / 8192.0);
    const vRefl = clamp(float(0.571).sub(abs(vRaw.sub(0.571)).mul(0.56)).add(wave.dz.mul(0.026)), float(0.04), float(0.565));
    const reflUv = vec2(uReflTile, vRefl);
    const reflLod = clamp(lod.add(2.0), float(1.5), float(5.0));
    const reflCol = mix(texture(texL, reflUv, reflLod).rgb, texture(texR, reflUv, reflLod).rgb, isReflR);

    applyWindowOutput(wm, blended, reflCol, vRaw, viewDir, wave);
    return wm;
  };

  const bindWindowMaterial = (mat: MeshStandardNodeMaterial) => {
    for (const mesh of windowMeshes) {
      mesh.material = mat;
    }
  };

  // ---- B2. Living Atmospheric Vaulted Skylight Dome (drifting wispy cirrus clouds + directional sunlit warmth!) ----
  let skylightMatCache: MeshStandardNodeMaterial | null = null;
  const makeAtmosphericSkylight = (src: MeshStandardMaterial) => {
    const sm = new MeshStandardNodeMaterial({
      color: new Color("#101824"),
      roughness: 0.14,
      metalness: 0.02,
    });
    const domePos = positionWorld.xz.mul(0.055);
    const drift = vec2(uTime.mul(0.008), uTime.mul(0.004));
    // 2-octave FBM saves ~33% ALU across the vaulted skylight dome while preserving soft wispy cloud motion!
    const cloudA = mx_fractal_noise_float(domePos.add(drift), 2, 2.0, 0.52, 1.0);
    const cloudMask = smoothstep(float(-0.12), float(0.55), cloudA);
    // Directional warm sunlit haze matching Cycles sun azimuth (36 deg)
    const radialDir = normalize(positionWorld.xz.add(vec2(0.001, 0.001)));
    const sunDot = clamp(dot(radialDir, vec2(0.58, 0.81)).mul(0.5).add(0.5), float(0.0), float(1.0));
    const sunHaze = pow(sunDot, float(3.0)).mul(float(1.0).sub(uWindowNightMix));
    const skyBase = uSkylightColor.mul(float(0.82).add(cloudMask.mul(0.32)));
    const skyWithSun = skyBase.add(vec3(0.42, 0.34, 0.22).mul(sunHaze.mul(0.55)));
    sm.emissiveNode = skyWithSun.mul(uSkylightEmit);
    disposables.push(sm, src);
    return sm;
  };

  // ---- C. Physical Polished Marble with Honed Stone Micro-Grain Planar Reflection (exclusively on shell Calacatta!) ----
  const marbleNodeCache = new Map<string, MeshPhysicalNodeMaterial>();
  const luminance3 = (c: Node<"vec3">) => dot(c, vec3(.2126, .7152, .0722));
  const makeReflectiveMarble = (src: MeshStandardMaterial, isDark: boolean) => {
    const cached = marbleNodeCache.get(src.uuid);
    if (cached) return cached;
    const pm = new MeshPhysicalNodeMaterial({
      color: src.color.clone().multiplyScalar(isDark ? 0.84 : 0.72),
      map: src.map,
      normalMap: src.normalMap,
      normalScale: src.normalScale.clone().multiplyScalar(1.28),
      roughnessMap: src.roughnessMap,
      roughness: isDark ? Math.max(0.20, src.roughness * 0.82) : Math.max(0.22, src.roughness * 0.84),
      metalness: src.metalness,
      lightMap: src.lightMap,
      lightMapIntensity: src.lightMapIntensity,
      clearcoat: isDark ? 0.62 : 0.56,
      clearcoatRoughness: isDark ? 0.12 : 0.13,
      envMapIntensity: isDark ? 0.82 : 0.72,
    });
    // Zero-extra-pass analytical honed Calacatta marble reflection sheen + live central-core & ceiling bounce glow!
    // Saves ~140 draw calls, ~270K triangles, 30MB RT VRAM, and completely eliminates reflector pipeline freezes!
    if (!isDark && src.userData.isFloorShell === true) {
      const floorYMask = smoothstep(float(0.065), float(0.012), positionWorld.y);
      const upMask = smoothstep(float(0.75), float(0.96), normalWorld.y);
      const ndv = clamp(abs(dot(normalView, positionViewDirection)), 0.0, 1.0);
      const fresnel = float(0.10).add(pow(float(1.0).sub(ndv), float(3.2)).mul(0.38));
      const stoneGrain = mx_noise_float(positionWorld.xz.mul(2.4), 0.16, 0.92);
      const distR = positionWorld.xz.length();
      const corePool = smoothstep(float(18.5), float(2.8), distR);
      const domeRing = smoothstep(float(25.0), float(7.5), distR).mul(smoothstep(float(3.2), float(8.5), distR));
      const coreBounce = uCoreColor.mul(corePool.mul(0.28).mul(uCoreIntensity));
      const ceilBounce = uCeilingColor.mul(domeRing.mul(0.045).mul(uCeilingIntensity));
      const reflMask = floorYMask.mul(upMask).mul(fresnel).mul(stoneGrain).mul(uReflectStrength);
      pm.emissiveNode = coreBounce.add(ceilBounce).mul(reflMask);
    }
    // Laid stone: level floors become radial large-format slabs (1.2 m rings, ~1.25 m arcs) with 2.5 mm joints.
    // Every slab shows a different cut of the block and a slight shade difference, as real quarried stone does;
    // walls, counters and columns keep their modelled UVs. Joints are matte and do not mirror the hall.
    const levelFloor = smoothstep(float(0.8), float(0.97), normalWorld.y);
    let jointOpen: Node<"float"> = float(0);
    if (src.map) {
      const ring = 1.2, arc = 1.25, joint = .00125;
      const xz = positionWorld.xz;
      const radius = xz.length();
      const ringPos = radius.div(ring);
      const ringIdx = tslFloor(ringPos);
      const segments = tslFloor(ringIdx.add(.5).mul(ring * 2 * Math.PI / arc)).max(6);
      const theta = atan(xz.y, xz.x).div(2 * Math.PI).add(.5);
      const segPos = theta.mul(segments);
      const segIdx = tslFloor(segPos);
      const radialEdge = min(fract(ringPos), float(1).sub(fract(ringPos))).mul(ring);
      const arcLen = radius.mul(2 * Math.PI).div(segments);
      const arcEdge = min(fract(segPos), float(1).sub(fract(segPos))).mul(arcLen);
      const edge = min(radialEdge, arcEdge);
      const aa = fwidth(edge).max(1e-5);
      const centre = smoothstep(float(1.15), float(1.3), radius);            // no joints in the core well
      jointOpen = float(1).sub(smoothstep(float(joint), float(joint).add(aa.mul(1.5)), edge)).mul(centre).mul(levelFloor);
      const seed = ringIdx.mul(97.0).add(segIdx).add(isDark ? 7000 : 0);
      const h1 = hash(seed), h2 = hash(seed.add(13.1)), h3 = hash(seed.add(29.7));
      const slabUv = xz.div(1.5).add(vec2(h1, h2).mul(9.0));
      const cut = texture(src.map, slabUv).rgb;
      const modelledTex = texture(src.map);
      modelledTex.updateMatrix = true;
      const modelled = modelledTex.rgb;
      const base = mix(modelled, cut, levelFloor);
      // Calacatta: warm white ground, crisper grey veins; Emperador keeps its own palette, just a touch richer.
      const graded = isDark
        ? base.mul(float(.94).add(h3.mul(.12)))
        : mix(vec3(luminance3(base)), base, 1.1).sub(.86).mul(1.24).add(.86).mul(vec3(1.0, .985, .955)).mul(float(.965).add(h3.mul(.07)));
      const grout = vec3(isDark ? .05 : .44, isDark ? .045 : .42, isDark ? .04 : .39);
      const tint = src.color.clone().multiplyScalar(isDark ? 0.84 : 0.72);
      pm.colorNode = mix(graded.clamp(0, 1), grout, jointOpen).mul(vec3(tint.r, tint.g, tint.b));
      pm.roughnessNode = mix(float(pm.roughness), float(.85), jointOpen);
      pm.clearcoatNode = mix(float(pm.clearcoat), float(0), jointOpen);
    }
    // Screen-space reflections key off clearcoat (see floorEngine): joints carry none, so they stay matte.
    for (const entry of lightmapped) {
      if (entry.mat === src) entry.mat = pm;
    }
    envMats.push(pm);
    disposables.push(pm, src);
    marbleNodeCache.set(src.uuid, pm);
    return pm;
  };

  // ---- D. Optical Low-Iron Architectural Glass (Elevators, Gallery Balustrades, Central Crystal Core) ----
  const glassNodeCache = new Map<string, MeshPhysicalNodeMaterial>();
  const makeArchitecturalGlass = (src: MeshStandardMaterial, isCore: boolean) => {
    const cached = glassNodeCache.get(src.uuid);
    if (cached) return cached;
    const gm = new MeshPhysicalNodeMaterial({
      color: new Color(isCore ? "#a2dcf2" : "#dff2f4"),
      roughness: 0.035,
      metalness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.035,
      envMapIntensity: isCore ? 2.4 : 2.25,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const ndv = clamp(abs(dot(normalView, positionViewDirection)), 0.0, 1.0);
    const edge = pow(float(1.0).sub(ndv), float(2.5));
    gm.opacityNode = float(isCore ? 0.09 : 0.075).add(edge.mul(isCore ? 0.36 : 0.38));
    gm.emissiveNode = isCore
      ? uCoreColor.mul(edge.mul(0.32).mul(uCoreIntensity))
      : vec3(0.46, 0.78, 0.85).mul(edge.mul(0.16));
    envMats.push(gm);
    disposables.push(gm, src);
    glassNodeCache.set(src.uuid, gm);
    return gm;
  };

  // Track architectural emitter & central neon core materials for smooth real-time transitions
  const trackedEmits: TrackedEmitMat[] = [];
  const trackedCore: TrackedCoreMat[] = [];
  const seenEmit = new Set<string>();
  const seenCore = new Set<string>();
  const coveNodeCache = new Map<string, MeshStandardNodeMaterial>();
  let windowMatCache: MeshStandardNodeMaterial | null = null;
  const ceilingNeonPts: number[] = [];
  let pillarCrownMaxY = 0;
  const harvestV = new Vector3();

  const makeCeilingReactiveCove = (src: MeshStandardMaterial, baseEmit: number) => {
    const cached = coveNodeCache.get(src.uuid);
    if (cached) return cached;
    const nm = new MeshStandardNodeMaterial({
      color: src.color.clone(),
      roughness: src.roughness,
      metalness: src.metalness,
    });
    // Mask strictly to the vaulted atrium ceiling: oculus halos + 12 radial roof ribs + 12 vaulted arches
    const yMask = smoothstep(float(15.4), float(16.1), positionWorld.y);
    const rDist = positionWorld.xz.length();
    const rMask = smoothstep(float(23.6), float(22.0), rDist);
    const ceilingMask = yMask.mul(rMask);

    const warmRgb = vec3(src.emissive.r, src.emissive.g, src.emissive.b).mul(float(baseEmit)).mul(uCoveWarmMul);
    const ceilRgb = uCeilingColor.mul(uCeilingIntensity);
    nm.emissiveNode = mix(warmRgb, ceilRgb, ceilingMask);
    disposables.push(nm, src);
    coveNodeCache.set(src.uuid, nm);
    return nm;
  };

  // ---- E. Lightweight In-Place PBR Surface Relief (zero extra MeshPhysical shader cost -> silky 60fps panning!) ----
  const tunedTactile = new Set<string>();
  const tuneTactileSurface = (m: MeshStandardMaterial, kind: "fabric" | "wood" | "leather" | "stone") => {
    if (tunedTactile.has(m.uuid)) return;
    tunedTactile.add(m.uuid);
    if (kind === "fabric") {
      m.normalScale.multiplyScalar(1.55);
      m.roughness = Math.min(0.95, m.roughness * 1.04);
      m.envMapIntensity = 0.28;
    } else if (kind === "leather") {
      m.normalScale.multiplyScalar(1.45);
      m.roughness = Math.max(0.28, m.roughness * 0.84);
      m.envMapIntensity = 0.68;
    } else if (kind === "wood") {
      m.normalScale.multiplyScalar(1.36);
      m.roughness = Math.max(0.30, m.roughness * 0.90);
      m.envMapIntensity = 0.56;
    } else {
      m.normalScale.multiplyScalar(1.36);
    }
  };

  model.traverse(child => {
    if (!(child instanceof Mesh)) return;
    // Enable Layer 1 (planar floor reflection) ONLY on macro shell, emit & holo core (skip heavy props/fixtures!)
    let curObj: Object3D | null = child;
    let inReflectLayer = false;
    while (curObj) {
      if (curObj.name === "shell" || curObj.name === "emit" || curObj.name === "HoloCoreFX") {
        inReflectLayer = true;
        break;
      }
      curObj = curObj.parent;
    }
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    // Never double-render heavy 16K dual-hemisphere skyline windows or FBM skylight dome inside the planar floor reflector!
    const skipReflectMesh = mats.some(m => m instanceof MeshStandardMaterial && /perimeter daylight window|daylight glazing/i.test(m.name));
    if (inReflectLayer && !skipReflectMesh) child.layers.enable(1);

    let replaced = false;
    const nextMats = mats.map(m => {
      if (!(m instanceof MeshStandardMaterial)) return m;
      if (/warm 3000k cove|soft warm accent/i.test(m.name)) {
        replaced = true;
        // Harvest exact 3D world-space vertices of vaulted ceiling neon lines so gold/silver sparks rain directly from them!
        const posAttr = child.geometry.getAttribute("position");
        if (posAttr && posAttr.count > 0 && ceilingNeonPts.length < 3600) {
          child.updateMatrixWorld(true);
          const stride = Math.max(1, Math.floor(posAttr.count / 180));
          for (let vi = 0; vi < posAttr.count && ceilingNeonPts.length < 3600; vi += stride) {
            harvestV.fromBufferAttribute(posAttr, vi).applyMatrix4(child.matrixWorld);
            const r = Math.hypot(harvestV.x, harvestV.z);
            if (harvestV.y >= 15.4 && r <= 23.0) {
              ceilingNeonPts.push(harvestV.x, harvestV.y, harvestV.z);
              if (r <= 4.8 && harvestV.y > pillarCrownMaxY) pillarCrownMaxY = harvestV.y;
            }
          }
        }
        return makeCeilingReactiveCove(m, Math.max(m.emissiveIntensity, 3.2));
      }
      if (/perimeter daylight window/i.test(m.name)) {
        replaced = true;
        if (!windowMatCache) {
          const hasAll3 = !!(skyline.day && skyline.golden && skyline.night);
          windowMatCache = makeParallaxSkylineWindow(m, hasAll3 ? undefined : skyline.initial);
        }
        if (!windowMeshes.includes(child)) windowMeshes.push(child);
        return windowMatCache;
      }
      if (/daylight glazing/i.test(m.name)) {
        replaced = true;
        if (!skylightMatCache) skylightMatCache = makeAtmosphericSkylight(m);
        return skylightMatCache;
      }
      if (/calacatta light marble|emperador dark marble/i.test(m.name)) {
        replaced = true;
        return makeReflectiveMarble(m, /emperador/i.test(m.name));
      }
      if (/ivory linen weave|throw cushion|slate acoustic fabric|charcoal acoustic carpet/i.test(m.name)) {
        tuneTactileSurface(m, "fabric");
      } else if (/american walnut|light oak veneer|oak floorboards|museum frame walnut|smoked walnut/i.test(m.name)) {
        tuneTactileSurface(m, "wood");
      } else if (/espresso saddle leather/i.test(m.name)) {
        tuneTactileSurface(m, "leather");
      } else if (/architectural warm travertine|museum gallery wall/i.test(m.name)) {
        tuneTactileSurface(m, "stone");
      }
      if (/balustrade glass/i.test(m.name)) {
        replaced = true;
        return makeArchitecturalGlass(m, false);
      }
      if (/core crystal glass/i.test(m.name)) {
        replaced = true;
        const gm = makeArchitecturalGlass(m, true);
        if (!seenCore.has(gm.uuid)) {
          seenCore.add(gm.uuid);
          trackedCore.push({ mat: gm, role: "glass", baseEmit: 0 });
        }
        return gm;
      }
      if (!seenEmit.has(m.uuid)) {
        if (/daylight glazing/i.test(m.name)) {
          seenEmit.add(m.uuid);
          trackedEmits.push({ mat: m, kind: "skylight", base: m.emissiveIntensity });
        } else if (/downlight/i.test(m.name)) {
          seenEmit.add(m.uuid);
          trackedEmits.push({ mat: m, kind: "cove", base: m.emissiveIntensity });
        }
      }
      if (!seenCore.has(m.uuid)) {
        if (/core cyan filament/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "filament", baseEmit: 2.6 });
        } else if (/core white filament/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "filamentW", baseEmit: 3.4 });
        } else if (/core energy rod/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "rod", baseEmit: 1.6 });
        } else if (/core floor light well/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "well", baseEmit: 2.2 });
        } else if (/cyan accent led/i.test(m.name)) {
          seenCore.add(m.uuid);
          trackedCore.push({ mat: m, role: "accent", baseEmit: 1.8 });
        }
      }
      return m;
    });
    if (replaced) child.material = Array.isArray(child.material) ? nextMats : nextMats[0];
  });

  // Live non-shadow central & ceiling bounce lights: 3 on desktop, 1 consolidated light on mobile
  const coreLightLow = new PointLight("#5ee4ff", 14, 16, 1.7);
  coreLightLow.position.set(0, mobile ? 4.2 : 2.2, 0);
  coreLightLow.matrixAutoUpdate = false;
  coreLightLow.updateMatrix();
  coreLightLow.layers.enable(1);
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

  // 1. Living Reflecting Pool Water Shader (real-time planar reflection + animated caustics!)
  const waterNode = model.getObjectByName("WaterSurface");
  if (waterNode) {
    const waterMat = new MeshPhysicalNodeMaterial({
      color: new Color("#051b24"),
      metalness: 0.10,
      roughness: 0.03,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: 2.2,
    });
    const wp = positionWorld.xz;
    const nA = mx_noise_float(wp.mul(1.85).add(vec2(uTime.mul(0.38), uTime.mul(-0.24))), 0.65, 0.0);
    const nB = mx_noise_float(wp.mul(4.1).add(vec2(uTime.mul(-0.52), uTime.mul(0.46))), 0.35, 0.0);
    const ripple = nA.add(nB);
    const caustic = pow(clamp(ripple.mul(0.55).add(0.5), float(0.0), float(1.0)), float(3.2));
    const ndv = clamp(abs(dot(normalView, positionViewDirection)), 0.0, 1.0);
    const waterFresnel = float(0.16).add(pow(float(1.0).sub(ndv), float(3.5)).mul(0.36));
    waterMat.roughnessNode = float(0.028).add(ripple.abs().mul(0.048));
    const causticGlow = vec3(0.05, 0.30, 0.40).mul(caustic.mul(0.38).add(0.05)).mul(uHoloBoost);
    waterMat.emissiveNode = causticGlow.add(vec3(0.04, 0.12, 0.18).mul(waterFresnel));
    envMats.push(waterMat);
    disposables.push(waterMat);
    const detachedWater = new Set<MeshStandardMaterial>();
    waterNode.traverse(o => {
      if (!(o instanceof Mesh)) return;
      if (o.material instanceof MeshStandardMaterial) detachedWater.add(o.material);
      o.material = waterMat;
    });
    for (const m of detachedWater) disposables.push(m);
  }

  // 2. Living Holographic Data Core Collar Shader
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
    const alpha = edgeFade.mul(fresnel.mul(0.32).add(scanline.mul(cols).mul(0.18)).add(pulse.mul(0.14)).add(0.05)).mul(uHoloBoost).mul(uCoreIntensity);
    holoMat.colorNode = holoCol.mul(float(0.75).add(pulse.mul(0.32))).mul(uCoreIntensity);
    holoMat.opacityNode = clamp(alpha, 0.0, 0.52);
    disposables.push(holoMat);
    const detachedHolo = new Set<MeshStandardMaterial>();
    holoNode.traverse(o => {
      if (!(o instanceof Mesh)) return;
      if (o.material instanceof MeshStandardMaterial) detachedHolo.add(o.material);
      o.material = holoMat;
    });
    for (const m of detachedHolo) disposables.push(m);
  }

  // 2b. 48 Individually 360°-Rotating Central Neon Light Rods (2 InstancedMesh draw calls, 0 GC!)
  type RodSpec = { r: number; angle: number; speed: number; yMid: number; height: number; phase: number; highlight: boolean };
  const primarySpecs: RodSpec[] = [];
  const highlightSpecs: RodSpec[] = [];
  let seed = 20261123;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < 48; k++) {
    const highlight = k % 3 === 0;
    const layer = k % 3;
    const r = layer === 0 ? 0.42 + rand() * 0.28 : layer === 1 ? 0.72 + rand() * 0.30 : 1.04 + rand() * 0.32;
    const baseSpeed = layer === 0 ? 0.42 + rand() * 0.28 : layer === 1 ? -(0.28 + rand() * 0.24) : 0.16 + rand() * 0.20;
    const dirFlip = (k % 5 === 0) ? -1 : 1;
    const y0 = 1.05 + rand() * 2.4;
    const y1 = 16.8 + rand() * 2.5;
    const spec: RodSpec = {
      r,
      angle: (k / 48) * Math.PI * 2 + (rand() - 0.5) * 0.12,
      speed: baseSpeed * dirFlip,
      yMid: (y0 + y1) * 0.5,
      height: y1 - y0,
      phase: rand() * Math.PI * 2,
      highlight,
    };
    if (highlight) highlightSpecs.push(spec);
    else primarySpecs.push(spec);
  }
  const rodGeo = new CylinderGeometry(0.017, 0.017, 1.0, 6, 1, false);
  const rodMatPrimary = new MeshStandardMaterial({
    color: new Color("#5ca6cc"),
    emissive: new Color("#5ca6cc"),
    emissiveIntensity: 2.8,
    roughness: 0.20,
    metalness: 0.0,
  });
  const rodMatHighlight = new MeshStandardMaterial({
    color: new Color("#b8dce8"),
    emissive: new Color("#b8dce8"),
    emissiveIntensity: 3.6,
    roughness: 0.20,
    metalness: 0.0,
  });
  const rodsPrimary = new InstancedMesh(rodGeo, rodMatPrimary, primarySpecs.length);
  const rodsHighlight = new InstancedMesh(rodGeo, rodMatHighlight, highlightSpecs.length);
  rodsPrimary.frustumCulled = false;
  rodsHighlight.frustumCulled = false;
  rodsPrimary.layers.enable(1);
  rodsHighlight.layers.enable(1);
  group.add(rodsPrimary, rodsHighlight);
  disposables.push(rodGeo, rodMatPrimary, rodMatHighlight);
  trackedCore.push(
    { mat: rodMatPrimary, role: "filament", baseEmit: 2.8 },
    { mat: rodMatHighlight, role: "filamentW", baseEmit: 3.6 },
  );
  const rodPriArr = rodsPrimary.instanceMatrix.array as Float32Array;
  const rodHiArr = rodsHighlight.instanceMatrix.array as Float32Array;
  function writeRodMatrix(arr: Float32Array, idx: number, angle: number, r: number, y: number, sxz: number, sy: number) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const o = idx * 16;
    arr[o] = c * sxz;     arr[o + 1] = 0;  arr[o + 2] = -s * sxz; arr[o + 3] = 0;
    arr[o + 4] = 0;       arr[o + 5] = sy; arr[o + 6] = 0;        arr[o + 7] = 0;
    arr[o + 8] = s * sxz; arr[o + 9] = 0;  arr[o + 10] = c * sxz; arr[o + 11] = 0;
    arr[o + 12] = s * r;  arr[o + 13] = y; arr[o + 14] = c * r;   arr[o + 15] = 1;
  }
  function updateRotatingRods(dt: number, nowSec: number, speedMul: number) {
    for (let i = 0; i < primarySpecs.length; i++) {
      const s = primarySpecs[i];
      s.angle += s.speed * speedMul * dt;
      writeRodMatrix(rodPriArr, i, s.angle, s.r, s.yMid + Math.sin(nowSec * 1.4 + s.phase) * 0.14, 1.05, s.height);
    }
    rodsPrimary.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < highlightSpecs.length; i++) {
      const s = highlightSpecs[i];
      s.angle += s.speed * speedMul * dt;
      writeRodMatrix(rodHiArr, i, s.angle, s.r, s.yMid + Math.cos(nowSec * 1.65 + s.phase) * 0.16, 0.82, s.height);
    }
    rodsHighlight.instanceMatrix.needsUpdate = true;
  }
  updateRotatingRods(0, 0, 1);

  // Counter-rotating holographic telemetry rings orbiting the central core
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
    const pos = geo.getAttribute("position");
    const uvs = geo.getAttribute("uv");
    for (let i = 0; i < pos.count; i++) {
      const ang = (Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI) / (2 * Math.PI);
      uvs.setXY(i, ang, i % 2);
    }
    const mesh = new Mesh(geo, ringMat);
    mesh.position.y = y;
    mesh.layers.enable(1);
    group.add(mesh);
    disposables.push(geo);
    orbitalRings.push({ mesh, speed });
  }

  // 3. Sun-Aligned Volumetric Skylight God-Rays (single merged draw call, Fresnel edge-softened!)
  if (!mobile) {
    const shafts: BufferGeometry[] = [];
    const specs: [number, number, number, number, number, number, number][] = [
      [4.55, 7.6, 16.5, 0.5, 10.6, -0.6, 0.16],
      [2.2, 4.4, 15.8, -6.2, 11.2, -5.0, 0.25],
      [2.2, 4.4, 15.8, 6.4, 11.2, -5.2, 0.25],
      [2.0, 4.1, 15.8, -5.6, 11.2, 5.8, 0.25],
      [2.0, 4.1, 15.8, 6.0, 11.2, 5.6, 0.25],
    ];
    for (const [topR, botR, h, cx, cy, cz, tilt] of specs) {
      const cyl = new CylinderGeometry(topR, botR, h, 36, 1, true);
      cyl.rotateZ(-tilt);
      cyl.rotateX(tilt * 0.72);
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

  // 3b. Soft Warm Museum Gallery Wall-Wash Halos around all 31 Paintings (strictly BEHIND frames, ZERO haze on canvas!)
  {
    const artHalos: BufferGeometry[] = [];
    const artWalls = (FLOOR.artWalls ?? []) as { id: string; t: number; x: number; z: number; w: number; h: number; cy: number }[];
    const rOff = ((FLOOR as unknown as { radii?: { office?: number } }).radii?.office) ?? 26.15;
    const rWash = rOff - 0.028; // strictly 8mm in front of Art wall (R_OFF-0.02) and 62mm BEHIND Artwork canvas (R_OFF-0.09)!
    const dummy = new Object3D();
    for (const aw of artWalls) {
      const theta = (aw.t * Math.PI) / 180;
      const washW = Math.min(3.55, aw.w + 1.55);
      const washH = Math.min(3.45, aw.h + 1.60);
      const plane = new PlaneGeometry(washW, washH, 1, 1);
      // Store normalized painting half-width & half-height in uv1 so shader cleanly masks out the frame area!
      const hw = (aw.w + 0.10) * 0.5 / washW;
      const hh = (aw.h + 0.10) * 0.5 / washH;
      const posAttr = plane.getAttribute("position");
      const maskUv = new Float32Array(posAttr.count * 2);
      for (let i = 0; i < posAttr.count; i++) {
        maskUv[i * 2] = hw;
        maskUv[i * 2 + 1] = hh;
      }
      plane.setAttribute("uv1", new BufferAttribute(maskUv, 2));
      dummy.position.set(Math.sin(theta) * rWash, aw.cy + 0.06, Math.cos(theta) * rWash);
      dummy.rotation.set(0, theta + Math.PI, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      plane.applyMatrix4(dummy.matrix);
      artHalos.push(plane);
    }
    const mergedHalos = artHalos.length ? mergeGeometries(artHalos) : null;
    artHalos.forEach(g => g.dispose());
    if (mergedHalos) {
      const haloMat = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const huv = uv();
      const boxHalf = uv(1);
      // Scalloped warm museum lamp cone illuminating ONLY the plaster wall around/above/below the frame
      const dx = huv.x.sub(0.5).mul(2.0);
      const dy = huv.y.sub(0.56).mul(2.0);
      const spreadX = dx.div(float(0.68).add(huv.y.oneMinus().mul(0.52)));
      const radial = clamp(float(1.0).sub(spreadX.mul(spreadX).mul(0.86).add(dy.mul(dy).mul(0.90))), float(0.0), float(1.0));
      const softGlow = pow(radial, float(2.05));
      const edgeClean = smoothstep(float(0.0), float(0.14), huv.x).mul(smoothstep(float(1.0), float(0.86), huv.x))
        .mul(smoothstep(float(0.0), float(0.14), huv.y)).mul(smoothstep(float(1.0), float(0.86), huv.y));
      // Clean cutout behind the painting frame itself so ZERO additive glow ever bleeds onto the canvas!
      const fx = abs(huv.x.sub(0.5)).sub(boxHalf.x);
      const fy = abs(huv.y.sub(0.48)).sub(boxHalf.y);
      const outsideFrame = smoothstep(float(-0.02), float(0.04), fx.max(fy));
      // Warm 2900K museum halogen amber-ivory glow strictly on the plaster surround
      haloMat.colorNode = vec3(1.0, 0.84, 0.58).mul(float(0.52).mul(uCoveWarmMul));
      haloMat.opacityNode = softGlow.mul(edgeClean).mul(outsideFrame).mul(0.58);
      const haloMesh = new Mesh(mergedHalos, haloMat);
      haloMesh.matrixAutoUpdate = false;
      haloMesh.updateMatrix();
      haloMesh.frustumCulled = false;
      haloMesh.renderOrder = 1;
      group.add(haloMesh);
      disposables.push(mergedHalos, haloMat);
    }
  }

  // 4. Floating Atmospheric Light Motes (single draw call GPU points; hidden during bull celebration to avoid redundant draw)
  let motesPoints: Points | null = null;
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
      size: mobile ? 3.0 : 4.0,
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
    motesPoints = motes;
    group.add(motes);
    disposables.push(moteGeo, moteMat);
  }

  // 4b. AAA Bull-Market Celebration Pyrotechnics (>= +3%: 3x crimson ceiling neon + gold/silver sparks + pillar-crown fireworks + glitter; >= +4%: 2x sparks!)
  const pillarCrownY = pillarCrownMaxY >= 15.6 && pillarCrownMaxY <= 18.8 ? pillarCrownMaxY - 0.18 : 17.35;
  const celebration = createBullCelebrationFX(new Float32Array(ceilingNeonPts), pillarCrownY, mobile);
  group.add(celebration.group);
  disposables.push(celebration);

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
  const curGodRay = new Color(MOODS.daylight.godRayColor);
  const curMote = new Color(MOODS.daylight.moteColor);
  let curExposure = MOODS.daylight.exposure;
  let curHemi = MOODS.daylight.hemi;
  let curEnv = MOODS.daylight.envIntensity;
  let curLmMul = MOODS.daylight.lightmapMul;
  let curSkyEmit = MOODS.daylight.skylightEmit;
  let curWinGolden = MOODS.daylight.windowGoldenMix;
  let curWinNight = MOODS.daylight.windowNightMix;
  let curWinExp = MOODS.daylight.windowExposure;
  let curCoveMul = MOODS.daylight.coveMul;
  let curGodOp = MOODS.daylight.godRayOpacity;
  let curHolo = MOODS.daylight.holoBoost;
  let curMoteOp = MOODS.daylight.moteOpacity;
  let curReflectBoost = MOODS.daylight.reflectBoost;
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

    const colorsChanged = moodDirty;
    if (moodDirty) {
      curExposure += (spec.exposure - curExposure) * k;
      curHemi += (spec.hemi - curHemi) * k;
      curEnv += (spec.envIntensity - curEnv) * k;
      curLmMul += (spec.lightmapMul - curLmMul) * k;
      curSkyEmit += (spec.skylightEmit - curSkyEmit) * k;
      curWinGolden += (spec.windowGoldenMix - curWinGolden) * k;
      curWinNight += (spec.windowNightMix - curWinNight) * k;
      curWinExp += (spec.windowExposure - curWinExp) * k;
      curCoveMul += (spec.coveMul - curCoveMul) * k;
      curGodOp += (spec.godRayOpacity - curGodOp) * k;
      curHolo += (spec.holoBoost - curHolo) * k;
      curMoteOp += (spec.moteOpacity - curMoteOp) * k;
      curReflectBoost += (spec.reflectBoost - curReflectBoost) * k;

      curCoreIntensity += (targetCoreIntensity - curCoreIntensity) * k;
      curCoreStrength += (targetCoreStrength - curCoreStrength) * k;
      curCorePrimary.lerp(targetCorePrimary, k);
      curCoreHighlight.lerp(targetCoreHighlight, k);
      curCoreGlass.lerp(targetCoreGlass, k);

      curBg.lerp(tmpColor.set(spec.bg), k);
      curSky.lerp(tmpColor.set(spec.sky), k);
      curGround.lerp(tmpColor.set(spec.ground), k);
      curSkylight.lerp(tmpColor.set(spec.skylightColor), k);
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
        } else {
          item.mat.emissiveIntensity = item.base * curCoveMul;
        }
      }

      uWindowGoldenMix.value = curWinGolden;
      uWindowNightMix.value = curWinNight;
      uWindowExposure.value = curWinExp;
      uSkylightColor.value.copy(curSkylight);
      uSkylightEmit.value = curSkyEmit;
      uReflectStrength.value = mobile ? 0.0 : curReflectBoost * reflectTierMul;

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
        Math.abs(spec.windowGoldenMix - curWinGolden) < 0.0008 &&
        Math.abs(spec.windowNightMix - curWinNight) < 0.0008 &&
        Math.abs(targetCoreIntensity - curCoreIntensity) < 0.001 &&
        Math.abs(targetCoreStrength - curCoreStrength) < 0.001
      ) {
        moodDirty = false;
      }
    }

    const breath = 1.0 + Math.sin(nowSec * (1.8 + curCoreStrength * 2.4)) * (0.04 + curCoreStrength * 0.12);
    const liveEmitMul = curCoreIntensity * curHolo * breath;

    for (const item of trackedCore) {
      if (item.role === "glass") {
        if (colorsChanged) item.mat.color.copy(curCoreGlass);
      } else if (item.role === "filamentW") {
        if (colorsChanged) {
          item.mat.color.copy(curCoreHighlight);
          item.mat.emissive.copy(curCoreHighlight);
        }
        item.mat.emissiveIntensity = item.baseEmit * (0.9 + (liveEmitMul - 1.0) * 0.85);
      } else {
        if (colorsChanged) {
          item.mat.color.copy(curCorePrimary);
          item.mat.emissive.copy(curCorePrimary);
        }
        item.mat.emissiveIntensity = item.baseEmit * liveEmitMul;
      }
    }

    const spillBoost = 0.45 + curCoreStrength * 0.95;
    if (colorsChanged) coreLightLow.color.copy(curCorePrimary);
    coreLightLow.intensity = (mobile ? 8.5 : 4.2) * spillBoost * curHolo * breath;
    if (coreLightMid) {
      if (colorsChanged) coreLightMid.color.copy(curCorePrimary);
      coreLightMid.intensity = 6.5 * spillBoost * curHolo * breath;
    }

    const rallyBoost = celebration.getRallyBoost();
    // >= +3.0% bull rally: ceiling crimson-red neon lines blaze 3.0x brighter!
    const rallyMul = 1.0 + rallyBoost * 2.0;
    const ceilBlend = clampVal(0.24 + curCoreStrength * 0.62, 0, 1);
    if (curCoreStrength < 0.02 && rallyBoost < 0.005) {
      uCeilingColor.value.copy(C_WARM_CEILING);
      uCeilingIntensity.value = 2.0 * curCoveMul;
      if (ceilingLight) {
        ceilingLight.color.copy(C_WARM_CEILING);
        ceilingLight.intensity = 4.5 * curCoveMul;
      }
    } else {
      uCeilingColor.value.copy(C_WARM_CEILING).lerp(curCorePrimary, ceilBlend);
      if (rallyBoost > 0.005) uCeilingColor.value.lerp(C_RALLY_CRIMSON, rallyBoost);
      uCeilingIntensity.value = 2.1 * curCoveMul * curCoreIntensity * breath * rallyMul;
      if (ceilingLight) {
        ceilingLight.color.copy(curCorePrimary);
        if (rallyBoost > 0.005) ceilingLight.color.lerp(C_RALLY_CRIMSON, rallyBoost);
        ceilingLight.intensity = (5.5 + curCoreStrength * 11.0) * curHolo * breath * rallyMul;
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
      // Switch immediately back to 8K base material during mood crossfade so Day/Golden/Night blend smoothly!
      if (usingHiRes && windowMatCache) {
        bindWindowMaterial(windowMatCache);
        usingHiRes = false;
      }
    },
    getMood() {
      return targetMood;
    },
    setFallbackSkylines(day: Texture, golden: Texture, night: Texture) {
      skyDayTex = day;
      skyGoldenTex = golden;
      skyNightTex = night;
      const prev = windowMatCache;
      windowMatCache = makeParallaxSkylineWindow(undefined, undefined);
      if (!usingHiRes) bindWindowMaterial(windowMatCache);
      if (prev) window.setTimeout(() => prev.dispose(), 250);
    },
    setHiResSkyline(mood: AtriumMood | null, texL?: Texture, texR?: Texture) {
      if (usingHiRes && windowMatCache) {
        bindWindowMaterial(windowMatCache);
        usingHiRes = false;
      }
      if (hiResMat) {
        const staleMat = hiResMat;
        hiResMat = null;
        window.setTimeout(() => staleMat.dispose(), 250);
      }
      if (!mood || !texL || !texR) {
        hiResMood = null;
        return;
      }
      hiResMood = mood;
      hiResMat = makeParallaxSkylineWindow16k(texL, texR);
    },
    setIndexChange(changePct: number | null | undefined) {
      const next = typeof changePct === "number" && Number.isFinite(changePct) ? changePct : 0;
      if (Math.abs(next - targetChangePct) < 1e-4) return;
      targetChangePct = next;
      celebration.setIndexChange(next);
      refreshTargetSignal();
    },
    getCelebrationState() {
      return {
        tier: celebration.getTier(),
        activeCeilingSparks: celebration.getActiveCeilingSparks(),
        rallyBoost: celebration.getRallyBoost(),
      };
    },
    setEnvironment(env: Texture) {
      currentEnvMap = env;
      for (const m of envMats) {
        m.envMap = env;
        m.needsUpdate = true;
      }
      if (windowMatCache) {
        windowMatCache.envMap = env;
        windowMatCache.needsUpdate = true;
      }
      if (hiResMat) {
        hiResMat.envMap = env;
        hiResMat.needsUpdate = true;
      }
    },
    setReflectionLevel(level: 0 | 1 | 2) {
      reflectTierMul = level === 0 ? 0.0 : level === 1 ? 0.72 : 1.0;
      uReflectStrength.value = mobile ? 0.0 : curReflectBoost * reflectTierMul;
    },
    tick(now: number, dt: number, reduced: boolean) {
      const nowSec = now * 0.001;
      if (!reduced) {
        uTime.value = nowSec;
        const speedMul = 1.0 + curCoreStrength * 0.85;
        updateRotatingRods(dt, nowSec, speedMul);
        for (const ring of orbitalRings) ring.mesh.rotation.y += ring.speed * speedMul * dt;
      }
      celebration.tick(nowSec, dt, reduced);
      if (motesPoints) motesPoints.visible = celebration.getTier() === 0;
      applyMood(1 - Math.exp(-dt * 4.2), reduced ? 0 : nowSec);
      // Lock into fresh WebGPU 16K material once the active mood crossfade has settled
      const specNow = MOODS[targetMood];
      const moodSettled =
        Math.abs(specNow.windowNightMix - curWinNight) < 0.03 &&
        Math.abs(specNow.windowGoldenMix - curWinGolden) < 0.03;
      if (!usingHiRes && hiResMat && hiResMood === targetMood && moodSettled) {
        bindWindowMaterial(hiResMat);
        usingHiRes = true;
      }
    },
    dispose() {
      if (usingHiRes && windowMatCache) {
        bindWindowMaterial(windowMatCache);
        usingHiRes = false;
      }
      hiResMat?.dispose();
      hiResMat = null;
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
  private smoothDt = 1 / 60;
  private readonly duration = 42;
  private active = false;
  private readonly pos = new Vector3();
  private readonly tgt = new Vector3();

  constructor() {
    this.posCurve = new CatmullRomCurve3([
      new Vector3(0.0, 2.2, 22.4),
      new Vector3(11.8, 7.2, 18.8),
      new Vector3(16.2, 2.5, 4.5),
      new Vector3(5.4, 2.6, -9.8),
      new Vector3(-13.8, 11.4, -14.2),
      new Vector3(-16.0, 15.8, 12.6),
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

  start() { this.active = true; this.smoothDt = 1 / 60; }
  stop() { this.active = false; }
  isActive() { return this.active; }

  step(dt: number): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    if (!this.active) return null;
    // Steadicam dt smoothing prevents micro-judder from 1ms vsync variance
    this.smoothDt += (dt - this.smoothDt) * 0.25;
    this.elapsed = (this.elapsed + this.smoothDt) % this.duration;
    const u = this.elapsed / this.duration;
    this.posCurve.getPointAt(u, this.pos);
    this.tgtCurve.getPointAt(u, this.tgt);
    const dx = this.tgt.x - this.pos.x;
    const dy = this.tgt.y - this.pos.y;
    const dz = this.tgt.z - this.pos.z;
    const horiz = Math.max(1e-4, Math.hypot(dx, dz));
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, horiz);
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw, pitch };
  }
}
