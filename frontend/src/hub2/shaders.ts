/* ============================================================================
   ORBIT II — the GLSL.
   ----------------------------------------------------------------------------
   Every surface on this page that isn't a photograph is computed per pixel
   here. The rule the whole file follows: light is *earned*, never painted on.
   A planet's rim glows because the shader knows where the sun is; the black
   hole's disc is brighter on one side because that side is rotating toward
   the camera; the sky bends near the hole because the final pass actually
   resamples the frame through a deflection field. Nothing is a decal.

   Shared preamble first, then one section per material.
   ========================================================================= */

/* ─────────────────────────── shared noise ───────────────────────────
   Ashima Arts' 3D simplex noise (Stefan Gustavson / Ian McEwan, MIT). Every
   procedural surface below is built out of this one function — the sun's
   granulation, the nebula, the ring bands, the accretion disc's turbulence.
   Inlined rather than pulled from a package because it is 40 lines and the
   project ships no shader tooling. */
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += snoise(p) * amp;
    total += amp;
    p *= lacunarity;
    amp *= gain;
  }
  return sum / max(total, 0.0001);
}

/* Ridged noise: |n| inverted, which turns smooth blobs into the sharp
   filament ridges that read as gas structure rather than as clouds. */
float ridged(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p));
    sum += n * n * amp;
    total += amp;
    p *= 2.1;
    amp *= 0.5;
  }
  return sum / max(total, 0.0001);
}
`;

/* ──────────────────────────── the star ────────────────────────────
   The sun's photosphere. A real one is a boiling convection surface: bright
   granule tops separated by darker cooling lanes, over a slower, much larger
   supergranulation pattern, with the disc dimming toward the limb because
   near the edge you are looking through more atmosphere at a shallower angle.
   All three are here; the limb darkening in particular is what stops the
   sphere reading as a flat yellow circle.

   uPulse is the market's own energy, 0..1 — the star burns hotter and more
   turbulently when the indices are moving. That is the one piece of this file
   that isn't astronomy. */
export const SUN_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vPos = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const SUN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPulse;
uniform vec3 uCool;
uniform vec3 uWarm;
uniform vec3 uHot;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vView;

${NOISE}

void main() {
  vec3 p = normalize(vPos);

  // Three timescales, because a single one reads as a texture sliding over a
  // ball rather than as a surface that is itself churning.
  float granule = fbm(p * 7.0 + vec3(0.0, uTime * 0.055, 0.0), 5, 2.15, 0.55);
  float super   = fbm(p * 2.3 - vec3(uTime * 0.021, 0.0, uTime * 0.017), 3, 2.0, 0.6);
  float flicker = snoise(p * 15.0 + vec3(uTime * 0.24)) * 0.5 + 0.5;

  float heat = granule * 0.55 + super * 0.45;
  heat = heat * 0.5 + 0.5;
  heat = pow(clamp(heat, 0.0, 1.0), 1.25 - uPulse * 0.35);
  heat += flicker * (0.05 + uPulse * 0.06);

  vec3 color = mix(uCool, uWarm, smoothstep(0.15, 0.62, heat));
  color = mix(color, uHot, smoothstep(0.6, 0.95, heat));

  // Limb darkening. mu is the cosine of the viewing angle; the classic
  // two-term Eddington approximation is close enough and costs nothing.
  float mu = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
  float limb = 0.32 + 0.68 * mu * (0.55 + 0.45 * mu);
  color *= limb;

  // Faculae: the bright network riding the edges of the cooling lanes, which
  // is where the surface actually looks white rather than orange.
  float lane = smoothstep(0.72, 0.95, heat);
  color += vec3(1.0, 0.93, 0.78) * lane * (0.55 + uPulse * 0.5) * limb;

  gl_FragColor = vec4(color * (1.35 + uPulse * 0.5), 1.0);
}
`;

/* ───────────────────── the supernova remnant ─────────────────────
   What the neutron merger throws off, modelled on the Crab.

   The thing that makes a remnant recognisable is NOT that it is a glowing
   ball. It is two features, and both are here:

   1. A lacy filament net. Ridged noise raised to a power gives thin bright
      ridges with dark voids between them — the Rayleigh-Taylor fingers that
      real ejecta tears itself into as it ploughs into the interstellar
      medium. A smooth shell reads as a smoke bubble; this reads as gas.
   2. Colour by species, not by temperature alone. Different elements emit at
      different wavelengths, so a real remnant is genuinely multi-coloured in
      the same breath: blue-white synchrotron continuum in the interior,
      teal-green from doubly-ionised oxygen, and the red-orange of hydrogen
      and singly-ionised sulphur through the outer filaments. Each shell below
      carries one pair of those and blends between them along the filaments.

   The silhouette is displaced in the vertex stage too, because a real
   remnant is lumpy and a perfect sphere gives the whole thing away at the
   edge. The displacement has no time term: the cloud should expand, not
   boil. */
