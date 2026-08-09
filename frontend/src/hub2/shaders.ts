/* ============================================================================
   ORBIT II — the GLSL.
   ----------------------------------------------------------------------------
   Every surface on this page that isn't a photograph is computed per pixel
   here. The rule the whole file follows: light is *earned*, never painted on.
   A planet's rim glows because the shader knows where the sun is; the black
   hole's photon ring is bright because that is where light piled up before it
   escaped; the sky bends near the hole because the final pass actually
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
  /* The granulation runs finer than the supergranulation it rides on, and
     carries more of the result than it used to. At the old 7.0 and an even
     split the cells were the same size as the slow pattern underneath, so the
     two blurred into one lumpy wash; a real photosphere is a dense fine mottle
     over broad slow patches, and the eye reads the mottle first. This is also
     what the zoom is for — at the resting camera the star is small, and the
     detail is there for anyone who flies in. */
  float granule = fbm(p * 9.5 + vec3(0.0, uTime * 0.055, 0.0), 5, 2.15, 0.55);
  float super   = fbm(p * 2.3 - vec3(uTime * 0.021, 0.0, uTime * 0.017), 3, 2.0, 0.6);
  float flicker = snoise(p * 15.0 + vec3(uTime * 0.24)) * 0.5 + 0.5;

  float heat = granule * 0.64 + super * 0.36;
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
  color += vec3(1.0, 0.97, 0.72) * lane * (0.55 + uPulse * 0.5) * limb;

  /* Down from 1.35. The gain multiplies a colour that is already near the top
     of the range, so past a point it only pushes channels into clipping —
     which desaturates, and on a yellow star that means the middle of the disc
     goes white and the colour set above is thrown away. Bloom adds the
     brightness back without taking the hue with it, so where the star needs to
     read brighter the ramp is lifted rather than this. */
  gl_FragColor = vec4(color * (1.3 + uPulse * 0.5), 1.0);
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
/** How sharply the glow dies past the photosphere. Higher is tighter.
 *
 * This is the knob that sets how far the flame reaches, and it is the only one
 * that can: the glow lives in the band between uUnit and the plane's edge, so
 * shrinking the plane to shorten the flame instead squeezes the band to
 * nothing and the corona disappears altogether. */
uniform float uFalloff;
varying vec2 vDisc;

${NOISE}

