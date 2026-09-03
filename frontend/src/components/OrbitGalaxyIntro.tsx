import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import "./orbitGalaxyIntro.css";

/* ── The entry sequence ──────────────────────────────────────────────────────
   Three acts: a spiral galaxy turning at a distance, an accelerating fall into
   one coordinate on a spiral arm, and the star system there breaking out of the
   light. It is a self-contained module — one component, one stylesheet, one
   `onFinish` — so it can be swapped or removed without touching the market page.

   The galaxy is not drawn. It is a set of ~420k stars on tilted elliptical
   orbits whose tilt grows with the semi-major axis; where those ellipses crowd,
   spiral arms appear on their own, and because each star keeps orbiting at its
   own rate the pattern stays put while the stars flow through it. That is the
   density-wave picture, and it is the reason the arms shear like gas instead of
   turning like a pinwheel. Everything about a star's position is computed in the
   vertex shader from one uniform clock, so the CPU touches no vertex after the
   buffers are built.

   The star-system scene is not part of this scene: it is the live market page
   already rendered underneath this overlay, in its own context with its own
   depth range. The scale transition is therefore a real cross-fade between two
   independently rendered images rather than one camera trying to hold both a
   galaxy and a planet in the same depth buffer. */

export type OrbitIntroMarket = "kospi" | "kosdaq" | "nasdaq100";

/** Semi-major axis of the outermost disk orbit. Every other length here is in
 *  these units. */
const GALAXY_RADIUS = 100;

/** Radians of orbital tilt added per unit of semi-major axis. This single number
 *  is the spiral: too little and the disk is a smooth ellipse, too much and the
 *  arms wind into a ring. */
const SPIRAL_TIGHTNESS = 0.075;

/** Flat rotation curve. Angular speed is `V_FLAT / max(a, A_CORE)`, so the inner
 *  disk laps the rim — visibly, over the length of the shot. */
const V_FLAT = 2.6;
const A_CORE = 15;

/** Where in the galaxy this particular entry is heading, and from which side.
 *  Drawn fresh every time the sequence mounts, so the same galaxy is approached
 *  from a different quarter — and along a different arm — on every arrival. */
type Approach = {
  /** Semi-major axis of the destination's orbit. */
  axis: number;
  /** Which of the two arms, as a phase along the orbit: 0 or π. */
  arm: number;
  /** The destination's bearing within the galaxy, measured from +X toward +Z. */
  bearing: number;
  /** How far around the destination the camera comes in from. */
  approach: number;
  /** Above (+1) or below (-1) the disk for the long shot. */
  side: 1 | -1;
  /** Compass octant of the destination, or the core. */
  sector: string;
  /** The HUD's coordinate readout. */
  coordinate: string;
};

/* The disk's own compass: bearings run from +X through +Z, and the camera looks
   down the +Y axis, which puts +Z at the bottom of frame. */
const GALAXY_OCTANTS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];

function drawApproach(): Approach {
  const random = (min: number, max: number) => min + Math.random() * (max - min),
    /* One entry in six goes for the inner disk instead of the outer arms. Not the
       bulge itself — arriving inside a core that is clipping to white is a white
       frame — but the crowded ring just outside it. */
    core = Math.random() < 0.17,
    axis = core
      ? GALAXY_RADIUS * random(0.19, 0.27)
      : GALAXY_RADIUS * random(0.34, 0.72),
    arm = Math.random() < 0.5 ? 0 : Math.PI,
    /* A star on the crest sits at the end of its orbit's major axis, so the
       destination's bearing is just that orbit's tilt — which is what makes the
       radius double as a choice of direction. */
    bearing = (axis * SPIRAL_TIGHTNESS + arm) % (Math.PI * 2),
    octant = Math.round(bearing / (Math.PI / 4)) & 7,
    degrees = (bearing * 180) / Math.PI,
    latitude = random(-4, 4);
  return {
    axis,
    arm,
    bearing,
    // Never straight down the radius: coming in off-axis keeps the arm sweeping
    // across the frame instead of pointing at the lens.
    approach: random(-0.7, 0.7),
    side: Math.random() < 0.5 ? 1 : -1,
    sector: core ? "CORE" : GALAXY_OCTANTS[octant],
    coordinate: `GAL ${degrees.toFixed(1)}° / ${latitude >= 0 ? "+" : "-"}${Math.abs(latitude).toFixed(1).padStart(4, "0")}°`,
  };
}

const CAMERA_NEAR = 0.5;

/* Act boundaries as fractions of the whole, from the 8.5s reference cut:
   0.7s fade-in · 3.6s long shot · 4.3s target lock · 7.0s entry · 8.0s
   transition · 8.5s landing. The short cut uses the same fractions on a shorter
   clock, so one set of curves drives both. */
const ACT = {
  fade: 0.082,
  longShot: 0.424,
  lock: 0.506,
  entry: 0.824,
  transition: 0.941,
} as const;

/* One length, every time. A shortened revisit cut was here and it read as
   flippant: the sequence is a three-act shot, and compressing it to three seconds
   leaves the galaxy no time to be a place before the camera is already inside it.
   Anyone who does not want to watch it has the skip button, Escape, a click or a
   scroll. */
const DURATION = { full: 8500, reduced: 400 };

/** Hot young-star tint per market. The galaxy is the same place every time; only
 *  the population lighting up its arms changes colour. */
const MARKET_HOT: Record<OrbitIntroMarket, number> = {
  kospi: 0x9ccfff,
  kosdaq: 0xc3b0ff,
  nasdaq100: 0xffdcaa,
};

/* ── shaders ─────────────────────────────────────────────────────────────── */