export const REMNANT_VERT = /* glsl */ `
uniform float uWarp;
uniform float uSeed;
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vView;

${NOISE}

void main() {
  vec3 dir = normalize(position);
  float bump = fbm(dir * 1.9 + vec3(uSeed), 4, 2.1, 0.55);
  vec3 p = position * (1.0 + uWarp * bump);

  vDir = dir;
  vNormal = normalize(normalMatrix * dir);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const REMNANT_FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uIntensity;
uniform float uSeed;
uniform float uDetail;
uniform int uOctaves;
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vView;

${NOISE}

void main() {
  vec3 d = normalize(vDir);

  // The filament net. Ridged noise cubed: thin bright ridges, wide dark voids.
  float net = ridged(d * uDetail + vec3(uSeed), uOctaves);
  net = pow(clamp(net, 0.0, 1.0), 3.0);

  /* A slower, larger variation so the shell is patchy overall rather than
     uniformly webbed — real remnants are brighter on one side. Named "mottle"
     rather than the obvious "patch", which is a reserved word in GLSL. */
  float mottle = fbm(d * 1.7 + vec3(uSeed * 0.5), 3, 2.0, 0.6) * 0.5 + 0.5;

  // Hollow. Brightest where the line of sight grazes the shell wall, which is
  // what makes a thin expanding surface look thin.
  float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
  float shell = pow(clamp(rim, 0.0, 1.0), 1.7);

  float density = shell * (0.14 + net * 2.3) * mottle;

  // Two species, mixed along the filaments: the cooler one fills the diffuse
  // gas, the hotter one lights the ridges.
  vec3 color = mix(uColorA, uColorB, clamp(net * 2.2, 0.0, 1.0));

  gl_FragColor = vec4(color * (0.65 + net * 1.7), clamp(density * uIntensity, 0.0, 1.0));
}
`;

/* The corona proper: a camera-facing disc, not a shell.
 *
 * A sphere shell with a fresnel glow — which is what this was — puts its
 * brightest ring exactly at its own silhouette, so the corona reads as a
 * hard-edged glass ball around the star. That is backwards twice over: a real
 * corona is brightest against the limb and fades outward, and it has no edge
 * at all. On a billboard the falloff is a plain radial function, so it can do
 * both. (The shell shader above is still right for the neutron merger's
 * ejecta, which genuinely IS a hollow expanding sphere.)
 *
 * uUnit is where the photosphere's edge sits in the disc's 0..1 radius, so the
 * glow can start at the star's limb rather than at its centre. */
export const SUNGLOW_VERT = /* glsl */ `
varying vec2 vDisc;
void main() {
  // The plane is built 2 units across, so position.xy is already -1..1.
  vDisc = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SUNGLOW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPulse;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uUnit;
varying vec2 vDisc;

${NOISE}

void main() {
  float r = length(vDisc);
  if (r > 1.0) discard;

  // Brightest just off the limb, then a short exponential tail outward — the
  // shape a real corona actually has. Tight: a broad falloff turns the star
  // into a bonfire and swallows Mercury's and Venus's orbits whole.
  float d = max(r - uUnit, 0.0) / max(1.0 - uUnit, 0.0001);
  float glow = exp(-pow(d * 4.6, 1.15));

  /* Streamers combed radially outward, turning slowly. Sampled on the ray's
     angle plus its radius so they stretch rather than swirl. Kept coarse (3
     octaves, low frequency) and contributing under half the brightness: at
     four octaves and a 0.8 weight this stopped reading as a corona and became
     a bright web of lava filaments across the inner system. */
  float ang = atan(vDisc.y, vDisc.x);
  vec3 p = vec3(cos(ang), sin(ang), d * 1.1) * 1.7;
  float streamer = ridged(p + vec3(0.0, 0.0, uTime * 0.045), 3);
  streamer = smoothstep(0.44, 0.95, streamer);

  float a = glow * (0.72 + streamer * 0.45) * uIntensity * (0.85 + uPulse * 0.7);
  // Nothing at the quad's own edge, so the geometry never shows.
  a *= smoothstep(1.0, 0.7, r);

  gl_FragColor = vec4(uColor * (1.0 + streamer * 0.35), clamp(a, 0.0, 1.0));
}
`;