void main() {
  float r = length(vDisc);
  if (r > 1.0) discard;

  // Brightest just off the limb, then a short exponential tail outward — the
  // shape a real corona actually has. Tight: a broad falloff turns the star
  // into a bonfire and swallows Mercury's and Venus's orbits whole.
  float d = max(r - uUnit, 0.0) / max(1.0 - uUnit, 0.0001);
  float glow = exp(-pow(d * uFalloff, 1.15));

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
/** Live index move, -1..1. Tints the terminator: red into the shadow on an up
 * day, blue on a down day. Subtle by design — this is a wash over the night
 * side, not a recolour of the planet. */
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

  // Market wash, into the shadow only. Red up, blue down, same as the HUD's
  // --up / --down: the planet and the number printed next to it must not
  // disagree about which way the market went.
  vec3 trendTint = uTrend >= 0.0 ? vec3(1.0, 0.34, 0.42) : vec3(0.31, 0.61, 1.0);
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
   Gas spiralling in, heated by friction. Two things make it read as a real
   accretion disc rather than an orange donut:

   - a temperature gradient. The inner edge is orbiting at a large fraction of
     c and is genuinely hotter — it goes white-blue, not brighter orange.
   - shear. The turbulence is sampled in a coordinate frame that rotates
     faster at small radii, so the filaments wind up into spiral arms on their
     own instead of being drawn as spirals.

   There was a third: Doppler beaming, which boosted the limb rotating toward
   the camera and dimmed the one rotating away — the lopsided disc of the 2019
   EHT image and of Interstellar's Gargantua. It is gone at the owner's
   request. It is worth knowing what went with it, because the term was doing
   more than it looked: the boost ran from about 0.09 to 3.9 around the ring,
   a forty-fold swing, and that swing was most of what stopped the disc reading
   as a flat ring of gas rather than as something orbiting. What is left is
   even brightness all the way round, lifted to the average the beaming used to
   produce so the disc as a whole is no dimmer than it was. */
export const DISC_VERT = /* glsl */ `
varying vec3 vPosL;
void main() {
  vPosL = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uInner;
uniform float uOuter;
/** Rises while the hole is feeding (Pluto, then the blue star). */
uniform float uFeed;
/** The afterglow. For a few seconds after each meal the disc burns the colour
 * of what it just swallowed — gold after the rock, blue-white after the star.
 * Real accretion discs do change colour as infalling material changes their
 * composition and temperature; the specific hues here are a reading aid, not a
 * spectrum. uGlowMix crossfades it against the disc's own thermal ramp so the
 * structure — the filaments, the photon ring — survives the recolour instead
 * of being flooded flat. */
uniform vec3 uGlowTint;
uniform float uGlowMix;
varying vec3 vPosL;

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

  /* Even all the way round — see the section comment on the beaming that used
     to sit here. Both constants are the old ones times 1.35, the mean of the
     beaming factor weighted by where the disc actually has density, so total
     output is unchanged and only its distribution is.

     The uFeed response no longer needs the restraint it was written with. It
     was held down because it multiplied the beaming factor, which on the
     approaching limb was already several times unity, so any generous value
     took the one lobe that was brightest and drove it past white — which is
     what used to read as the hole shining. With nothing to compound against,
     feeding now lifts the whole ring together. Still zero at uFeed = 0. */
  float brightness = density * (1.69 + uFeed * 0.74);
  color *= brightness;

  // The photon ring: light that orbited the hole before escaping, piling up
  // just outside the horizon. Always white, always the brightest thing here.
  float photon = exp(-pow((t - 0.012) * 130.0, 2.0));
  color += vec3(1.0, 0.97, 0.9) * photon * (2.4 + uFeed * 0.7);

  if (uGlowMix > 0.001) {
    /* Same shape, different light: the tint is modulated by exactly the terms
       that drew the disc, so nothing is painted over.

       The multipliers are held down deliberately. The disc's own brightness
       already carries uFeed, which is itself raised during an afterglow, so a
       generous factor here compounds with it — at the first attempt the blue
       glow drove every channel past white and the hole vanished inside a flat
       featureless blob. A recolour that saturates to white is not a recolour;
       the whole point is that the colour survives. */
    vec3 tinted = uGlowTint * (0.25 + brightness * 0.35 + photon * 0.7);
    color = mix(color, tinted, uGlowMix);
  }

  float alpha = clamp(density * 1.7 + photon * 1.4, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

/* ─────────────────────────── the relativistic jet ───────────────────────────
   What comes back out. A hole that has just swallowed something does not only
   glow: a fraction of the infalling matter is flung out along the spin axis —
   perpendicular to the disc, in both directions at once — as a narrow beam
   that outruns everything else in the scene.

   Drawn as one narrow open cone whose UV runs 0 at the horizon to 1 at the
   head, so everything below is a function of distance along the beam:

   - `uHead` is where the front of it has got to. It races out over the first
     fraction of a second, which is what makes the beam *fire* rather than
     simply appear at full length.
   - The knots are internal shocks — real jets are beaded, not smooth, and the
     beads travel outward, which is the only motion in the beam that the eye
     can actually follow at this length.

   There used to be a limb term here, and a wide hollow sheath cone for it to
   act on: a tube of gas is brightest where the line of sight grazes its wall,
   so lighting the silhouette is how a hollow cone is made to read as a solid
   beam. Both are gone. The width of the jet is carried by the ropes of smoke
   that twist around it now (see updateJetParticles), and those are real
   travelling grains rather than a lit surface — so what is left for the cone
   to be is the single filament of light down the middle, which needs no limb
   because it is not hollow to the eye at this thickness. */
export const JET_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const JET_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHead;
uniform float uEnergy;
uniform vec3 uHot;
uniform vec3 uCool;
varying vec2 vUv;

void main() {
  float s = vUv.y;

  // Nothing exists ahead of the head, and the head itself is the brightest
  // part of the beam: that is where it is ploughing into the sky.
  float front = 1.0 - smoothstep(uHead - 0.05, uHead, s);
  // Squared by multiplication, not pow(): behind the head the base is negative
  // and pow() of a negative base is undefined in GLSL — which is most of the
  // beam, so this is not a corner case.
  float behind = (s - uHead) * 26.0;
  float shock = exp(-behind * behind) * step(s, uHead);

  // Thins with distance, but never to nothing before the head — a jet that
  // faded out on its own would never look like it reached anywhere.
  float fall = pow(1.0 - s * 0.86, 1.15);

  // Internal shocks, travelling out along the beam.
  float knot = 0.66 + 0.34 * sin(s * 30.0 - uTime * 14.0);
  float flick = 0.86 + 0.14 * sin(uTime * 41.0 + s * 7.0);

  /* The beam emerges from the throat rather than existing at it. The cone's
     first slice is both its whitest (see the colour mix below) and its
     narrowest, so without this ramp it is a small white disc pinned to the
     horizon — through the bloom, a lamp where the hole should be. The gas
     particles that climb the beam are faded in over the same stretch, so the
     two agree about where the beam starts. */
  float emerge = smoothstep(0.0, 0.06, s);

  float body = front * fall * knot * flick * uEnergy * emerge;
  body += shock * uEnergy * 1.4;

  // Hot and white at the base, cooling out along its length.
  vec3 color = mix(uHot, uCool, smoothstep(0.02, 0.55, s));
  /* No white core at the root. There used to be one — an exp(-s * 30) lift
     that made the first few percent of the beam brighter than anything else
     in the scene — and through the bloom it stopped reading as a beam leaving
     a hole and started reading as a second sun sitting where the hole is. The
     whole subject here is an object that does not shine; the light belongs to
     the disc and to the gas climbing the beam, and both draw themselves. */

  gl_FragColor = vec4(color * body, clamp(body, 0.0, 1.0));
}
`;

/* ─────────────────────────── the pulsar beam ───────────────────────────
   The neutron stars' own beams, and the merged remnant's. Same subject as the
   jet above and a deliberately different treatment, because it is a different
   thing to look at: the jet is gas being flung out and is made of travelling
   grains, and this is a SHAFT OF LIGHT — a single filled ray leaving the poles,
   which has to arrive straight, at one width, with nothing scattering off it.

   So: a closed cylinder run through the star, both poles at once, drawn as one
   piece rather than as a crowd of sprites. Its UV.y runs 0 at one tip to 1 at
   the other, and the whole shader is a function of `d`, the distance from the
   star toward either tip, which is what makes the two halves mirror without
   being two objects.

   NOTHING here travels. There was a pulse climbing the shaft and it is gone:
   the motion in this object is the axis turning, and a bright thing running
   out along the beam competes with that — it draws the eye down the ray and
   away from the sweep, which is the only thing there is to watch. What is left
   is a steady ray, dim enough to be a lit line rather than a lamp, that simply
   points wherever the axis is pointing.

   The one term that is not about distance is the limb. A cylinder is a
   surface, and additive blending sums the near wall and the far one, so left
   alone it draws as a hollow tube with two hot edges and a dark middle:
   exactly the "spreading" read that a solid ray must not have. Weighting by
   how square-on the wall faces the camera inverts that. Down the middle of the
   shaft the wall faces the camera and gets everything; at the silhouette it is
   edge-on and falls away. What comes out is a ray that is brightest along its
   axis and soft at its two sides — filled, not hollow, and the same shape from
   every angle. */
export const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  /* How square-on this bit of wall is to the camera: 1 down the centreline of
     the shaft, 0 at its silhouette. See the limb note above. */
  vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

export const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGain;
varying vec2 vUv;
varying float vFace;

void main() {
  // Distance from the star toward either tip. The star sits at uv.y 0.5.
  float d = abs(vUv.y - 0.5) * 2.0;

  /* The ray, and the whole of it: lit end to end, all the time, at one
     brightness that only falls off toward the tips so that it finishes by
     running out rather than by being cut. No head, no travelling anything —
     a lamp pointed along the axis. */
  float shaft = pow(1.0 - d * 0.88, 1.6) * 0.19;

  /* Filled, not hollow. The floor is what keeps the sides of the ray from
     going to nothing — a shaft with hard edges reads as a drawn line, and one
     with none reads as a smear; this is the narrow band between them. */
  float fill = pow(vFace, 1.7) * 0.82 + 0.18;

  float body = shaft * fill * uGain;
  if (body <= 0.0) discard;
  gl_FragColor = vec4(uColor, clamp(body, 0.0, 1.0));
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
/** The axis the galactic plane is perpendicular to. Shared with the sky
 *  photograph's own orientation, so the painted glow and the photographed
 *  band are the same band. */
uniform vec3 uGalacticPole;
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

  /* The galactic plane, as diffuse light around the photograph that now draws
     the band itself (see MILKYWAY_FRAG). Kept as its own term rather than
     folded into the emission above, so that it is gated by the dust lanes
     (which really do cut across it) but NOT by the cloud threshold — the glow
     is there where there is no nebula at all.

     Two widths, and the wide one carries most of it. A single high power was
     a hard bright stripe a few degrees thick, which is what a galaxy looks
     like in a long exposure and not at all what one looks like overhead: the
     real thing is a broad wash of unresolved stars that fades over tens of
     degrees, with only its core concentrated. The halo term is that wash. */
  float band = clamp(1.0 - abs(dot(d, normalize(uGalacticPole))), 0.0, 1.0);
  float halo = pow(band, 3.0);
  float core = pow(band, 12.0);
  float milky = halo * 0.55 + core * 0.6;
  float mottle = fbm(d * 9.0, 3, 2.2, 0.5) * 0.5 + 0.5;
  vec3 milkyLight = vec3(0.5, 0.55, 0.74) * milky * (0.28 + mottle * 0.55) * mix(0.22, 1.0, lane);

  gl_FragColor = vec4((color * cloud + milkyLight) * uIntensity, 1.0);
}
`;

/* ─────────────────────── the Milky Way, photographed ───────────────────────
   A 360° panorama of the real sky (ESO/S. Brunier, CC BY 4.0) mapped onto the
   inside of a sphere, so the band of the galaxy is a photograph rather than a
   procedural stripe.

   Sampled through the sphere's own UVs rather than from the view direction.
   Equirectangular sampling by atan(z, x) has a seam down the back of the sky:
   the wrap from u=1 to u=0 makes the texture derivative enormous for one
   column of pixels, the GPU picks the smallest mip there, and the result is a
   visible bright line. SphereGeometry duplicates its seam vertices with u=0
   and u=1, so interpolating the attribute is continuous everywhere and the
   line never appears.

   Two things are done to the photograph on the way in. It is stretched off
   its own equator (uWiden), because the panorama's band is only a few degrees
   thick and a sky whose galaxy is a thin bright stripe reads as a decal on
   black. And a heavily smeared copy of it is added back (uHaze), which puts
   the band's light into the sky around it the way a real galaxy's unresolved
   stars do. */
export const MILKYWAY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const MILKYWAY_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uIntensity;
/** > 1 pulls the panorama away from its equator, widening the band. */
uniform float uWiden;
uniform float uHaze;
uniform vec3 uTint;
varying vec2 vUv;

vec3 tap(float widen, float dv) {
  float v = clamp(0.5 + (vUv.y - 0.5) / widen + dv, 0.0, 1.0);
  return texture2D(uMap, vec2(vUv.x, v)).rgb;
}

void main() {
  vec3 sharp = tap(uWiden, 0.0);

  // Five taps across a much wider copy: a cheap vertical blur that turns the
  // core into a glow spread over a good fraction of the sky.
  vec3 haze = vec3(0.0);
  for (int i = -2; i <= 2; i++) {
    haze += tap(uWiden * 2.7, float(i) * 0.035);
  }
  haze *= 0.2;

  /* Pulled toward the scene's own cool palette, for the same reason the
     Horsehead is: the panorama's core is a warm orange that reads as a
     sunrise if it is left alone next to this page's blues. */
  vec3 color = sharp + haze * uHaze;
  color = mix(color, color * uTint, 0.6);

  gl_FragColor = vec4(color * uIntensity, 1.0);
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
   geysers, the supernova knots and the jet's smoke. One material,
   per-instance colour and size — cheaper than a texture and it never
   pixelates when a body is metres from the camera.

   Two profiles, chosen per instance by aSoft, because the pool is asked for
   two different things. At 0 it is a bead: a hot centre inside a small halo,
   which is what a neutron star or a comet head is — a bright point with light
   around it. At 1 it is a puff of cloud: no centre at all, and an edge that
   falls to nothing across the whole sprite. That second profile is the only
   way a few hundred of these add up to smoke. A bead has a visible middle and
   a visible rim, so a crowd of them stays a crowd of them however many there
   are; a profile that is flat on top and zero at the edge has neither, and
   overlapping ones merge into one body with no seam to see. */
export const GLOW_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSoft;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vSoft = aSoft;
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
varying float vSoft;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  // The bead.
  float core = exp(-d * d * 30.0);
  float halo = exp(-d * 6.0) * 0.4;

  /* The puff. Smoothstep rather than a power: it is flat at the centre and
     flat again where it meets zero, so a sprite has no bright middle to give
     itself away and no rim where it stops. The exp() falloffs above never
     quite reach zero, and at this size that residue is a visible disc edge
     exactly at the discard. */
  float t = 1.0 - d * 2.0;
  /* The 0.72 is what the puff peaks at against the bead's core+halo, which
     peaks near 1.4. Some of that gap is the point — a puff should not be a
     bead — but the first pass set it at 0.5, and between that and the lower
     per-instance alpha the smoke came out nearly three times fainter than the
     grains it replaced and simply was not visible against the sky. */
  float puff = t * t * (3.0 - 2.0 * t) * 0.72;

  /* Flat colour for the puff, too. The bead brightens toward its centre,
     which is a hot body seen through its own glow; smoke has no such centre,
     and lighting one makes each sprite legible again as a sprite. */
  vec3 rgb = vColor * mix(0.6 + core, 0.95, vSoft);
  float alpha = mix(core + halo, puff, vSoft) * vAlpha;
  gl_FragColor = vec4(rgb, alpha);
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

/* ──────────────────────────── the wormhole ────────────────────────────
   A sphere, not a disc — which is the one thing about Interstellar's that
   most pictures of a wormhole get wrong. A tunnel drawn as a funnel is a
   diagram of a wormhole seen from a dimension we do not have; the real
   thing, seen from here, is a ball with another sky inside it.

   The whole of that look comes out of one mapping. A sphere's surface
   projects onto its own silhouette as sin(theta), so undoing it — tan(asin r)
   — is what a fisheye lens does: the entire far sky is squeezed into the
   ball, crowded harder and harder toward the edge, with infinity landing
   exactly on the silhouette. That divergence is why this reads as a lens
   with something behind it rather than as a painted marble, and it is also
   the reason for the bright rim: where the mapping diverges, every image of
   the far sky piles up on top of every other one, which is a thin bright
   line — the same pile-up the black hole's photon ring is, arrived at the
   same way.

   The stars are three sheets of cell noise in that expanded plane, sheared
   by a rotation that runs faster near the middle than at the mouth. That
   shear is the whole of "flowing": rotate the field rigidly and it reads as
   a texture on a ball being turned, which is the marble again. */
export const WORMHOLE_VERT = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const WORMHOLE_FRAG = /* glsl */ `
uniform float uTime;
/** 0 seen from across the system, 1 up against it. Only the finest sheet of
 * stars rides on this: at a distance the ball is a few pixels across and a
 * field that fine is not detail, it is noise crawling. */
uniform float uNear;
/** Where the silhouette actually falls, as a length of the view-space
 * normal's xy — see the note in main(). */
uniform float uEdge;
uniform vec3 uRim;
uniform vec3 uHaze;
varying vec3 vNormal;

${NOISE}

vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

/* One sheet of stars: a cell grid with a point somewhere inside each cell.
   The jitter is kept off the walls so a star is never clipped in half by the
   cell it belongs to, which is the one artefact this construction has.

   The sheet turns as a whole — rot is a plain angle, the same for every
   fragment in it. That is not a simplification, it is the fix for the version
   before it, which turned the field by an angle computed from the fragment's
   own radius so that the middle swept faster than the mouth. Sheared per
   fragment, a star is not a point being carried round: the inner edge of it
   moves further than the outer edge and it is drawn as an arc. And the arc
   grows, because the shear is the radial derivative of t * f(r) and t only
   ever increases — a minute in, the stars were commas; ten minutes in they
   would have been rings. It is the winding problem that does for the
   density-wave-less model of spiral arms, arrived at by accident.

   Differential rotation survives it: the three sheets are three depths into
   the far sky and turn at three rates, which is the same shear sampled at
   three places instead of continuously, and no sheet shears against itself. */
vec3 sheet(vec2 p, float scale, float rot, float t, vec3 tint, float gain) {
  float c = cos(rot), s = sin(rot);
  vec2 q = mat2(c, -s, s, c) * p * scale;
  vec2 g = floor(q);
  vec2 o = hash22(g);
  /* Jitter across most of the cell, and a star small enough that the whole of
     it still fits. Both halves of that matter. Kept near the middle — the
     first try allowed 0.32 to 0.68 of a cell — the points sit on a lattice and
     the eye finds it instantly: what should be a star field reads as beads on
     a net. Widening the jitter without shrinking the star only trades the
     lattice for stars clipped square by the cell wall they overrun, because
     one cell is all this looks at. 0.18 of jitter each way against a radius of
     0.17 is the pair that fixes both at one tap. */
  float d = length(fract(q) - (0.18 + o * 0.64));
  float core = smoothstep(0.17, 0.0, d);
  // Cubed: a point with a halo around it rather than a soft blob.
  core *= core * core;
  float flicker = 0.74 + 0.26 * sin(t * 2.3 + o.x * 63.0 + o.y * 21.0);
  float mag = 0.32 + hash12(g + 7.3) * 0.68;
  return tint * (core * flicker * mag * gain);
}

void main() {
  /* In view space a sphere's normal.xy IS its position on the apparent disc.
     No projection, no screen-space anything — the one number this whole
     shader needs falls out of the interpolated normal.

     What it is NOT is normalised to 1 at the edge. That is true looking at a
     sphere from infinitely far away; from a real camera at distance dd the
     silhouette is where the normal is square to the line of sight, which
     works out at |n.xy| = sqrt(1 - (R/dd)^2), and the whole back of that
     figure is hidden. It is 0.99 across the room and 0.63 with the camera up
     against it — so a rim line drawn at a fixed 0.98 sits on the sphere at
     arm's length and a long way off the edge of it up close, which is exactly
     where this effect is supposed to be at its best. uEdge is that figure,
     and dividing by it puts the silhouette back at 1 from any distance. */
  vec2 d = vNormal.xy;
  float r = min(length(d) / uEdge, 0.9999);
  float lens = r / sqrt(max(1.0 - r * r, 1e-5));

  vec2 p = (r > 1e-5 ? d / r : vec2(0.0)) * lens;

  /* Three sheets, each turning at its own rate and drifting its own way,
     which is what gives the inside a depth: near stars slide across far ones,
     and the whole field shears between the layers rather than within them.
     The drift matters as much as the turn — a rotation alone is a plate
     spinning, and what is wanted is material going somewhere. It is a
     straight translation in the FAR sky, so the lens does the rest: a star
     moving at a constant rate out there slows and crowds as it nears the rim,
     which is the flow reading the mapping gives for free. */
  vec3 sky = vec3(0.0);
  sky += sheet(p + vec2(0.012, 0.055) * uTime, 10.0, uTime * 0.13, uTime, vec3(0.74, 0.84, 1.0), 5.0);
  sky += sheet(p + vec2(-0.042, 0.018) * uTime, 21.0, uTime * -0.085, uTime + 11.0, vec3(1.0, 0.94, 0.86), 3.4);
  sky += sheet(p + vec2(0.021, -0.031) * uTime, 43.0, uTime * 0.055, uTime + 23.0, vec3(0.88, 0.8, 1.0), 2.6 * uNear);

  /* The far side is not black paper with dots on it. A few turns of haze —
     the galaxy those stars belong to, too far off to resolve. Faint on
     purpose: it is the thing the stars are seen against, not a thing in its
     own right. */
  float haze = fbm(vec3(p * 0.85, uTime * 0.04), 3, 2.2, 0.5) * 0.5 + 0.5;
  sky += uHaze * pow(haze, 2.2) * 1.15;

  /* Where the mapping runs away, hand over to the ring. A star field sampled
     out there is one pixel per hundred cells, which is not a dense field, it
     is aliasing — and it is also not what would be seen: past the pile-up
     the images stop being separable. */
  vec3 color = sky * smoothstep(0.995, 0.90, r);

  /* The pile-up itself: a broad brightening into the rim, and the thin line
     on the silhouette where the divergence actually is.

     Both are a fraction of what they were first tried at. There is a bloom
     pass downstream, and a ring is the shape it treats worst — every pixel of
     it has bright neighbours the whole way round, so it blooms into itself
     and comes back as a solid disc of glare with a blue halo standing several
     radii off the body. At these levels the line is still the brightest thing
     on the sphere and the bloom only softens it. */
  float shoulder = pow(smoothstep(0.66, 1.0, r), 4.0);
  float edge = exp(-pow((r - 0.972) * 46.0, 2.0));
  /* Brighter the further off it is, which is not a cheat and is the opposite
     of one. The line is a fixed fraction of the body's width, so past a
     certain distance it is thinner than a pixel — and a pixel that is one
     part ring to five parts sky is sampled as one fifth of a ring. The light
     does not go anywhere in reality; an unresolved source puts all of its
     flux into the pixel it lands in, which is why a star a million times
     smaller than a pixel is still the brightest thing in the frame. Giving it
     back what the sampling takes is what keeps the wormhole a ring at the
     range you first see it from instead of a grey smudge. */
  color += uRim * (shoulder * 0.3 + edge * 1.0) * (1.0 + (1.0 - uNear) * 1.1);

  gl_FragColor = vec4(color, 1.0);
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

   Two masses bend this frame, not one: the hole, and the wormhole off
   Saturn. They share the three texture fetches rather than costing three
   each — a deflection field is a displacement, and displacements add, so the
   two are summed before anything is sampled. What cannot be summed is what
   each one does to the light it is *not* displacing: the shadow and the
   photon ring belong to the hole alone and are applied after.

   Guarded on both strengths so it costs one texture fetch when neither is on
   screen or the quality tier has it switched off. */
export const LENSING_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    /** Hole centre in screen UV, 0..1. */
    uCenter: { value: [0.5, 0.5] },
    /** Apparent radius of the horizon, in UV units of the shorter axis. */
    uRadius: { value: 0.06 },
    uStrength: { value: 1.0 },
    /** The wormhole, in the same units. Its deflection is an annulus rather
     * than a well: the sphere itself is drawn in the scene and is not black,
     * so bending the pixels it occupies would smear the far sky that is the
     * whole point of it. What is bent is the ring of real sky just outside. */
    uCenter2: { value: [0.5, 0.5] },
    uRadius2: { value: 0.0 },
    uStrength2: { value: 0.0 },
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
    uniform vec2 uCenter2;
    uniform float uRadius2;
    uniform float uStrength2;
    uniform float uAspect;
    uniform float uTime;
    uniform float uFeed;
    varying vec2 vUv;

    void main() {
      bool hole = uStrength > 0.001 && uRadius > 0.0001;
      bool worm = uStrength2 > 0.001 && uRadius2 > 0.0001;
      if (!hole && !worm) {
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

      /* And the wormhole's, added to it. Same 1/r law, windowed into a ring:
         nothing inside its own silhouette, up over the first half-radius
         outside it, gone by seven. What that draws is the band of real sky
         immediately around the sphere being dragged into a circle — which is
         the part of a lens the eye actually reads, and the part the sphere's
         own shader cannot draw, because it is made of the scene behind it. */
      vec2 d2 = vUv - uCenter2;
      d2.x *= uAspect;
      float r2 = length(d2);
      float rn2 = r2 / max(uRadius2, 0.0001);
      float bend2 = uStrength2 * uRadius2 * 0.95 / (rn2 * rn2 * 0.5 + rn2 * 0.8 + 0.4);
      /* Held off the rim itself. Started at the silhouette, the strongest part
         of the deflection landed on the brightest line in the frame and pulled
         it outward — which does not read as sky being bent, it reads as the
         sphere having spikes. Clear of the body by a third of its radius
         before anything moves, and the thing being dragged round is then the
         real sky, which is what a lens is for. */
      bend2 *= smoothstep(1.12, 1.8, rn2) * smoothstep(7.5, 1.8, rn2);
      offset += (r2 > 0.00001 ? d2 / r2 : vec2(0.0)) * bend2;

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

      /* The shadow. Nothing comes back out from inside, so nothing does here.
         Gated on the hole being on screen at all, which it did not used to
         need: the early return above was the gate, and reaching this line
         meant uStrength was already non-zero. Now the wormhole can be the
         reason this shader is running, and without the gate an off-screen
         hole would still stamp a black disc wherever uCenter was left. */
      float shadow = hole ? smoothstep(1.06, 0.92, rn) : 0.0;
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

   uFlash is a whole-frame lift that has to sit after the bloom, not before, or
   the bloom pass smears it into a wash and it stops reading as an instant. Two
   things drive it: the neutron merger's gamma-ray burst, and the last moment
   of a dive into a body. uFlashTint is what separates them — the burst is the
   white it always was, a dive takes the colour of whatever it is falling
   into. */
export const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    uAberration: { value: 1.0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 1.0 },
    uFlash: { value: 0 },
    uFlashTint: { value: [1.0, 0.98, 0.94] },
    /** Fade to black. 0 is the image, 1 is nothing at all. Driven by the auto
     * tour's ending, which falls into the hole and takes the picture with it.
     * Separate from uFlash rather than a negative one of it: a flash is added
     * light and this is the absence of it, and the two have to be able to
     * happen at once — the last thing the fall does is blow out and then go
     * dark. */
    uFade: { value: 0 },
    /** The fall into the hole, 0 to 1. Three things at once, because being
     * swallowed is not one effect: the picture is wound round the middle, the
     * frame closes to a point, and what is left of the colour goes cold. All
     * of it keyed to the centre, which during the fall is where the hole is —
     * the camera is looking straight down it. Separate from uFade, which is
     * the flat blackout that follows: this is the going, that is the gone. */
    uCollapse: { value: 0 },
    /** Lost signal, 0 to 1. What the far side of the fall looks like on the
     * way to the plate: a dead channel, coming up out of the black. */
    uStatic: { value: 0 },
    /** The plate held on the far side of the fall: one still image, shown for
     * five seconds between the static and the return. */
    tPlate: { value: null as unknown },
    /** How much of it is on screen, 0 to 1. */
    uPlate: { value: 0 },
    /** Seconds since the stone hit the water. Drives the rings; see the plate
     * block in the fragment shader. */
    uRipple: { value: 0 },
    /** The plate's aspect, so it can be covered into the frame rather than
     * stretched to it. */
    uPlateAspect: { value: 1 },
    uResolution: { value: [1, 1] },
    /** Rises during a camera fly-to: a touch of radial blur in the direction
     * of travel, which is what makes a dolly read as speed. A dive drives it
     * several times higher, and unlike a fly-to it accelerates all the way in
     * rather than peaking in the middle. */
    uWarp: { value: 0 },
    /** Where the streaks converge, in screen UV. Frame centre for a fly-to;
     * the body itself for a dive, which is not the same point until the very
     * end of one. */
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
    uniform vec3 uFlashTint;
    uniform float uFade;
    uniform float uCollapse;
    uniform float uStatic;
    uniform sampler2D tPlate;
    uniform float uPlate;
    uniform float uRipple;
    uniform float uPlateAspect;
    uniform float uWarp;
    uniform vec2 uCenter;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      // Screen-space, and deliberately not the swirled coordinate below: the
      // aberration and the vignette are properties of the lens, and the lens
      // is not the thing falling in.
      vec2 fromCenter = vUv - 0.5;
      float aspect = uResolution.x / max(uResolution.y, 1.0);

      /* The swirl. The image is rotated about the middle by an angle that
         grows towards it — the far corners barely move and everything near
         the centre is wound round several times, which is what makes it read
         as being drawn *in* rather than merely spun. The +0.16 is what stops
         the very middle going to infinity and tearing.

         It is applied to the sampling coordinate only, and before everything
         else, so the whole rendered frame is what gets wound — bloom, stars,
         the disc and all. Doing it to the disc alone would be a spinning disc
         in a still frame. */
      if (uCollapse > 0.001) {
        vec2 p = fromCenter * vec2(aspect, 1.0);
        float d = length(p);
        float a = uCollapse * 1.4 / (d + 0.16);
        float c = cos(a), s = sin(a);
        vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        // Pulled inward as well as round, so it is a drain and not a turntable.
        q *= 1.0 - uCollapse * 0.3;
        uv = vec2(q.x / aspect, q.y) + 0.5;
      }

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

      /* The aperture, closing. Everything outside a shrinking circle centred
         on the hole goes to nothing, so the picture is not dimmed evenly but
         eaten from the edges inward — the last thing on screen is the thing
         being fallen into, alone in the middle of the dark.

         And the colour goes before the light does. What survives is pushed
         toward a cold blue-white, which is both the cheap version of the real
         effect and the honest one: everything arriving from behind is redder
         and everything ahead is bluer, and past a point there is no longer
         enough of anything left to be a colour. */
      if (uCollapse > 0.001) {
        vec2 p = fromCenter * vec2(aspect, 1.0);
        float d = length(p) / 0.72;
        float aperture = mix(2.1, 0.02, uCollapse * uCollapse);
        color *= 1.0 - smoothstep(aperture * 0.34, aperture, d);
        float grey = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(color, vec3(grey) * vec3(0.42, 0.6, 1.2), uCollapse * 0.82);
      }

      // Vignette, elliptical rather than round so wide viewports don't get a
      // dark bar down each side.
      vec2 v = fromCenter * vec2(1.0, 1.12);
      float vig = 1.0 - smoothstep(0.34, 0.92, length(v));
      color *= mix(1.0, 0.42 + 0.58 * vig, uVignette);

      color += uFlashTint * uFlash;

      // Grain last, so it sits on the image rather than being graded by it.
      float g = hash(uv * uResolution + fract(uTime) * 137.0) - 0.5;
      color += g * uGrain;

      /* The fade, after everything including the grain — a fade that leaves
         the grain behind ends on a screen of static rather than on black, and
         the whole point of this one is that there is nothing left. */
      color *= 1.0 - uFade;

      /* Snow. An analogue set tuned to a channel that is not broadcasting —
         which is what the far side of the hole gets, because the alternative
         is a black screen, and a black screen is indistinguishable from the
         page having stopped.
         Four things, because plain white noise reads as a computer's idea of
         noise rather than as a television's:
           - two grains at two scales, the coarse one on a slower clock, since
             a real set's snow has structure in it as well as sparkle;
           - horizontal tear bands on their own fast clock, which is the part
             that actually says "no signal" — the noise on a CRT arrives a
             line at a time, so it correlates along rows and not down columns;
           - scanlines, at the screen's own pixel pitch;
           - and one soft bar rolling up the frame, the vertical hold giving
             way. Nothing on the set is doing that; it is the set failing to
             find something that is not there. */
      if (uStatic > 0.001) {
        vec2 px = vUv * uResolution;
        float fine = hash(px + fract(uTime * 1.7) * 917.0);
        float coarse = hash(floor(px / 3.0) + fract(uTime * 0.6) * 331.0);
        float snow = mix(fine, coarse, 0.35);

        float line = hash(vec2(floor(px.y), floor(uTime * 26.0) * 1.7));
        snow = mix(snow, line, 0.28);

        // Contrast climbs with the signal loss: it starts as a grey haze and
        // ends as hard black-and-white grain.
        snow = clamp(0.5 + (snow - 0.5) * (0.9 + uStatic * 1.7), 0.0, 1.0);
        /* Scanlines on a period of about seven device pixels rather than one.
           At one they land at the pixel pitch, which on a 2× display is half a
           CSS pixel and comes back as moiré instead of as lines. */
        snow *= 0.78 + 0.22 * sin(px.y * 0.9);

        float roll = smoothstep(0.09, 0.0, abs(fract(vUv.y + uTime * 0.31) - 0.5));
        // Lifted for the same reason the plate is: this pass goes through the
        // renderer's film curve, and grey that is not lifted arrives as dark
        // grey. Snow on a dead channel is bright.
        vec3 signal = vec3(snow * 1.75 + roll * 0.22);
        color = mix(color, signal, uStatic);
      }

      /* And the plate, over the top of all of it, because it is not part of
         the scene — it is what is on the other side of the fall.
         The rings are a stone dropped in the middle of it. A ripple is a
         displacement, not a brightness: the surface is disturbed and what you
         see is the image *through* the disturbed surface, so the sample point
         is pushed along the radius by a travelling sine and the picture warps
         with it rather than having rings painted on it.
           - sin(d * 44 - uRipple * 7) is the wave train, moving outward.
           - It is windowed by exp(-x*x) around a front that expands at a
             fixed speed, so there is a ring of active water with calm inside
             and ahead of it, instead of the whole surface shaking at once.
           - The amplitude decays with time and with radius, because a real
             one loses to both. */
      if (uPlate > 0.001) {
        vec2 p = fromCenter * vec2(aspect, 1.0);
        float d = length(p);
        float front = uRipple * 0.34;
        float band = (d - front) * 3.4;
        float envelope = exp(-band * band) * exp(-uRipple * 0.62) / (1.0 + d * 2.6);
        float wave = sin(d * 44.0 - uRipple * 7.0);
        vec2 dir = d > 0.0001 ? p / d : vec2(0.0);
        vec2 pushed = p + dir * wave * envelope * 0.055;

        /* Cover, not stretch: the wider of the two axes is cropped so the
           image keeps its proportions at any viewport shape. */
        vec2 plateUv = pushed;
        if (aspect > uPlateAspect) plateUv.y *= aspect / uPlateAspect;
        else plateUv.x *= uPlateAspect / aspect;
        plateUv = vec2(plateUv.x / aspect, plateUv.y) + 0.5;

        /* Lifted hard, and the reason is two lines up the file: this is the
           pass that renders to the screen, so it is the one three applies ACES
           tone mapping to. Everything else here is scene light that was
           authored expecting that curve. The plate is not — it is a finished
           photograph, already graded, and putting a finished image through a
           film curve is how it arrives on screen looking like it was shot
           through a stop of neutral density. The gain is roughly what ACES
           takes back out of the midtones; the gamma below it opens the
           shadows, which on an image that is mostly black is most of it. */
        vec3 plate = pow(texture2D(tPlate, plateUv).rgb, vec3(0.82)) * 2.7;
        /* A lift on the crest and a dip in the trough — the specular of water,
           which is what stops the displacement alone reading as a wobble. Held
           low: this pass renders straight to the screen through the renderer's
           tone curve, so a coefficient big enough to be obvious on paper
           arrives as a white ring with no detail in it. */
        plate *= 1.0 + wave * envelope * 0.38;
        gl_FragColor = vec4(mix(color, plate, uPlate), 1.0);
        return;
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};