const GALAXY_VERT = /* glsl */ `
attribute vec4 aOrbit;   // semi-major, semi-minor, tilt, phase
attribute vec4 aParams;  // point size, temperature (K), youth, brightness
uniform float uTime;
uniform float uScale;
uniform float uOpacity;
uniform float uMaxSize;
uniform float uMinSize;
uniform float uTwinkle;
uniform float uNear;
uniform float uSpin;
uniform vec3 uHot;
varying vec3 vColor;
varying float vAlpha;
varying float vSpike;
varying float vSeed;

/* Planck locus, Tanner Helland's fit. Star colour is a temperature, not a
   palette entry: 3000K bulge red-golds and 11000K arm blue-whites come out of
   the same function, so the disk's colour gradient is the population's. */
vec3 blackbody(float kelvin){
  float t = clamp(kelvin, 1500.0, 15000.0) / 100.0;
  /* Every argument is guarded away from its singularity before the branch is
     taken. A driver that flattens these ternaries into selects evaluates both
     sides, and one NaN from pow() of a negative base silently kills the vertex —
     which is not an error anyone reports, just an empty screen. */
  float hot = max(t - 60.0, 0.001);
  float r = t <= 66.0 ? 255.0 : 329.698727446 * pow(hot, -0.1332047592);
  float g = t <= 66.0
    ? 99.4708025861 * log(max(t, 0.001)) - 161.1195681661
    : 288.1221695283 * pow(hot, -0.0755148492);
  float b = t >= 66.0
    ? 255.0
    : (t <= 19.0 ? 0.0 : 138.5177312231 * log(max(t - 10.0, 0.001)) - 305.0447927307);
  vec3 srgb = clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  return pow(srgb, vec3(2.2));
}

void main(){
  float a = aOrbit.x;
  // Differential rotation. Everything downstream of this line is a consequence.
  float th = aOrbit.w + uTime * (uSpin / max(a, ${A_CORE}.0));
  vec2 e = vec2(a * cos(th), aOrbit.y * sin(th));
  float c = cos(aOrbit.z), s = sin(aOrbit.z);
  // position carries the turbulence offset that tears the perfect ellipse up,
  // plus the star's height above the disk.
  vec3 p = vec3(e.x * c - e.y * s, 0.0, e.x * s + e.y * c) + position;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.001);
  gl_PointSize = clamp(aParams.x * uScale / dist, uMinSize, uMaxSize);
  /* Youth, assigned when the star was placed: the arms are blue because the
     population formed in them is, and it keeps its colour as it drifts. */
  vColor = mix(blackbody(aParams.y), uHot, clamp(aParams.z, 0.0, 1.0));
  float twinkle = mix(1.0, 0.66 + 0.34 * sin(uTime * 2.4 + aOrbit.w * 11.0), uTwinkle);
  // Anything about to pass the near plane fades instead of popping through it.
  float nearFade = smoothstep(uNear * 1.5, uNear * 12.0, dist);
  vAlpha = aParams.w * uOpacity * nearFade * twinkle;
  vSpike = smoothstep(1.15, 2.4, aParams.w);
  vSeed = aOrbit.w;
}`;

/* Stars are drawn, not textured: a tight core, a wide faint halo, and — only on
   the handful bright enough to earn them — diffraction spikes. */
const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSpike;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q);
  if (d > 0.5) discard;
  float core = exp(-d * d * 28.0);
  float halo = exp(-d * 7.0) * 0.34;
  float spikes = 0.0;
  if (vSpike > 0.001) {
    float h = exp(-abs(q.x) * 52.0) * exp(-abs(q.y) * 4.5);
    float v = exp(-abs(q.y) * 52.0) * exp(-abs(q.x) * 4.5);
    spikes = (h + v) * 0.6 * vSpike;
  }
  // The sprite is a square; without this its corners cut the halo off flat.
  float edge = 1.0 - smoothstep(0.4, 0.5, d);
  gl_FragColor = vec4(vColor * vAlpha * (core + halo + spikes) * edge, 1.0);
}`;

/* HII regions. A plain gaussian billboard reads as a lens smudge, so the body is
   modulated by two octaves of value noise seeded per cloud. */
const NEBULA_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q);
  if (d > 0.5) discard;
  vec2 uv = gl_PointCoord * 3.2 + vSeed * 7.3;
  float n = vnoise(uv) * 0.65 + vnoise(uv * 2.7) * 0.35;
  float body = exp(-d * d * 10.0) * (1.0 - smoothstep(0.34, 0.5, d));
  gl_FragColor = vec4(vColor * vAlpha * body * (0.3 + 1.1 * n), 1.0);
}`;

/* The dust lane is the one layer that subtracts. It is drawn after the stars
   with normal blending, so it occludes the light behind it the way the disk's
   own material does. Take it away and the galaxy immediately looks synthetic. */
const DUST_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q);
  if (d > 0.5) discard;
  float body = exp(-d * d * 7.0) * (1.0 - smoothstep(0.33, 0.5, d));
  gl_FragColor = vec4(vColor, clamp(vAlpha * body, 0.0, 1.0));
}`;

/* Final grade. The grain is not decoration: additive star fields over a near
   black sky band badly on 8-bit output, and two hundredths of noise is what
   breaks the bands up. */
const FILM_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.02 },
    /* Well under the 0.0015 a photographic grade would use: at this star size a
       channel split of more than a pixel does not fringe the image, it turns every
       single-pixel star into a red or green speck. */
    uAberration: { value: 0.0006 },
    uVignette: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uGrain;
uniform float uAberration;
uniform float uVignette;
varying vec2 vUv;
void main(){
  vec2 centred = vUv - 0.5;
  float r2 = dot(centred, centred);
  vec2 shift = centred * uAberration * (0.35 + r2 * 3.0);
  vec3 color = vec3(
    texture2D(tDiffuse, vUv + shift).r,
    texture2D(tDiffuse, vUv).g,
    texture2D(tDiffuse, vUv - shift).b
  );
  color *= 1.0 - uVignette * smoothstep(0.16, 0.78, r2);
  float grain = fract(sin(dot(vUv * 1024.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) * uGrain;
  gl_FragColor = vec4(color, 1.0);
}`,
};

/* ── geometry ────────────────────────────────────────────────────────────── */

type GalaxyBuild = {
  stars: THREE.BufferGeometry;
  nebulae: THREE.BufferGeometry;
  dust: THREE.BufferGeometry;
  sky: THREE.BufferGeometry;
};

type GalaxyBudget = {
  stars: number;
  nebulae: number;
  dust: number;
  sky: number;
};

/** Orbital eccentricity by radius: nearly circular in the bulge, most elliptical
 *  through the mid disk where the arms have to read, easing off at the rim. */
const eccentricityAt = (axis: number) => {
  const t = Math.min(1, axis / GALAXY_RADIUS);
  return 0.05 + 0.42 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.1 * t;
};