/* ─────────────────────────── the planets ───────────────────────────
   Texture, one light, and the two things that make a textured sphere stop
   looking like a textured sphere:

   1. a soft terminator. A hard `max(dot(N,L), 0)` puts a razor edge down the
      middle of the body; real atmospheres scatter light past the geometric
      day/night line, so the falloff is smoothstepped across it.
   2. rim scattering. Sunlight grazing an atmosphere at the limb scatters
      toward the camera — the blue crescent on every photograph of Earth from
      orbit. It is gated on the *lit* side only, because an unlit limb has no
      light to scatter, and skipping that gate is what makes cheap "fresnel
      glow" look like a sticker. */
export const PLANET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const PLANET_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunPos;
uniform vec3 uAtmoColor;
uniform float uAtmoStrength;
/** Selection/hover lift, 0..1 — brightens the body and widens its rim so the
 * thing under the cursor is unmistakable without an outline pass. */
uniform float uFocus;
/** Live index move, -1..1. Tints the terminator: green-cyan into the shadow
 * on an up day, red on a down day. Subtle by design — this is a wash over the
 * night side, not a recolour of the planet. */
uniform float uTrend;
uniform float uAmbient;
/** Per-body trim on top of the shared gain above. These textures are real
 * albedo maps and their mean brightness varies enormously — Saturn's and
 * Uranus's are pale, near-flat gas, while Mercury's rock, Earth's oceans and
 * Neptune's deep blue are genuinely dark. One global gain cannot serve both:
 * set high enough for the dark ones it blows out the pale ones. See
 * PlanetSpec.brightness in bodies.ts for the per-body values and why each is
 * what it is. */
uniform float uExposure;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunPos - vPosW);
  // cameraPosition is one of the few uniforms three declares in the fragment
  // stage for us; modelMatrix is not, which is why the ring below carries its
  // plane normal down as a varying instead of rebuilding it here.
  vec3 V = normalize(cameraPosition - vPosW);

  vec4 texel = texture2D(uMap, vUv);
  vec3 albedo = texel.rgb;

  float ndl = dot(N, L);
  // Wrapped diffuse — the scatter past the terminator. Wide, so the day/night
  // line is a gradient rather than an edge.
  float day = smoothstep(-0.32, 0.42, ndl);
  float lambert = max(ndl, 0.0);

  /* The lit/unlit balance, and it is deliberately NOT a photographic one.
     Real sunlight against real starlight is a contrast ratio in the thousands;
     rendered honestly, a planet here is a blown-out crescent stuck to an
     invisible ball. So the direct term is kept low and the ambient floor high,
     which compresses the range into something an eye can read across the whole
     body at once. The texture's own detail carries the form; the lighting only
     has to say where the sun is.

     Note the ambient applies to the lit side too, so raising it lifts the
     shadowed limb far more than the sunward face — which is exactly the knob
     wanted here. */
  vec3 lit = albedo * (uAmbient + lambert * 0.85) * day;
  // The night side is not black: starlight, ring-shine, and in the real world
  // city light. Lifted well past physical plausibility for the same reason.
  vec3 night = albedo * 0.26;
  vec3 color = mix(night, lit, day);

  /* Atmospheric limb scattering, lit side only. The focus boost is small on
     purpose: focusing a body also flies the camera right up to it, so the rim
     is already many times larger on screen: multiplying its brightness as well
     turned a close-up planet into a ring of glare with a texture inside it. */
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  float lit_rim = rim * smoothstep(-0.35, 0.2, ndl);
  color += uAtmoColor * lit_rim * uAtmoStrength * (0.95 + uFocus * 0.45);

  // A thin forward-scattered halo right at the terminator, where a real
  // atmosphere is brightest.
  float term = exp(-pow(ndl * 4.2, 2.0));
  color += uAtmoColor * term * uAtmoStrength * 0.34;

  // Market wash, into the shadow only.
  vec3 trendTint = uTrend >= 0.0 ? vec3(0.24, 1.0, 0.62) : vec3(1.0, 0.34, 0.42);
  color += trendTint * abs(uTrend) * (1.0 - day) * 0.16;

  // A hint of lift when this is the body the camera is holding — enough to
  // read as "this one", not enough to be a second light source.
  color *= 1.0 + uFocus * 0.18;
  // Applied to the whole body, rim included, so a brightened planet's
  // atmosphere brightens with it rather than being left behind as a dark halo.
  color *= uExposure;

  gl_FragColor = vec4(color, 1.0);
}
`;

/* ─────────────────────────── the rings ───────────────────────────
   Radial banding, built as noise sampled along the radius only, so it reads
   as concentric rather than as a texture wrapped around a disc. Two named
   gaps are cut explicitly (Saturn's Cassini division and the fainter Encke),
   because those are the features an eye recognises the ring system by.

   The shadow is real geometry, not a painted band: a point on the ring is in
   shadow when it is on the far side of the planet from the sun *and* within
   the planet's radius of the sun-planet axis. */
export const RING_VERT = /* glsl */ `
varying vec3 vPosW;
varying vec3 vPosL;
/** The ring plane's own normal, in world space. Carried down rather than
 * rebuilt in the fragment stage, where modelMatrix is not available. The
 * geometry is pre-rotated into the XZ plane on the CPU, so local +Y is the
 * plane normal. */
