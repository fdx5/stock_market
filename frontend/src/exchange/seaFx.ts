/* Live sea for the exterior window panoramas (desktop only).
 *
 * The v7 skylines are one tripod photo of Midtown across the Hudson: the far-shore waterline is a straight
 * row at v = 0.5713 in every mood. Below it this module replaces the frozen photo water with a moving sea:
 *  - every water pixel is put back on a real horizontal water plane using the photo's own angles
 *    (camera ~14 m above the water, far shore ~1.3 km), so waves shrink and flatten toward the far bank;
 *  - the surface is 4 layers of fine wind ripples from a periodic wave tile (built in seaWaveWorker), LEAN-filtered:
 *    anisotropic mip sampling gives the mean slope per pixel and the stored second moment gives the slope spread of
 *    ripples too small to see, which becomes reflection blur -> crisp ripples up close, no shimmer far away;
 *  - each pixel reflects the photo itself: the reflected ray is traced to the far bank and looked up in
 *    the panorama, so day clouds, golden-hour towers and night neon all ripple in the water;
 *  - Fresnel, sky/body colour, crest light and trough shadow per mood; bright reflections are lifted
 *    into HDR so city lights glint and bloom at night;
 *  - the result is added as *detail* on top of the photo's own blurred water, so the sea keeps exactly
 *    the tone and the light columns of the original photo and meets the shore without any seam.
 * Cost: one branch over water pixels only, 4 wave fetches + 2-3 panorama fetches, no extra passes. */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";
import type { Node } from "three/webgpu";
import {
  asin, atan, clamp, log2, sqrt, cos, dFdx, dFdy, dot, float, length, max, min, mix, normalize, pow, sin, smoothstep,
  tan, texture, uniform, vec2, vec3,
} from "three/tsl";
import type { SeaWaveOut } from "./seaWaveWorker";

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;

/** Far-shore waterline row in the v7 panoramas (Y_WATER 2340 / 4096). */
export const SEA_WATERLINE_V = 2340 / 4096;
/** Panorama v units per radian of elevation (16380 px = 360°, height 4096 px). */
const V_PER_RAD = 16380 / (2 * Math.PI) / 4096;
const EYE = 14.0;      // photo camera height above the water (m)
const FAR = 1300.0;    // distance to the far bank (m)
const DEP_FAR = Math.atan(EYE / FAR);
const TAU = Math.PI * 2;

const WAVE_SIZE = 256;

// Fine ripple layers in metres: [tile size, direction (rad), drift speed (m/s), RMS slope].
// The river is seen from ~1 km down to ~15 m, so only small wind ripples are used (no big swells): far away they
// melt into a soft, correctly blurred reflection; up close they resolve into crisp ripples.
const LAYERS: [number, number, number, number][] = [
  [11.0, 0.00, 0.55, 0.042],
  [4.3, 0.47, 0.38, 0.038],
  [1.7, -0.40, 0.25, 0.030],
  [0.7, 0.90, 0.17, 0.022],
];

export type SeaMoodUniforms = { time: F; golden: F; night: F };

export type LiveSea = {
  /** Screen-derivative inputs; must be evaluated OUTSIDE any branch (WGSL uniform control flow). */
  prepare: (uSky: F, vRaw: F) => SeaPrep;
  /** Full water shading for one pixel; safe inside a branch (explicit LOD / gradient sampling only). */
  shade: (prep: SeaPrep, photo: V3, photoLow: V3, samplePano: (u: F, v: F, lod: F) => V3) => V3;
  /** 0 above the waterline .. 1 on live water (keeps piers, seawall and moored boats from the photo). */
  weight: (vRaw: F) => F;
  /** Runtime on/off (A/B measurement in one session; the branch is skipped entirely when off). */
  enabled: { value: number };
  enabledNode: F;
  dispose: () => void;
};

export type SeaPrep = {
  u: F; vRaw: F; dep: F; dist: F; radial: V2; tangent: V2; P: V2; dPdx: V2; dPdy: V2; footprint: F;
};