/** Disk thickness: a puffed bulge settling into a thin rim. */
const thicknessAt = (axis: number) => 4.6 * Math.exp(-axis / 26) + 0.9;

/** Three sines standing in for a curl field. The arms must not be perfect
 *  ellipses — the torn edge is most of what separates a galaxy from clip art. */
const turbulenceAt = (x: number, z: number, phase: number) =>
  Math.sin(x * 0.081 + z * 0.043 + phase) * 0.55 +
  Math.sin(x * 0.031 - z * 0.052 + phase * 1.7) * 0.9 +
  Math.sin(z * 0.114 + x * 0.017 + phase * 4.2) * 0.35;

function buildGalaxy(budget: GalaxyBudget): GalaxyBuild {
  const TAU = Math.PI * 2,
    random = (min: number, max: number) => min + Math.random() * (max - min),
    gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5,
    /* Exponential disk. Sampling the radius from its own distribution rather
       than shaping a uniform one is what puts the light where a disk keeps it. */
    diskAxis = () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const axis = -40 * Math.log(1 - Math.random());
        if (axis <= GALAXY_RADIUS * 1.15) return axis;
      }
      return GALAXY_RADIUS;
    },
    /* Pareto brightness. A field of equally bright stars is fog; nearly all the
       character of a real one comes from a few stars far brighter than the rest. */
    pareto = (scale: number, shape: number, cap: number) =>
      Math.min(cap, scale / Math.pow(Math.max(1e-4, Math.random()), 1 / shape));

  const allocate = (count: number) => ({
    offset: new Float32Array(count * 3),
    orbit: new Float32Array(count * 4),
    params: new Float32Array(count * 4),
  });
  const pack = (fields: ReturnType<typeof allocate>) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(fields.offset, 3));
    geometry.setAttribute("aOrbit", new THREE.BufferAttribute(fields.orbit, 4));
    geometry.setAttribute("aParams", new THREE.BufferAttribute(fields.params, 4));
    return geometry;
  };

  const stars = allocate(budget.stars);
  const writeStar = (
    index: number,
    axis: number,
    minor: number,
    tilt: number,
    phase: number,
    height: number,
    turbulence: number,
    size: number,
    temperature: number,
    youth: number,
    brightness: number,
  ) => {
    const restX = Math.cos(phase) * axis,
      restZ = Math.sin(phase) * minor;
    stars.offset[index * 3] = turbulenceAt(restX, restZ, 0.3) * turbulence;
    stars.offset[index * 3 + 1] = height;
    stars.offset[index * 3 + 2] = turbulenceAt(restZ, restX, 2.7) * turbulence;
    stars.orbit[index * 4] = axis;
    stars.orbit[index * 4 + 1] = minor;
    stars.orbit[index * 4 + 2] = tilt;
    stars.orbit[index * 4 + 3] = phase;
    stars.params[index * 4] = size;
    stars.params[index * 4 + 1] = temperature;
    stars.params[index * 4 + 2] = youth;
    stars.params[index * 4 + 3] = brightness;
  };

  const bulgeShare = 0.1,
    haloShare = 0.05;
  for (let index = 0; index < budget.stars; index++) {
    const population = Math.random();
    if (population < bulgeShare) {
      /* The bulge: old, warm, and round. Its stars ride circular orbits inside
         the flat part of the rotation curve, so the whole core turns as one. */
      const spherical = Math.pow(Math.random(), 1.7) * GALAXY_RADIUS * 0.16 + 0.3,
        polar = Math.acos(2 * Math.random() - 1),
        axis = Math.max(0.4, spherical * Math.sin(polar));
      writeStar(
        index,
        axis,
        axis,
        0,
        Math.random() * TAU,
        spherical * Math.cos(polar) * 0.62,
        0,
        random(0.055, 0.11),
        random(3000, 4600) + gauss() * 300,
        0,
        pareto(0.022, 2.8, 0.42),
      );
      continue;
    }
    if (population > 1 - haloShare) {
      // A thin spheroid of old stars past the disk, so the rim has an edge that
      // dissolves rather than stops.
      const spherical = random(GALAXY_RADIUS * 0.5, GALAXY_RADIUS * 1.5),
        polar = Math.acos(2 * Math.random() - 1),
        axis = Math.max(1, spherical * Math.sin(polar));
      writeStar(
        index,
        axis,
        axis,
        0,
        Math.random() * TAU,
        spherical * Math.cos(polar) * 0.55,
        0,
        random(0.05, 0.1),
        random(3200, 5200),
        0,
        pareto(0.09, 2.6, 0.7),
      );
      continue;
    }
    // The disk: one tilted ellipse per star, and the arms take care of themselves.
    const axis = diskAxis(),
      normalized = axis / GALAXY_RADIUS,
      minor = axis * (1 - eccentricityAt(axis)),
      tilt = axis * SPIRAL_TIGHTNESS + gauss() * 0.045,
      /* Half the disk is drawn from the crest rather than from the whole orbit.
         The tilted ellipses already crowd along their major axes; this is the
         overdensity that crowding represents, and without it the arms are a
         statistical tendency rather than something you can see. */
      /* The wave's grip loosens outward. Holding the crest fraction constant to
         the rim gathers the outermost orbits' major-axis ends into a bright ring
         around the whole disk. */
      onCrest = Math.random() < 0.62 - 0.4 * normalized,
      phase = onCrest
        ? (Math.random() < 0.5 ? 0 : Math.PI) + gauss() * 0.5
        : Math.random() * TAU,
      /* Star formation follows the gas, which is richest through the middle of
         the disk. Only part of the population answers to the arm at all, so the
         crest reads as a mix rather than a uniform blue stripe. */
      /* Star formation happens in the arm, so the blue population is mostly on
         the crest and only sparsely between arms — that contrast is the colour
         difference a spiral galaxy actually shows. */
      youth =
        Math.random() < (onCrest ? 0.82 : 0.16)
          ? Math.min(1, 0.5 + Math.sin(Math.PI * normalized) * 0.95) *
            (0.7 + 0.3 * Math.random())
          : 0;
    writeStar(
      index,
      axis,
      minor,
      tilt,
      phase,
      gauss() * thicknessAt(axis),
      0.6 + 2.1 * normalized,
      random(0.05, 0.12),
      random(4400, 6600) - normalized * 300 + gauss() * 700,
      youth,
      /* A blue star is not a dim one. Deep blue carries far less luminance than
         the warm end, so tinting without lifting the brightness makes the young
         population disappear behind the old — which is backwards: the O and B
         stars in the arms are the brightest things in the disk. */
      pareto(0.19, 1.75, 3.2) *
        (0.32 + 0.68 * Math.exp(-normalized * 1.9)) *
        // Faded out at the truncation radius; a hard cap on the orbit
        // distribution otherwise draws the disk's edge as a wire hoop.
        (1 - THREE.MathUtils.smoothstep(normalized, 0.5, 1.06)) *
        (onCrest ? 1.5 : 1) *
        (1 + youth * 1.7),
    );
  }

  /* HII regions ride the same orbit family, a little outside the stellar crest
     where the gas piles up against the wave. */
  const nebulae = allocate(budget.nebulae);
  for (let index = 0; index < budget.nebulae; index++) {
    const axis = random(GALAXY_RADIUS * 0.25, GALAXY_RADIUS * 0.68),
      normalized = axis / GALAXY_RADIUS,
      minor = axis * (1 - eccentricityAt(axis)),
      warm = Math.random() < 0.55;
    nebulae.offset[index * 3] = gauss() * 5;
    nebulae.offset[index * 3 + 1] = gauss() * 1.6;
    nebulae.offset[index * 3 + 2] = gauss() * 5;
    nebulae.orbit[index * 4] = axis;
    nebulae.orbit[index * 4 + 1] = minor;
    nebulae.orbit[index * 4 + 2] = axis * SPIRAL_TIGHTNESS + 0.05;
    // On the crest, like the stars they are forming.
    nebulae.orbit[index * 4 + 3] =
      (Math.random() < 0.5 ? 0 : Math.PI) + gauss() * 0.45;
    nebulae.params[index * 4] = random(4.5, 14);
    // Temperature is unused by the nebula shader's colour; the tone is carried
    // in `youth`, which the material maps to its own magenta-to-teal pair.
    nebulae.params[index * 4 + 1] = warm ? 6200 : 9600;
    nebulae.params[index * 4 + 2] = warm ? 1 : 0;
    nebulae.params[index * 4 + 3] = random(0.05, 0.14) * (0.4 + normalized);
  }

  /* Dust sits just inside the arm it traces — the asymmetry is a real feature of
     spiral galaxies and it is what stops the lane looking like a drawn outline. */
  const dust = allocate(budget.dust);
  for (let index = 0; index < budget.dust; index++) {
    const axis = random(GALAXY_RADIUS * 0.12, GALAXY_RADIUS * 0.72),
      minor = axis * (1 - eccentricityAt(axis));
    dust.offset[index * 3] = gauss() * 3.2;
    dust.offset[index * 3 + 1] = gauss() * 1.2;
    dust.offset[index * 3 + 2] = gauss() * 3.2;
    dust.orbit[index * 4] = axis * 0.965;
    dust.orbit[index * 4 + 1] = minor * 0.965;
    dust.orbit[index * 4 + 2] = axis * SPIRAL_TIGHTNESS - 0.075;
    dust.orbit[index * 4 + 3] =
      (Math.random() < 0.5 ? 0 : Math.PI) + gauss() * 0.55;
    dust.params[index * 4] = random(4, 14);
    dust.params[index * 4 + 1] = 3000;
    dust.params[index * 4 + 2] = 1;
    /* Tapered out with the starlight it is supposed to be absorbing. Carried to
       the rim at full strength it stops being a lane and becomes a dark ring
       drawn over the background sky. */
    dust.params[index * 4 + 3] =
      random(0.25, 0.62) * Math.exp(-Math.pow(axis / GALAXY_RADIUS, 2) * 2.4);
  }

  /* Foreground field. It does not orbit, and that is the point: the galaxy grows
     against something fixed, which is the difference between travel and zoom. */
  const sky = allocate(budget.sky);
  for (let index = 0; index < budget.sky; index++) {
    const distance = random(520, 900),
      azimuth = Math.random() * TAU,
      polar = Math.acos(2 * Math.random() - 1);
    sky.offset[index * 3] = distance * Math.sin(polar) * Math.cos(azimuth);
    sky.offset[index * 3 + 1] = distance * Math.cos(polar);
    sky.offset[index * 3 + 2] = distance * Math.sin(polar) * Math.sin(azimuth);
    sky.orbit[index * 4] = 0;
    sky.orbit[index * 4 + 1] = 0;
    sky.orbit[index * 4 + 2] = 0;
    sky.orbit[index * 4 + 3] = Math.random() * TAU;
    sky.params[index * 4] = random(0.6, 2.4);
    sky.params[index * 4 + 1] = random(3200, 11000);
    sky.params[index * 4 + 2] = 0;
    sky.params[index * 4 + 3] = pareto(0.16, 2.1, 1.9);
  }

  return { stars: pack(stars), nebulae: pack(nebulae), dust: pack(dust), sky: pack(sky) };
}