varying vec3 vRingN;
void main() {
  vPosL = position;
  vRingN = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSunPos;
uniform vec3 uPlanetPos;
uniform float uPlanetRadius;
uniform float uInner;
uniform float uOuter;
uniform float uOpacity;
uniform float uFocus;
/** 0 = Saturn's broad banded sheet, 1 = Uranus's thin separated hoops. */
uniform float uStyle;
varying vec3 vPosW;
varying vec3 vPosL;
varying vec3 vRingN;

${NOISE}

void main() {
  float r = length(vPosL.xz);
  float t = (r - uInner) / max(uOuter - uInner, 0.0001);
  if (t < 0.0 || t > 1.0) discard;

  float density;
  if (uStyle < 0.5) {
    // Saturn. Layered radial noise at three frequencies gives the ringlets;
    // the two divisions are then cut out of it.
    float bands = fbm(vec3(t * 34.0, 0.0, 0.0), 4, 2.3, 0.55) * 0.5 + 0.5;
    float fine  = snoise(vec3(t * 210.0, 0.0, 0.0)) * 0.5 + 0.5;
    density = bands * 0.75 + fine * 0.25;
    density *= smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.9, 1.0, t));
    // Cassini division — the wide dark gap between the A and B rings.
    density *= 1.0 - 0.94 * exp(-pow((t - 0.66) * 26.0, 2.0));
    // Encke gap, narrower and further out in the A ring.
    density *= 1.0 - 0.7 * exp(-pow((t - 0.87) * 90.0, 2.0));
    density = clamp(density * 1.15, 0.0, 1.0);
  } else {
    // Uranus. Nine narrow, dark, well-separated hoops rather than a sheet.
    float hoops = 0.0;
    for (int i = 0; i < 9; i++) {
      float c = 0.08 + float(i) * 0.105;
      float w = 90.0 + float(i) * 14.0;
      hoops += exp(-pow((t - c) * w, 2.0)) * (0.55 + 0.05 * float(i));
    }
    density = clamp(hoops, 0.0, 1.0) * 0.85;
  }

  // Shadow of the planet on its own rings.
  vec3 toSun = normalize(uSunPos - uPlanetPos);
  vec3 rel = vPosW - uPlanetPos;
  float along = dot(rel, toSun);
  float perp = length(rel - toSun * along);
  // Behind the planet, and inside its silhouette.
  float shadow = (along < 0.0) ? 1.0 - smoothstep(uPlanetRadius * 0.82, uPlanetRadius * 1.18, perp) : 0.0;

  // Ring particles are ice: bright in backscatter, and the thin parts glow
  // when the sun is behind them. Approximated as a lift near grazing view.
  vec3 V = normalize(cameraPosition - vPosW);
  float grazing = 1.0 - abs(dot(V, normalize(vRingN)));
  float forward = pow(clamp(grazing, 0.0, 1.0), 4.0);

  vec3 color = uColor * (0.55 + density * 0.75);
  color += uColor * forward * 0.35 * (1.0 - density * 0.5);
  color *= mix(1.0, 0.16, shadow);
  color *= 1.0 + uFocus * 0.7;

  float alpha = density * uOpacity * (0.45 + 0.55 * (1.0 - forward * 0.6));
  alpha *= mix(1.0, 0.5, shadow);

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
}
`;

/* ────────────────────── the black hole's disc ──────────────────────
   Gas spiralling in, heated by friction. Three things make it read as a real
   accretion disc rather than an orange donut:

   - a temperature gradient. The inner edge is orbiting at a large fraction of
     c and is genuinely hotter — it goes white-blue, not brighter orange.
   - Doppler beaming. The side rotating toward the camera is boosted; the side
     rotating away is dimmed. This is the asymmetry everyone recognises from
     the 2019 EHT image and from Interstellar's Gargantua, and it is one dot
     product.
   - shear. The turbulence is sampled in a coordinate frame that rotates
     faster at small radii, so the filaments wind up into spiral arms on their
     own instead of being drawn as spirals. */
export const DISC_VERT = /* glsl */ `
varying vec3 vPosL;
varying vec3 vPosW;
void main() {
  vPosL = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uInner;
uniform float uOuter;
/** Unit vector, in world space, of the disc material's motion at the point
 * nearest the camera — everything the beaming term needs. */
uniform vec3 uSpinAxis;
/** Rises while the hole is feeding (Pluto, then the blue star). */
uniform float uFeed;
/** The afterglow. For a few seconds after each meal the disc burns the colour
 * of what it just swallowed — green after the rock, blue-white after the star.
 * Real accretion discs do change colour as infalling material changes their
 * composition and temperature; the specific hues here are a reading aid, not a
 * spectrum. uGlowMix crossfades it against the disc's own thermal ramp so the
 * structure — the filaments, the beaming, the photon ring — survives the
 * recolour instead of being flooded flat. */
uniform vec3 uGlowTint;
uniform float uGlowMix;
varying vec3 vPosL;
varying vec3 vPosW;

${NOISE}

void main() {
  float r = length(vPosL.xz);
  float t = (r - uInner) / max(uOuter - uInner, 0.0001);
  if (t < 0.0 || t > 1.0) discard;

  float ang = atan(vPosL.z, vPosL.x);

  // Keplerian shear: inner material laps outer material, which is what winds
  // the noise into arms.
  float omega = 1.0 / pow(max(r, 0.001), 1.5);
  float swirl = ang + uTime * omega * 26.0;

  vec3 q = vec3(cos(swirl) * r, sin(swirl) * r, t * 3.0) * 0.42;
  float turb = fbm(q + vec3(0.0, 0.0, uTime * 0.12), 4, 2.2, 0.55) * 0.5 + 0.5;
  float fil = ridged(q * 1.9 - vec3(0.0, 0.0, uTime * 0.2), 3);

  float density = mix(turb, fil, 0.45);
  // Thin at both edges: sharp at the ISCO, feathered at the outer rim.
  density *= smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.55, 1.0, t));

  // Temperature: T ∝ r^-3/4 for a thin disc. Colour ramp follows it.
  float temp = pow(1.0 - t, 2.1);
  vec3 cold = vec3(0.75, 0.16, 0.03);
  vec3 warm = vec3(1.0, 0.55, 0.14);
  vec3 hot  = vec3(1.0, 0.92, 0.62);
  vec3 xhot = vec3(0.78, 0.9, 1.0);
  vec3 color = mix(cold, warm, smoothstep(0.05, 0.45, temp));
  color = mix(color, hot, smoothstep(0.42, 0.78, temp));
  color = mix(color, xhot, smoothstep(0.82, 1.0, temp));

  // Doppler beaming. The material's velocity here is tangential; compare it
  // with the direction to the camera.
  vec3 radial = normalize(vec3(vPosL.x, 0.0, vPosL.z));
  vec3 vel = normalize(cross(uSpinAxis, radial));
  vec3 toCam = normalize(cameraPosition - vPosW);
  float beta = 0.62 * (1.0 - t * 0.55); // faster further in
  float beam = 1.0 + beta * dot(vel, toCam);
  // Relativistic boost goes as roughly the fourth power of the Doppler factor.
  beam = pow(clamp(beam, 0.05, 2.0), 3.2);

  float brightness = density * beam * (1.25 + uFeed * 1.4);
  color *= brightness;

  // The photon ring: light that orbited the hole before escaping, piling up
  // just outside the horizon. Always white, always the brightest thing here.
  float photon = exp(-pow((t - 0.012) * 130.0, 2.0));
  color += vec3(1.0, 0.97, 0.9) * photon * (2.4 + uFeed * 2.0);

  if (uGlowMix > 0.001) {
    /* Same shape, different light: the tint is modulated by exactly the terms
       that drew the disc, so nothing is painted over.

       The multipliers are held down deliberately. The disc's own brightness
       already carries uFeed, which is itself raised during an afterglow, so a
       generous factor here compounds with it — at the first attempt the blue
       glow drove every channel past white and the hole vanished inside a flat
       featureless blob. A recolour that saturates to white is not a recolour;
       the whole point is that the colour survives. */
    vec3 tinted = uGlowTint * (0.25 + brightness * 0.85 + photon * 1.5);
    color = mix(color, tinted, uGlowMix);
  }

  float alpha = clamp(density * 1.7 + photon * 1.4, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

/* ────────────────────── deep-sky background ──────────────────────
   The nebula the whole system sits inside, painted on the inside of a very
   large sphere. Three gas phases at three scales with a dust lane cut through
   them, plus a faint galactic band. Rendered once into the backdrop and never
   animated beyond an extremely slow drift — a nebula that visibly moves reads
   as fog, and this needs to read as distance. */
export const NEBULA_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NEBULA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uIntensity;
varying vec3 vDir;

${NOISE}

void main() {
  vec3 d = normalize(vDir);
  float drift = uTime * 0.004;

  float big   = fbm(d * 1.3 + vec3(drift, 0.0, 0.0), 5, 2.1, 0.55) * 0.5 + 0.5;
  float mid   = ridged(d * 3.1 + vec3(0.0, drift * 0.6, 0.0), 4);
  float small = fbm(d * 7.5 - vec3(0.0, 0.0, drift * 0.4), 4, 2.4, 0.5) * 0.5 + 0.5;

  float cloud = pow(big, 2.2) * 0.65 + pow(mid, 2.6) * 0.5 + pow(small, 3.4) * 0.3;

  /* Most of the sky is empty, and this is the line that says so. The three
     octaves above never actually reach zero anywhere, so without a threshold
     the "nebula" covers 100% of the frame at a low but uniform level — which
     does not read as gas at all. It reads as the black of space having been
     replaced with grey, and it drags the entire starfield down with it. */
  cloud = smoothstep(0.26, 0.86, cloud);

  // Emission ramp, cool outside to hot in the dense cores.
  vec3 color = mix(uColorA, uColorB, smoothstep(0.1, 0.5, cloud));
  color = mix(color, uColorC, smoothstep(0.45, 0.9, cloud));

  // Dust: dark absorbing lanes threading through the emission, which is what
  // gives a nebula its structure. Multiplied in, never added.
  float dust = fbm(d * 2.4 + vec3(11.0, 3.0, 7.0), 4, 2.2, 0.6) * 0.5 + 0.5;
  float lane = smoothstep(0.42, 0.72, dust);
  color *= mix(0.25, 1.0, lane);

  // The galactic plane: a broad, slightly tilted band of unresolved stars.
  // Kept as its own term rather than folded into the emission above, so that
  // it is gated by the dust lanes (which really do cut across it) but NOT by
  // the cloud threshold — the band is visible where there is no nebula at all.
  vec3 poleN = normalize(vec3(0.36, 0.86, -0.35));
  float band = 1.0 - abs(dot(d, poleN));
  float milky = pow(clamp(band, 0.0, 1.0), 26.0);
  float mottle = fbm(d * 9.0, 3, 2.2, 0.5) * 0.5 + 0.5;
  vec3 milkyLight = vec3(0.5, 0.55, 0.74) * milky * (0.28 + mottle * 0.55) * mix(0.22, 1.0, lane);

  gl_FragColor = vec4((color * cloud + milkyLight) * uIntensity, 1.0);
}
`;

/* ───────────────────── a real deep-sky photograph ─────────────────────
   The Horsehead, hung in one direction of the sky as a quad.

   Additive blending is not a convenience here, it is the correct physics.
   The Horsehead is a *dark absorption* nebula: a column of cold dust seen in
   silhouette against the glowing hydrogen of IC 434 behind it. Added to the
   sky, the photograph's bright pink field contributes light and its dark
   dust column contributes nothing — which is exactly what a silhouette is.
   The horse appears as a hole in the glow, the same way it does in the sky.

   The quad's own edges are feathered to nothing so no rectangle is ever
   visible; without that the emission field, which runs to all four borders of
   the frame, would end in a hard line across empty space. */
export const SKYPHOTO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKYPHOTO_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uIntensity;
uniform vec3 uTint;
varying vec2 vUv;

void main() {
  vec3 c = texture2D(uMap, vUv).rgb;

  // Feather all four edges, then round the corners off with a radial falloff,
  // so the frame dissolves into the starfield instead of ending.
  vec2 e = smoothstep(vec2(0.0), vec2(0.34), vUv) * smoothstep(vec2(0.0), vec2(0.34), 1.0 - vUv);
  float mask = e.x * e.y;
  float r = length(vUv - 0.5) * 1.4142;
  mask *= 1.0 - smoothstep(0.5, 1.0, r);

  /* Pulled toward the scene's own cool palette. Left raw, the photograph's
     magenta is far more saturated than anything else in this sky and reads as
     a pasted-in picture rather than as something a long way away. */
  vec3 tinted = mix(c, c * uTint, 0.55);

  gl_FragColor = vec4(tinted * uIntensity, mask);
}
`;

/* ──────────────────────────── starfield ────────────────────────────
   Tens of thousands of stars as one Points draw. Each carries its own colour
   (a real sky is not white — colour is surface temperature), its own twinkle
   phase, and a size that survives the perspective divide, so distant stars
   stay points instead of collapsing to nothing. The disc is drawn in the
   fragment shader with a soft core and a cross-shaped diffraction flare on
   the brightest ones. */
export const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
attribute float aFlare;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vFlare;
varying float vTwinkle;
void main() {
  vColor = aColor;
  vFlare = aFlare;
  // Atmospheric scintillation, per star, at its own rate.
  vTwinkle = 0.62 + 0.38 * sin(uTime * (1.1 + aPhase * 2.4) + aPhase * 31.4);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (1.0 + vFlare * 1.6);
}
`;

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vFlare;
varying float vTwinkle;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  float core = exp(-d * d * 42.0);
  float halo = exp(-d * 7.0) * 0.35;

  // Diffraction spikes on the bright ones only — the horizontal/vertical
  // cross a lens throws. On every star it would look like a snowflake filter.
  float spike = 0.0;
  if (vFlare > 0.0) {
    float sx = exp(-abs(uv.y) * 120.0) * exp(-abs(uv.x) * 5.0);
    float sy = exp(-abs(uv.x) * 120.0) * exp(-abs(uv.y) * 5.0);
    spike = (sx + sy) * vFlare * 0.7;
  }

  float a = (core + halo + spike) * vTwinkle;
  gl_FragColor = vec4(vColor * (1.0 + core * 0.8), clamp(a, 0.0, 1.0));
}
`;

/* ──────────────────────── generic glow sprite ────────────────────────
   Used for the neutron stars, the comet heads, Io's plumes, Enceladus's
   geysers and the supernova knots. One material, per-instance colour and
   size — cheaper than a texture and it never pixelates when a body is
   metres from the camera. */
export const GLOW_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  /* Scaled by distance so a plume keeps its physical size rather than its
     screen size as the camera moves in. The constant is calibrated so that
     aSize reads as roughly the sprite's diameter in world units at this
     scene's field of view — which is what lets the neutron pair be sized
     against the bodies around it rather than by trial and error. */
  gl_PointSize = aSize * uPixelRatio * (900.0 / max(-mv.z, 1.0));
}
`;

export const GLOW_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float core = exp(-d * d * 30.0);
  float halo = exp(-d * 6.0) * 0.4;
  gl_FragColor = vec4(vColor * (0.6 + core), (core + halo) * vAlpha);
}
`;