export function createLiveSea(uniforms: SeaMoodUniforms): LiveSea {
  const { time, golden, night } = uniforms;

  const data = new Uint8Array(WAVE_SIZE * WAVE_SIZE * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 128; data[i + 1] = 128; data[i + 2] = 128; data[i + 3] = 0; }
  const waveTex = new DataTexture(data, WAVE_SIZE, WAVE_SIZE, RGBAFormat, UnsignedByteType);
  waveTex.colorSpace = NoColorSpace;
  waveTex.wrapS = waveTex.wrapT = RepeatWrapping;
  waveTex.generateMipmaps = true;
  waveTex.minFilter = LinearMipmapLinearFilter;
  waveTex.magFilter = LinearFilter;
  waveTex.anisotropy = 4;
  waveTex.needsUpdate = true;

  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./seaWaveWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<SeaWaveOut>) => {
      if (e.data.size === WAVE_SIZE) {
        data.set(e.data.data);
        waveTex.needsUpdate = true;
      }
      worker?.terminate();
      worker = null;
    };
    worker.onerror = () => { worker?.terminate(); worker = null; };
    worker.postMessage({ size: WAVE_SIZE, seed: 0x5eaf00d });
  } catch {
    worker = null; // flat tile -> calm mirror
  }

  const enabledU = uniform(1.0);
  const weight = (vRaw: F) => smoothstep(float(SEA_WATERLINE_V + 0.0045), float(SEA_WATERLINE_V + 0.030), vRaw);

  const prepare = (uSky: F, vRaw: F): SeaPrep => {
    // Depression angle below horizontal from the photo row, then distance on the water plane.
    const dep = clamp(vRaw.sub(SEA_WATERLINE_V).div(V_PER_RAD).add(DEP_FAR), float(DEP_FAR), float(1.22)).toVar("seaDep");
    const dist = float(EYE).div(tan(dep)).toVar("seaDist");
    const az = uSky.mul(TAU);
    const radial = vec2(cos(az), sin(az)).toVar("seaRadial");
    const tangent = vec2(radial.y.negate(), radial.x);
    // Polar water plane around the viewer: continuous across the 360° wrap (no seam at u = 0).
    const P = radial.mul(dist).toVar("seaP");
    const dPdx = dFdx(P).toVar("seaPdx");
    const dPdy = dFdy(P).toVar("seaPdy");
    const footprint = max(length(dPdx), length(dPdy)).toVar("seaFoot");
    return { u: uSky, vRaw, dep, dist, radial, tangent, P, dPdx, dPdy, footprint };
  };

  const rot = (p: V2, c: number, s: number) => vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));

  const surface = (prep: SeaPrep) => {
    const grad = vec2(0.0, 0.0).toVar("seaGrad");
    const height = float(0.0).toVar("seaH");
    // LEAN filtering: the texture's mip chain gives the mean slope over the pixel footprint (anisotropic) and
    // its second moment, so variance = E[s^2] - E[s]^2 is the slope spread of ripples the pixel cannot resolve.
    const lostVar = float(0.0).toVar("seaLost");
    const totalVar = float(0.0).toVar("seaTotal");
    // Wind patches ("cat's paws"): slowly drifting areas of rougher and glassier water.
    // Two crossed slow sines instead of 3D noise: same drifting patch look at a fraction of the ALU.
    const gustN = sin(prep.P.x.mul(0.013).add(time.mul(0.05)).add(sin(prep.P.y.mul(0.021)).mul(1.7)))
      .mul(sin(prep.P.y.mul(0.017).sub(time.mul(0.04)).add(sin(prep.P.x.mul(0.009)).mul(1.3))));
    const gust = float(0.40).add(smoothstep(float(-0.45), float(0.55), gustN).mul(0.90));
    for (const [tile, dir, speed, slope] of LAYERS) {
      const c = Math.cos(-dir), s = Math.sin(-dir);
      const inv = 1 / tile;
      const q = rot(prep.P, c, s).mul(inv).add(vec2(time.mul(speed * inv), float(0.0)));
      const gx = rot(prep.dPdx, c, s).mul(inv);
      const gy = rot(prep.dPdy, c, s).mul(inv);
      const t = texture(waveTex, q).grad(gx, gy);
      const amp3 = gust.mul(slope * 3.0);
      const mean = vec2(t.r, t.g).mul(2.0).sub(1.0);
      const eVar = max(t.a.mul(2.0).sub(dot(mean, mean)), float(0.0));
      lostVar.addAssign(eVar.mul(amp3.mul(amp3)));
      totalVar.addAssign(amp3.mul(amp3).div(9.0).mul(2.0));
      grad.addAssign(rot(mean.mul(amp3), Math.cos(dir), Math.sin(dir)));
      height.addAssign(t.b.mul(2.0).sub(1.0).mul(slope * 6.0));
    }
    return { grad, height, lostVar, totalVar };
  };

  // Trace a ray leaving the water at `elev` (rad above horizontal) and lateral turn `turn` (rad) from a point
  // `dist` metres out, to the far bank; return the panorama (u, v) the photo camera sees there.
  const reflectUv = (prep: SeaPrep, elev: F, turn: F) => {
    const run = max(float(FAR).sub(prep.dist), float(2.0));
    const hit = run.mul(tan(min(elev, float(1.45))));
    const camElev = atan(hit.sub(EYE).div(FAR));
    const v = clamp(float(SEA_WATERLINE_V).sub(camElev.add(DEP_FAR).mul(V_PER_RAD)), float(0.006), float(SEA_WATERLINE_V - 0.0015));
    const u = prep.u.add(run.mul(tan(clamp(turn, float(-0.7), float(0.7)))).div(FAR * TAU));
    return { u, v };
  };

  const luminance = (c: V3) => dot(c, vec3(0.2126, 0.7152, 0.0722));

  const shade = (prep: SeaPrep, photo: V3, photoLow: V3, samplePano: (u: F, v: F, lod: F) => V3): V3 => {
    const { grad, height, lostVar, totalVar } = surface(prep);
    // Local frame (x = across the view, y = up, z = away from viewer).
    const sR = dot(grad, prep.radial);
    const sT = dot(grad, prep.tangent);
    const n = normalize(vec3(sT.negate(), float(1.0), sR.negate()));
    const sinD = sin(prep.dep);
    const viewDir = vec3(float(0.0), sinD.negate(), cos(prep.dep));
    const vn = dot(viewDir, n);
    const r = viewDir.sub(n.mul(vn.mul(2.0)));
    const elev = asin(clamp(r.y, float(0.003), float(0.999)));
    const turn = atan(r.x, max(r.z, float(0.05)));
    const cosI = clamp(vn.negate(), float(0.0), float(1.0));
    const fres = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(cosI), float(5.0))));
    const fresFlat = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(sinD), float(5.0))));

    // Unresolved slope spread -> reflection cone in panorama texels (16K: 4096 px per 1/V_PER_RAD rad).
    const rough = sqrt(lostVar);
    const blurPx = rough.mul(2.0 * V_PER_RAD * 4096 * 0.5).add(1.0);
    const lodSharp = clamp(log2(blurPx), float(0.0), float(7.5));
    const uvW = reflectUv(prep, elev, turn);
    const reflWave = samplePano(uvW.u, uvW.v, lodSharp).toVar("seaReflW");
    const uvF = reflectUv(prep, prep.dep, float(0.0));
    // Reference: the same water as a perfectly averaged mirror (blurred by the full ripple slope spread).
    const lodFlat = clamp(log2(sqrt(totalVar).mul(2.0 * V_PER_RAD * 4096 * 0.5).add(1.0)), float(2.0), float(7.5));
    const reflFlat = samplePano(uvF.u, uvF.v, lodFlat);

    // Photos clip highlights; give bright reflections back some HDR so lamps, neon and cloud tops glint.
    const lum = luminance(reflWave);
    const glint = smoothstep(float(0.62), float(0.98), lum).mul(mix(float(0.45), float(1.8), night))
      .mul(float(1.0).sub(smoothstep(float(0.02), float(0.09), rough)));
    const reflHdr = reflWave.mul(float(1.0).add(glint));

    const bodyDay = vec3(0.030, 0.070, 0.092);
    const bodyGold = vec3(0.060, 0.058, 0.064);
    const bodyNight = vec3(0.006, 0.012, 0.030);
    const body = mix(mix(bodyDay, bodyGold, golden), bodyNight, night);
    // Light through wave crests (day/golden) and soft shadow in troughs.
    const sssCol = mix(mix(vec3(0.050, 0.120, 0.118), vec3(0.120, 0.090, 0.050), golden), vec3(0.010, 0.020, 0.040), night);
    const crest = clamp(height.mul(0.5).add(0.5), float(0.0), float(1.0));
    const facing = clamp(n.z.negate().mul(6.0).add(0.4), float(0.0), float(1.0));
    const scatter = sssCol.mul(crest.mul(crest).mul(facing).mul(0.55));
    const shadeWave = mix(body.add(scatter), reflHdr, fres);
    const shadeFlat = mix(body, reflFlat, fresFlat);

    // Detail on top of the photo's own (blurred) water keeps its exact tone and night light columns.
    const nearGain = mix(float(0.70), float(0.95), smoothstep(float(0.02), float(0.25), prep.dep));
    const additive = photoLow.add(shadeWave.sub(shadeFlat).mul(nearGain));
    // Night: light columns in the photo are smooth long exposures; break them into rippling streaks by
    // modulating them with the ratio of rippled vs. mirror reflection (what the eye sees on real water).
    const ratio = clamp(luminance(shadeWave).div(max(luminance(shadeFlat), float(0.015))), float(0.30), float(2.4));
    const streaked = photoLow.mul(mix(float(1.0), ratio, float(0.75))).add(shadeWave.sub(shadeFlat).mul(0.35));
    const live = mix(additive, streaked, night.mul(0.85));
    const troughShade = float(0.93).add(crest.mul(0.12));
    const sea = max(live.mul(troughShade), vec3(0.0));
    // Far water stays close to the crisp photo (sub-pixel waves); the live sea takes over within ~2°.
    const farKeep = float(1.0).sub(smoothstep(float(DEP_FAR + 0.004), float(DEP_FAR + 0.05), prep.dep)).mul(0.35);
    return mix(sea, photo, farKeep);
  };

  return {
    prepare,
    shade,
    weight,
    enabled: enabledU,
    enabledNode: enabledU,
    dispose() {
      worker?.terminate();
      worker = null;
      waveTex.dispose();
    },
  };
}

/** Panorama blur for non-mipmapped fallback skylines: small 4-tap cross around (u, v). */
export function blur4(sample: (u: F, v: F) => V3, u: F, v: F, du: number, dv: number): V3 {
  return sample(u.add(du), v.add(dv))
    .add(sample(u.sub(du), v.add(dv * 0.4)))
    .add(sample(u.add(du * 0.4), v.sub(dv * 0.6)))
    .add(sample(u.sub(du * 0.4), v.sub(dv)))
    .mul(0.25);
}