/** The deep field, drawn once into an equirectangular canvas: a few dozen far
 *  galaxies and a dusting of unresolved stars. One texture, one draw, no
 *  parallax — everything in it is meant to be infinitely far away. */
function deepFieldTexture(): THREE.Texture {
  const width = 1024,
    height = 512,
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#010206";
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 1500; index++) {
      const x = Math.random() * width,
        y = Math.random() * height,
        size = Math.random() * 0.9 + 0.2;
      context.globalAlpha = 0.12 + Math.random() * 0.5;
      context.fillStyle = Math.random() < 0.25 ? "#cfe0ff" : "#ffffff";
      context.fillRect(x, y, size, size);
    }
    const tones = ["#6f8ad0", "#b98a76", "#8fa8c8", "#c2a2b8"];
    for (let index = 0; index < 34; index++) {
      const x = Math.random() * width,
        y = 60 + Math.random() * (height - 120),
        radius = 5 + Math.random() * 16,
        squash = 0.28 + Math.random() * 0.6,
        tone = tones[(Math.random() * tones.length) | 0];
      context.save();
      context.translate(x, y);
      context.rotate(Math.random() * Math.PI);
      context.scale(1, squash);
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, `${tone}dd`);
      gradient.addColorStop(0.35, `${tone}55`);
      gradient.addColorStop(1, "#00000000");
      context.globalAlpha = 0.5 + Math.random() * 0.4;
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/** A radial sprite from a drawing function. Used only for the two volumetric
 *  glows and the arrival flare — never for a star. */