/* ───────────────────── orbit trails ─────────────────────
   Each planet's track. A flat ring would be a hoop of dead line; instead the
   opacity runs around the ring with a bright head at the planet's own angular
   position, so every track reads as being *swept* by the body on it. */
export const TRAIL_VERT = /* glsl */ `
attribute float aAngle;
varying float vAngle;
void main() {
  vAngle = aAngle;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uHead;
uniform float uOpacity;
uniform float uFocus;
varying float vAngle;
void main() {
  // Angular distance behind the body, wrapped.
  float delta = mod(uHead - vAngle, 6.28318530718);
  // A short bright wake, then a long dim body of the ring.
  float wake = exp(-delta * 2.6);
  float base = 0.16 + uFocus * 0.5;
  float a = (base + wake * 0.9) * uOpacity;
  gl_FragColor = vec4(uColor * (0.7 + wake * 1.5 + uFocus * 0.6), a);
}
`;

/* ═══════════════════════ post-processing ═══════════════════════ */

/* ───────────────── gravitational lensing ─────────────────
   The one effect on this page that cannot be done in the scene graph: it has
   to happen after everything else is drawn, because it bends light that has
   already arrived. The frame is resampled through a deflection field centred
   on the hole's projected position, falling off with distance the way a real
   one does, plus:

   - a hard shadow inside the horizon, which is what makes it a *hole*;
   - an Einstein ring — the piled-up, stretched image of whatever is directly
     behind — at the photon sphere;
   - a small wavelength split, because the deflection is achromatic but the
     sampling isn't, and the fringe sells the distortion.

   Guarded on uStrength so it costs one texture fetch when the hole is
   offscreen or the quality tier has it switched off. */