function radialSprite(
  size: number,
  stops: [number, string][],
  height = size,
): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient =
      height === size
        ? context.createRadialGradient(
            size / 2,
            height / 2,
            0,
            size / 2,
            height / 2,
            size / 2,
          )
        : context.createLinearGradient(0, 0, size, 0);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    if (height === size) {
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, height);
    } else {
      context.fillStyle = gradient;
      for (let row = 0; row < height; row++) {
        context.globalAlpha = Math.exp(-Math.pow((row - height / 2) / (height / 9), 2));
        context.fillRect(0, row, size, 1);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ── component ───────────────────────────────────────────────────────────── */

export default function OrbitGalaxyIntro({
  market,
  label,
  sceneReady,
  abort,
  onFinish,
}: {
  market: OrbitIntroMarket;
  label: string;
  /** The market scene behind the overlay is built and rendering. The transition
   *  waits for this, so the intro covers the load instead of racing it. */
  sceneReady: boolean;
  /** Something went wrong underneath — leave immediately so the page can say so. */
  abort: boolean;
  onFinish: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    sectionRef = useRef<HTMLElement>(null),
    titleRef = useRef<HTMLDivElement>(null),
    progressRef = useRef<HTMLElement>(null),
    reticleRef = useRef<HTMLDivElement>(null),
    distanceRef = useRef<HTMLElement>(null),
    finishedRef = useRef(false),
    readyRef = useRef(sceneReady);
  readyRef.current = sceneReady;

  const [{ duration, reduced }] = useState(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    return { reduced, duration: reduced ? DURATION.reduced : DURATION.full };
  });

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish();
  }, [onFinish]);

  // One draw per mount: the effect and the HUD have to agree on where this
  // particular entry is going.
  const [approach] = useState(drawApproach);

  useEffect(() => {
    if (abort) finish();
  }, [abort, finish]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    /* The market scene holds a WebGL context of its own. If the browser will not
       hand out a second one there is nothing to show, and sitting on top of a
       page that has already rendered is the worst of both. */
    const created = (() => {
      try {
        return new THREE.WebGLRenderer({
          canvas,
          antialias: false,
          alpha: false,
          stencil: false,
          depth: false,
          powerPreference: "high-performance",
        });
      } catch {
        return null;
      }
    })();
    if (!created) {
      finish();
      return;
    }

    const renderer = created,
      coarse = matchMedia("(pointer: coarse)").matches,
      budget: GalaxyBudget = coarse
        ? { stars: 140000, nebulae: 60, dust: 900, sky: 900 }
        : { stars: 420000, nebulae: 110, dust: 2200, sky: 2000 };
    let pixelRatio = Math.min(devicePixelRatio, coarse ? 1.5 : 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(0x010206, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES, applied by the OutputPass at the end of the chain. The star field is
    // genuinely high dynamic range — Pareto brightness puts values well past 1 —
    // and a linear clip would flatten every bright star to the same white.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;

    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(62, 1, CAMERA_NEAR, 4000),
      build = buildGalaxy(budget),
      background = deepFieldTexture();
    scene.background = background;
    scene.backgroundIntensity = 0.34;

    const hot = new THREE.Color(MARKET_HOT[market]).convertSRGBToLinear();
    const layerMaterial = (options: {
      fragmentShader: string;
      maxSize: number;
      minSize: number;
      twinkle: number;
      near: number;
      dust?: boolean;
      color?: THREE.Color;
    }) =>
      new THREE.ShaderMaterial({
        vertexShader: GALAXY_VERT,
        fragmentShader: options.fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uScale: { value: 1000 },
          uOpacity: { value: 0 },
          uMaxSize: { value: options.maxSize },
          uMinSize: { value: options.minSize },
          uTwinkle: { value: options.twinkle },
          uNear: { value: options.near },
          uSpin: { value: V_FLAT },
          uHot: { value: options.color ?? hot },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        /* Dust absorbs: dst * (1 - alpha). Painting it as a dark colour with
           normal blending instead makes the lanes glow brown wherever they cross
           empty space, because mixing black toward 4% grey is a brightening. */
        blending: options.dust ? THREE.CustomBlending : THREE.AdditiveBlending,
        ...(options.dust
          ? {
              blendSrc: THREE.ZeroFactor,
              blendDst: THREE.OneMinusSrcAlphaFactor,
              blendEquation: THREE.AddEquation,
            }
          : null),
      });

    const starMaterial = layerMaterial({
        fragmentShader: STAR_FRAG,
        maxSize: 26,
        /* Below about a pixel and a half the field stops overlapping and starts
           reading as separate specks with gaps between them. Four hundred thousand
           stars are only a galaxy if their profiles touch. */
        minSize: 1.6,
        twinkle: 0.14,
        near: CAMERA_NEAR,
      }),
      nebulaMaterial = layerMaterial({
        fragmentShader: NEBULA_FRAG,
        maxSize: coarse ? 130 : 210,
        minSize: 2,
        twinkle: 0,
        near: 2.6,
        // `youth` picks the magenta end; the rest stay on the blackbody's own
        // blue-white, which is the pair a star-forming region actually shows.
        color: new THREE.Color(0xff4f9e).convertSRGBToLinear(),
      }),
      dustMaterial = layerMaterial({
        fragmentShader: DUST_FRAG,
        maxSize: coarse ? 90 : 150,
        minSize: 2,
        twinkle: 0,
        near: 2.2,
        dust: true,
        /* Linear, and darker than it looks written down: this is the colour the
           layer converges to wherever the lanes overlap, and at 0.04 that plateau
           is a visible brown haze once ACES and the sRGB encode have lifted it. */
        color: new THREE.Color(0.012, 0.007, 0.005),
      }),
      skyMaterial = layerMaterial({
        fragmentShader: STAR_FRAG,
        maxSize: 7,
        minSize: 0.8,
        twinkle: 0.3,
        near: CAMERA_NEAR,
      });
    // The sky is not part of the galaxy and must not turn with it.
    skyMaterial.uniforms.uSpin.value = 0;

    const starField = new THREE.Points(build.stars, starMaterial),
      nebulaField = new THREE.Points(build.nebulae, nebulaMaterial),
      dustField = new THREE.Points(build.dust, dustMaterial),
      skyField = new THREE.Points(build.sky, skyMaterial);
    for (const field of [skyField, nebulaField, starField, dustField]) {
      // The shader moves every vertex, so a precomputed bounding sphere would be
      // a lie and the test itself is not worth its cost on a single draw call.
      field.frustumCulled = false;
      scene.add(field);
    }
    skyField.renderOrder = 0;
    nebulaField.renderOrder = 1;
    starField.renderOrder = 2;
    // Dust last: it is absorption, not emission. (Points cannot be depth-sorted
    // among themselves; at these opacities the ordering inside the layer does
    // not read.)
    dustField.renderOrder = 3;

    const bulgeTexture = radialSprite(256, [
        [0, "#fffdf6"],
        [0.05, "#fff0d0ee"],
        [0.18, "#ffcf8f7a"],
        [0.42, "#ff9a4a2e"],
        [0.72, "#b0501a0a"],
        [1, "#00000000"],
      ]),
      flareTexture = radialSprite(256, [
        [0, "#ffffff"],
        [0.08, "#ffffff"],
        [0.24, "#e4f6ffcc"],
        [0.52, "#7fc8ff40"],
        [1, "#00000000"],
      ]),
      streakTexture = radialSprite(
        512,
        [
          [0, "#00000000"],
          [0.5, "#ffffff"],
          [1, "#00000000"],
        ],
        64,
      );

    const makeSprite = (texture: THREE.Texture, color: number, order: number) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          color,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sprite.renderOrder = order;
      scene.add(sprite);
      return sprite;
    };
    // The bulge's volumetric glow, and the destination's own light.
    const bulgeGlow = makeSprite(bulgeTexture, 0xffca7e, 1),
      systemGlow = makeSprite(flareTexture, 0xffffff, 4),
      systemStreak = makeSprite(streakTexture, 0xcfeaff, 4);
    bulgeGlow.scale.setScalar(GALAXY_RADIUS * 0.2);

    const composer = new EffectComposer(renderer),
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.7, 0.62),
      film = new ShaderPass(FILM_SHADER);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.addPass(film);

    /* Framing. The reference shot is a disk inclined about 60°, which is 30°
       of camera elevation above its plane. A portrait phone gets a much flatter
       view instead: a disk tilted to 30° in a tall frame is a bright stripe with
       black above and below it, which is not a galaxy filling the screen. */
    let width = 1,
      height = 1,
      path = new THREE.CatmullRomCurve3([new THREE.Vector3()]),
      startDistance = 120;
    const restTarget = new THREE.Vector3(
        Math.cos(approach.bearing) * approach.axis,
        0.8,
        Math.sin(approach.bearing) * approach.axis,
      ),
      buildPath = () => {
        const halfVertical = THREE.MathUtils.degToRad(62) / 2,
          tanVertical = Math.tan(halfVertical),
          tanHorizontal = tanVertical * camera.aspect,
          wideness = THREE.MathUtils.clamp((camera.aspect - 0.5) / 1.1, 0, 1),
          elevation =
            THREE.MathUtils.lerp(1.2, 0.52, wideness) * approach.side,
          /* The wide shot is taken from the destination's own side of the galaxy.
             Framing it from anywhere else would mean the approach crosses the core
             on its way out to the arm, and the last three seconds would be spent
             flying through a blown-out bulge. */
          azimuth = Math.PI / 2 - approach.bearing - approach.approach * 0.5;
        /* Frame on the disk's width, and only let the height take over on a
           narrow viewport. Fitting an inclined disk to the height of a wide frame
           puts the camera inside its own subject. */
        /* Framed on the light, not on the outermost orbit: an exponential disk
           keeps four fifths of its stars well inside its formal radius, so fitting
           R to the frame leaves the galaxy small in the middle of it. */
        const visibleRadius = GALAXY_RADIUS * 0.78;
        startDistance =
          Math.min(
            visibleRadius / tanHorizontal,
            ((visibleRadius * Math.sin(elevation)) / tanVertical) * 1.5,
          ) * 1.02;
        const direction = (elev: number, azim: number) =>
          new THREE.Vector3(
            Math.sin(azim) * Math.cos(elev),
            Math.sin(elev),
            Math.cos(azim) * Math.cos(elev),
          );
        /* The arrival is placed around the destination rather than in world axes:
           outward along its radius, swung by the draw's approach angle, so the
           camera always comes in from open space with the arm running across the
           frame — whichever quarter of the galaxy the draw picked. */
        const arrivalBearing = approach.bearing + approach.approach,
          arrival = new THREE.Vector3(
            Math.cos(arrivalBearing),
            0.09 * approach.side,
            Math.sin(arrivalBearing),
          ).normalize();
        /* Four control points: the wide shot, a swing that carries the camera
           around the disk rather than straight down the barrel, the last stretch
           above the arm, and the arrival. */
        path = new THREE.CatmullRomCurve3(
          [
            direction(elevation, azimuth).multiplyScalar(startDistance),
            restTarget
              .clone()
              .multiplyScalar(0.22)
              .add(direction(elevation * 0.88, azimuth - 0.22).multiplyScalar(startDistance * 0.54)),
            restTarget
              .clone()
              .multiplyScalar(0.72)
              .add(direction(elevation * 0.5, azimuth - 0.5).multiplyScalar(startDistance * 0.17)),
            /* Almost in the plane at arrival. Looking down at a target that sits
               in the disk pushes the disk above it on screen, and the shot ends
               beside the arm instead of inside it. */
            restTarget.clone().addScaledVector(arrival, 17),
          ],
          false,
          "catmullrom",
          0.4,
        );
      },
      resize = () => {
        width = canvas.clientWidth || 1;
        height = canvas.clientHeight || 1;
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        buildPath();
      };
    resize();

    /* The overdensity at a given radius travels with the stars that make it, so
       the destination is not a fixed point in the sky: it drifts at that orbit's
       own angular speed. Rotating the camera path by the same angle keeps the
       approach locked to the arm instead of arriving in the gap the arm has left. */
    const targetSpin = V_FLAT / Math.max(approach.axis, A_CORE),
      axisY = new THREE.Vector3(0, 1, 0),
      focus = new THREE.Vector3(),
      lookAt = new THREE.Vector3(),
      position = new THREE.Vector3(),
      screen = new THREE.Vector3(),
      /* The aim is built as a matrix rather than through a helper Object3D:
         `Object3D.lookAt` points +Z at the target, while a camera looks down -Z,
         so borrowing an object's orientation aims the shot backwards. */
      aim = new THREE.Matrix4(),
      aimUp = new THREE.Vector3(),
      aimQuaternion = new THREE.Quaternion(),
      smooth = THREE.MathUtils.smoothstep,
      reticle = reticleRef.current,
      distanceReadout = distanceRef.current,
      /* The overlay's own chrome is driven from the same clock as the camera
         rather than from CSS animations. The timeline can hold — it waits for the
         scene underneath — and a wall-clock keyframe would drift off it. */
      section = sectionRef.current,
      titleBlock = titleRef.current,
      progressBar = progressRef.current;

    let raf = 0,
      elapsed = 0,
      clock = 0,
      lastFrame = performance.now(),
      frames = 0,
      frameTotal = 0,
      adapted = false;

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      const delta = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      // A hidden tab delivers no frames; when it comes back, the shot resumes
      // where it stopped instead of jumping to the end.
      if (document.hidden) return;
      clock += delta;

      /* The timeline holds at the top of the scale transition until the market
         scene underneath is actually ready to be cut to. The galaxy keeps
         turning through the hold, so a slow load reads as a longer approach
         rather than a freeze. */
      const holdAt = ACT.entry * duration;
      const holding = !readyRef.current && elapsed >= holdAt - 1;
      if (!holding) elapsed = Math.min(duration, elapsed + delta * 1000);
      else elapsed = Math.min(elapsed, holdAt - 1);

      const progress = elapsed / duration,
        appear = smooth(progress, 0, ACT.fade),
        /* Two easings, joined: sine through the long shot so the drift is barely
           perceptible, then a cubic acceleration into the arm. */
        cruise = smooth(progress, ACT.fade, ACT.lock) * 0.16,
        entryT = THREE.MathUtils.clamp(
          (progress - ACT.lock) / (ACT.entry - ACT.lock),
          0,
          1,
        ),
        travel = reduced ? 0 : cruise + entryT * entryT * entryT * 0.84,
        lock = reduced ? 0 : smooth(progress, ACT.longShot - 0.06, ACT.lock + 0.09),
        breakout = reduced ? 0 : smooth(progress, ACT.entry - 0.02, ACT.transition),
        landing = reduced ? 0 : smooth(progress, ACT.transition, 1);

      starMaterial.uniforms.uTime.value = clock;
      nebulaMaterial.uniforms.uTime.value = clock;
      dustMaterial.uniforms.uTime.value = clock;
      skyMaterial.uniforms.uTime.value = clock;

      /* A stop of exposure closed on the way in. From outside, the disk is a
         shape; from inside its plane it is every star in the galaxy stacked
         along one line of sight, and at the wide shot's brightness that stack
         clips to a flat white band. */
      const exposure = 1 - 0.55 * smooth(travel, 0.2, 0.9),
        // The galaxy is swallowed by the system's light rather than cut away.
        dissolve = 1 - breakout * 0.92;
      starMaterial.uniforms.uOpacity.value = appear * exposure * dissolve;
      skyMaterial.uniforms.uOpacity.value = appear * dissolve;
      // Gas and dust are structure seen from outside; once the camera is inside
      // the arm they are plates across the lens, so they leave before it.
      const outside = 1 - smooth(travel, 0.42, 0.92);
      nebulaMaterial.uniforms.uOpacity.value = appear * outside * dissolve;
      dustMaterial.uniforms.uOpacity.value = appear * outside * dissolve;

      // Rotating the whole path with the destination keeps the camera locked to
      // a coordinate that is itself orbiting.
      const spin = clock * targetSpin;
      focus.copy(restTarget).applyAxisAngle(axisY, spin);
      lookAt.set(0, 0, 0).lerp(focus, lock);
      path.getPoint(THREE.MathUtils.clamp(travel, 0, 1), position);
      position.applyAxisAngle(axisY, spin);
      // A low-frequency handheld float, scaled by distance so it stays constant
      // on screen. Nothing in a real shot is ever perfectly still.
      const distance = position.distanceTo(lookAt);
      position.x += Math.sin(clock * 0.53) * distance * 0.004;
      position.y += Math.cos(clock * 0.41) * distance * 0.003;
      camera.position.copy(position);

      /* FOV breathes only during the entry: a wide lens compressing as the
         camera commits, then opening at arrival. Doing it in the long shot would
         just look like distortion. */
      const fov = 62 - 14 * smooth(entryT, 0, 0.45) + 22 * smooth(entryT, 0.55, 1);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2),
        scale = (height * pixelRatio * 0.5) / tanVertical;
      starMaterial.uniforms.uScale.value = scale;
      nebulaMaterial.uniforms.uScale.value = scale;
      dustMaterial.uniforms.uScale.value = scale;
      skyMaterial.uniforms.uScale.value = scale;

      /* Orientation by quaternion. A per-frame lookAt with a rolling up-vector
         jitters as the up-vector crosses the view direction; slerping toward the
         target orientation is both stable and its own gentle lag. */
      const roll = THREE.MathUtils.lerp(-0.061, 0.021, travel) +
        Math.sin(clock * 0.37) * 0.0026;
      aimUp.set(Math.sin(roll), Math.cos(roll), 0);
      aim.lookAt(camera.position, lookAt, aimUp);
      aimQuaternion.setFromRotationMatrix(aim);
      // Slerping toward the aim rather than snapping to it is both the handheld
      // lag and the reason a rolling up-vector never makes the frame jitter.
      camera.quaternion.slerp(aimQuaternion, 1 - Math.exp(-delta * 14));

      bulgeGlow.material.opacity = appear * 0.3 * (1 - smooth(travel, 0.18, 0.62));

      /* The arrival. The system's star comes up as a real light in the scene and
         the bloom is opened to let it flood — the frame is taken by the light,
         not by a white card dropped over it. */
      const preglow = lock * 0.16 * (1 - breakout),
        ignition = Math.max(preglow, breakout);
      systemGlow.position.copy(focus);
      systemStreak.position.copy(focus);
      systemGlow.scale.setScalar(0.6 + breakout * breakout * 34 + preglow * 6);
      systemGlow.material.opacity = Math.min(1, ignition * 1.6);
      systemStreak.scale.set(2 + breakout * breakout * 120, 0.5 + breakout * 6, 1);
      systemStreak.material.opacity = breakout * 0.7;
      bloom.strength = 0.55 * (1 + 0.6 * breakout);
      film.uniforms.uTime.value = clock;
      film.uniforms.uVignette.value = 0.42 * (1 - breakout * 0.7);

      composer.render();

      if (reticle) {
        const visible =
          smooth(progress, ACT.fade, ACT.longShot - 0.08) *
          (1 - smooth(progress, ACT.entry - 0.08, ACT.entry + 0.04));
        reticle.style.opacity = `${visible}`;
        if (visible > 0.002) {
          screen.copy(focus).project(camera);
          reticle.style.transform = `translate3d(${
            (screen.x * 0.5 + 0.5) * width
          }px, ${(-screen.y * 0.5 + 0.5) * height}px, 0) translate(-50%, -50%) scale(${(
            0.7 +
            travel * 1.05
          ).toFixed(3)})`;
          if (distanceReadout)
            distanceReadout.textContent = `${Math.round(
              distance * 143,
            ).toLocaleString("en-US")} ly`;
        }
      }

      /* Adaptive quality, decided once on the first 45 frames. Particle count is
         thinned through the draw range rather than rebuilt, and the pixel ratio
         drops with it — both are gradual enough not to read as a pop. */
      if (!adapted && frames < 45) {
        frames++;
        frameTotal += delta * 1000;
        if (frames === 45 && frameTotal / 45 > 16.7) {
          adapted = true;
          build.stars.setDrawRange(0, Math.floor(budget.stars * 0.55));
          build.dust.setDrawRange(0, Math.floor(budget.dust * 0.6));
          pixelRatio = Math.max(1, pixelRatio * 0.75);
          renderer.setPixelRatio(pixelRatio);
          composer.setSize(width, height);
          bloom.strength = 0.48;
        }
      }

      if (titleBlock) {
        const shown =
          smooth(progress, ACT.fade, ACT.fade + 0.11) *
          (1 - smooth(progress, ACT.entry - 0.14, ACT.entry + 0.02));
        titleBlock.style.opacity = `${shown}`;
        titleBlock.style.transform = `translate(-50%, ${((1 - shown) * 16).toFixed(1)}px)`;
        titleBlock.style.filter = `blur(${((1 - shown) * 13).toFixed(2)}px)`;
      }
      if (progressBar) progressBar.style.transform = `scaleX(${progress.toFixed(4)})`;
      // The landing beat: the overlay dissolves into the market scene that has
      // been rendering underneath it the whole time.
      if (section) section.style.opacity = `${1 - landing}`;

      if (elapsed >= duration) {
        cancelAnimationFrame(raf);
        finish();
      }
    };

    const skipOnInput = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      finish();
    };
    addEventListener("resize", resize);
    addEventListener("keydown", skipOnInput);
    canvas.addEventListener("pointerdown", skipOnInput);
    canvas.addEventListener("wheel", skipOnInput, { passive: true });
    raf = requestAnimationFrame(render);
    /* A tab backgrounded for the whole intro delivers no frames at all, and an
       intro that never ends is an intro that has swallowed the page. */
    const failsafe = window.setTimeout(finish, duration + 6000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(failsafe);
      removeEventListener("resize", resize);
      removeEventListener("keydown", skipOnInput);
      canvas.removeEventListener("pointerdown", skipOnInput);
      canvas.removeEventListener("wheel", skipOnInput);
      composer.dispose();
      // Disposed but not force-lost: a canvas whose context has been deliberately
      // killed never hands out another one, and StrictMode's mount-unmount-mount
      // asks this same element for a second renderer.
      renderer.dispose();
      for (const geometry of [build.stars, build.nebulae, build.dust, build.sky])
        geometry.dispose();
      for (const material of [
        starMaterial,
        nebulaMaterial,
        dustMaterial,
        skyMaterial,
      ])
        material.dispose();
      for (const sprite of [bulgeGlow, systemGlow, systemStreak]) {
        sprite.material.dispose();
        scene.remove(sprite);
      }
      for (const texture of [
        background,
        bulgeTexture,
        flareTexture,
        streakTexture,
      ])
        texture.dispose();
    };
  }, [approach, duration, finish, market, reduced]);

  return (
    <section
      ref={sectionRef}
      className="orbit-galaxy-intro"
      style={{ "--intro-dur": `${duration}ms` } as CSSProperties}
      aria-label={`${label} 은하 진입`}
    >
      <canvas ref={canvasRef} className="orbit-galaxy-canvas" aria-hidden="true" />
      <div className="orbit-galaxy-scrim" aria-hidden="true" />
      <div className="orbit-galaxy-reticle" ref={reticleRef} aria-hidden="true">
        <i />
        <u />
        <div className="orbit-galaxy-reticle-tag">
          <span>TARGET SYSTEM</span>
          <b>{label}</b>
          <em ref={distanceRef}>&mdash;</em>
        </div>
      </div>
      <div className="orbit-galaxy-title" ref={titleRef}>
        <small>
          APPROACHING · SECTOR {approach.sector} · {approach.coordinate}
        </small>
        <strong>{label}</strong>
        <span>은하의 한 좌표에서 {label} 항성계가 깨어납니다</span>
      </div>
      <div className="orbit-galaxy-progress" aria-hidden="true">
        <i ref={progressRef} />
      </div>
      <button type="button" className="orbit-galaxy-skip" onClick={finish}>
        건너뛰기 <kbd>ESC</kbd>
      </button>
    </section>
  );
}