export const LENSING_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    /** Hole centre in screen UV, 0..1. */
    uCenter: { value: [0.5, 0.5] },
    /** Apparent radius of the horizon, in UV units of the shorter axis. */
    uRadius: { value: 0.06 },
    uStrength: { value: 1.0 },
    uAspect: { value: 1.0 },
    uTime: { value: 0 },
    /** Rises while the hole is feeding — the ring brightens with it. */
    uFeed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uRadius;
    uniform float uStrength;
    uniform float uAspect;
    uniform float uTime;
    uniform float uFeed;
    varying vec2 vUv;

    void main() {
      if (uStrength <= 0.001 || uRadius <= 0.0001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // Work in an aspect-corrected space so the deflection is circular on
      // screen rather than an ellipse stretched by the viewport.
      vec2 d = vUv - uCenter;
      d.x *= uAspect;
      float r = length(d);
      float R = uRadius;

      // Einstein deflection ∝ 1/r. Softened at the core so the sample never
      // runs away, and cut off well outside the hole so the rest of the frame
      // is untouched.
      float rn = r / max(R, 0.0001);
      float bend = uStrength * R * 1.85 / (rn * rn * 0.55 + rn * 0.9 + 0.32);
      bend *= smoothstep(9.0, 1.05, rn); // no effect far away

      vec2 dir = r > 0.00001 ? d / r : vec2(0.0);
      vec2 offset = dir * bend;
      offset.x /= uAspect;

      // Achromatic in truth, split here by a hair so the ring fringes.
      vec2 uvR = vUv - offset * 0.965;
      vec2 uvG = vUv - offset;
      vec2 uvB = vUv - offset * 1.035;

      vec3 color = vec3(
        texture2D(tDiffuse, clamp(uvR, 0.0, 1.0)).r,
        texture2D(tDiffuse, clamp(uvG, 0.0, 1.0)).g,
        texture2D(tDiffuse, clamp(uvB, 0.0, 1.0)).b
      );

      /* The photon sphere: light that looped the hole and came back out. A
         thin, bright, slightly breathing ring at ~1.5 horizon radii.

         The angular term is deliberately low-frequency and low-amplitude. At
         seven lobes and 4% it did not read as a ripple at all — it turned the
         ring into a visible rotating heptagon, because a thin ring modulated
         n times around its circumference IS an n-gon. Three broad lobes at
         1% reads as the ring shimmering. */
      float ripple = 1.0 + 0.01 * sin(uTime * 1.7 + atan(d.y, d.x) * 3.0);
      float ring = exp(-pow((rn - 1.52 * ripple) * 13.0, 2.0));
      color += vec3(1.0, 0.93, 0.82) * ring * (0.42 + uFeed * 0.9) * uStrength;

      // The shadow. Nothing comes back out from inside, so nothing does here.
      float shadow = smoothstep(1.06, 0.92, rn);
      color *= 1.0 - shadow;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

/* ───────────────── final grade ─────────────────
   Everything that belongs to the *lens* rather than to the scene, in one
   pass: barrel chromatic aberration toward the corners, film grain, an
   anamorphic-ish vignette, and a gentle S-curve so the highlights roll off
   instead of clipping to flat white where the bloom piles up.

   uFlash is the neutron merger's gamma-ray burst — a whole-frame white lift
   that has to sit after the bloom, not before, or the bloom pass smears it
   into a wash and it stops reading as an instant. */
export const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    uAberration: { value: 1.0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 1.0 },
    uFlash: { value: 0 },
    uResolution: { value: [1, 1] },
    /** Rises during a camera fly-to: a touch of radial blur in the direction
     * of travel, which is what makes a dolly read as speed. */
    uWarp: { value: 0 },
    uCenter: { value: [0.5, 0.5] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uFlash;
    uniform float uWarp;
    uniform vec2 uCenter;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 fromCenter = uv - 0.5;
      float r2 = dot(fromCenter, fromCenter);

      /* Lateral chromatic aberration: zero in the middle, growing with r².
         The coefficient is small on purpose. This scene is mostly point
         lights, and a point split into three is not a "cinematic lens" — it
         is three stars where there was one. At 0.004 the extreme corner
         separates by roughly two pixels at 1440 wide, which reads as a lens
         and not as a fault. */
      vec2 ca = fromCenter * r2 * 0.004 * uAberration;
      vec3 color = vec3(
        texture2D(tDiffuse, uv - ca).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv + ca).b
      );

      // Radial streak during a fly-to. Eight taps is enough at the strengths
      // this ever runs at, and it is skipped entirely at rest.
      if (uWarp > 0.001) {
        vec2 dir = uv - uCenter;
        vec3 streak = vec3(0.0);
        for (int i = 1; i <= 8; i++) {
          float s = float(i) / 8.0;
          streak += texture2D(tDiffuse, uv - dir * s * 0.085 * uWarp).rgb;
        }
        color = mix(color, streak / 8.0, clamp(uWarp * 0.55, 0.0, 0.6));
      }

      // No highlight rolloff here on purpose. This pass is the one that
      // renders to the screen, and three applies the renderer's ACES tone
      // mapping to exactly the pass that does (it skips it for anything drawn
      // into a render target — which is every other pass in the chain). A
      // shoulder of our own on top of that one would compress the highlights
      // twice and turn the sun and the photon ring into flat grey discs.
      // Everything below is deliberately in linear HDR for the same reason:
      // vignetting is a lens falloff and belongs before the film curve.

      // Vignette, elliptical rather than round so wide viewports don't get a
      // dark bar down each side.
      vec2 v = fromCenter * vec2(1.0, 1.12);
      float vig = 1.0 - smoothstep(0.34, 0.92, length(v));
      color *= mix(1.0, 0.42 + 0.58 * vig, uVignette);

      color += vec3(1.0, 0.98, 0.94) * uFlash;

      // Grain last, so it sits on the image rather than being graded by it.
      float g = hash(uv * uResolution + fract(uTime) * 137.0) - 0.5;
      color += g * uGrain;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};
