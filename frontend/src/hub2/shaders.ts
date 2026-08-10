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
/** Granulation octaves. The star is one sphere and the shader is the whole
 *  cost of it, so the low tier drops two octaves rather than the surface. */
uniform int uDetail;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vView;

${NOISE}

void main() {
  vec3 p = normalize(vPos);

  /* Domain warp. Plain fbm advected along an axis reads as a texture sliding
     over a ball: every feature travels the same way at the same speed. Warping
     the sample point by a second, slower noise field first makes the pattern
     shear and fold against itself instead, which is what a convecting surface
     actually does — cells stretch, split and are dragged sideways by the flow
     they sit in. Cheap: three snoise calls for the whole effect. */
  vec3 flow = vec3(
    snoise(p * 1.6 + vec3(0.0, uTime * 0.019, 0.0)),
    snoise(p * 1.6 + vec3(4.3, uTime * 0.017, 1.1)),
    snoise(p * 1.6 + vec3(9.1, uTime * 0.021, 5.7))
  ) * 0.15;

  // Three timescales, because a single one reads as a texture sliding over a
  // ball rather than as a surface that is itself churning.
  /* The granulation runs finer than the supergranulation it rides on, and
     carries more of the result than it used to. At the old 7.0 and an even
     split the cells were the same size as the slow pattern underneath, so the
     two blurred into one lumpy wash; a real photosphere is a dense fine mottle
     over broad slow patches, and the eye reads the mottle first. This is also
     what the zoom is for — at the resting camera the star is small, and the
     detail is there for anyone who flies in. */
  float granule = fbm(p * 9.5 + flow * 1.4 + vec3(0.0, uTime * 0.055, 0.0), uDetail, 2.15, 0.55);
  float super   = fbm(p * 2.3 + flow - vec3(uTime * 0.021, 0.0, uTime * 0.017), 3, 2.0, 0.6);
  float flicker = snoise(p * 15.0 + vec3(uTime * 0.24)) * 0.5 + 0.5;

  float heat = granule * 0.6 + super * 0.4;
  heat = heat * 0.5 + 0.5;

  /* The intergranular lanes, and the one piece of structure fbm alone cannot
     give. Granulation is not a blur of light and dark patches — it is a mosaic
     of broad bright cells separated by a *connected net* of thin dark lanes,
     and that net is the thing the eye recognises as a boiling surface. Ridged
     noise is exactly a connected net of thin lines; cubed it gets thinner
     still, and subtracting it darkens the lines rather than lighting them. */
  float lanes = ridged(p * 12.5 + flow * 2.0 + vec3(0.0, uTime * 0.058, 0.0), uDetail - 2);
  heat -= pow(clamp(lanes, 0.0, 1.0), 3.0) * 0.2;

  heat = pow(clamp(heat, 0.0, 1.0), 1.25 - uPulse * 0.35);
  heat += flicker * (0.045 + uPulse * 0.055);

  /* Wider crossfades than the old 0.15..0.62 / 0.6..0.95. The stops are the
     same three colours; spreading the ramps means the disc moves through them
     gradually instead of banding into an amber zone, a gold zone and a lemon
     core with visible seams between. */
  vec3 color = mix(uCool, uWarm, smoothstep(0.08, 0.66, heat));
  color = mix(color, uHot, smoothstep(0.56, 1.02, heat));

  /* Limb darkening, per channel. mu is the cosine of the viewing angle, and
     the classic two-term Eddington approximation is close enough — but running
     one coefficient for all three channels only dims the edge, and a real limb
     does something more interesting than dim: it *reddens*. Near the edge you
     look through more atmosphere at a shallower angle, and that atmosphere
     scatters blue harder than red, so blue falls away fastest and red survives
     longest. Three coefficients instead of one, all normalised to 1.0 at the
     centre, and the disc grades from a lemon core out to a deep amber rim on
     its own — the softest colour on the star, and it comes from the physics
     rather than from a painted gradient. */
  float mu = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
  vec3 limb = vec3(
    0.42 + 0.58 * mu * (0.62 + 0.38 * mu),
    0.32 + 0.68 * mu * (0.57 + 0.43 * mu),
    0.22 + 0.78 * mu * (0.52 + 0.48 * mu)
  );
  color *= limb;

  /* Faculae: the bright network riding the edges of the cooling lanes, which
     is where the surface actually looks white rather than orange.

     Two corrections to where they show. They are patchy — they cluster into
     active regions rather than dusting the whole star evenly — and their
     contrast is highest *near the limb*, where the hot walls of the magnetic
     flux tubes are turned toward the viewer and the surrounding photosphere is
     darkened. The old weighting multiplied them by limb, which put them
     brightest dead centre: exactly backwards. */
  float network = smoothstep(0.70, 0.97, heat);
  float active = fbm(p * 3.1 + vec3(7.0, uTime * 0.012, 0.0), 2, 2.0, 0.6) * 0.5 + 0.5;
  float facula = network * mix(0.4, 1.0, active) * mix(0.55, 1.3, 1.0 - mu);
  color += vec3(1.0, 0.95, 0.76) * facula * (0.42 + uPulse * 0.42);

  /* A thin chromospheric fringe in the last few degrees before the silhouette.
     Narrow on purpose — it is not a rim light, it is the layer the corona
     leaves from, and without it the photosphere ends at a hard edge and the
     corona begins as a separate object floating around it. */
  float fringe = smoothstep(0.2, 0.0, mu);
  color += uWarm * fringe * fringe * 0.16;

  color *= 1.42 + uPulse * 0.5;

  /* A shoulder on the highlights that does not take the colour with it. The
     gain above puts the hot cells over 1.0, and everything over 1.0 is heading
     for the renderer's ACES curve, which desaturates as it compresses — that
     is what turns the middle of a yellow star white. So the compression is
     done here first, on luminance alone, and the chroma ratio is restored
     afterwards: the bright cells give up brightness and keep their hue, and
     the bloom puts the brightness back without the hue coming along. Untouched
     below 1.0, so the lanes and the limb are exactly as authored. */
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float over = max(lum - 1.0, 0.0);
  float rolled = lum - over + over / (1.0 + over * 0.55);
  color *= rolled / max(lum, 0.0001);

  gl_FragColor = vec4(color, 1.0);
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
/** What the corona fades *to* on its way out. See the mix below. */
uniform vec3 uOuterColor;
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

  /* The ray's direction, not its angle. atan() jumps by 2π across the -x axis,
     and noise sampled on a value that jumps leaves a seam running out of the
     star along that axis — which the streamers below would draw as a hard
     line. A unit vector has no seam to leave. */
  vec2 dir = vDisc / max(r, 0.0001);

  float d0 = max(r - uUnit, 0.0) / max(1.0 - uUnit, 0.0001);

  /* Streamers are a shape, not a stain — this is the change that stops the
     corona reading as a disc with bright streaks painted on it. A helmet
     streamer is not a brighter patch of an otherwise round corona; it is a
     place where the corona itself *reaches further out*, drawn along an open
     magnetic field line. So the modulation goes into the falloff distance, and
     the silhouette stops being a circle. Two scales, matching the two things a
     real corona has: a few broad lobes, and the finer polar plumes riding on
     them. */
  float lobes = fbm(vec3(dir * 1.35, uTime * 0.012), 3, 2.0, 0.55) * 0.5 + 0.5;
  float plume = ridged(vec3(dir * 5.2, uTime * 0.02), 3);
  float reach = 1.0 + (lobes - 0.5) * 0.62 + (plume - 0.5) * 0.2;
  float d = d0 / max(reach, 0.4);

  /* Three components rather than one exponential. A single falloff has one
     shape and reads as an airbrushed ring at any width you give it; the real
     profile is a bright, very tight layer sitting on the limb, the corona
     proper falling away above it, and a faint halo carrying much further out
     than either. Summing them gives a curve with a knee in it, and the knee is
     what makes the glow look like it is made of gas at different densities
     instead of one soft edge. */
  float band  = exp(-pow(d * uFalloff * 2.6, 1.4));
  float inner = exp(-pow(d * uFalloff, 1.15));
  float outer = exp(-d * uFalloff * 0.34);

  float a = (band * 0.42 + inner * 0.72 + outer * 0.16)
          * (0.82 + plume * 0.3)
          * uIntensity * (0.85 + uPulse * 0.7);
  // Nothing at the quad's own edge, so the geometry never shows.
  a *= smoothstep(1.0, 0.72, r);

  /* Cools outward. The corona is hot enough that its light is essentially
     white — the gold near the limb is the photosphere's own light still
     dominating, and it stops dominating within a radius or so. Holding one
     colour all the way out is what makes a glow look like a decal; letting it
     wash pale is most of why this one doesn't. */
  vec3 col = mix(uColor, uOuterColor, smoothstep(0.04, 0.8, d));

  /* A dither well under one 8-bit step. Everything above is smooth to the
     limit of float precision, and a smooth gradient this wide is exactly what
     banding shows up on — additively, over a black sky, at the display's
     quantisation. Breaking the steps up costs one hash. */
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;

  gl_FragColor = vec4(col, clamp(a + dither * 0.0035, 0.0, 1.0));
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
/** How much of the expensive structure to compute, 0..1, driven by how near
 * the camera is. The disc is sixteen turns of simplex noise a fragment at
 * full detail and it is on screen for the whole session — but for almost all
 * of that it is a small bright ring in a corner, where a domain warp and a
 * third turbulence sheet are below a pixel and cost the same as they do from
 * a metre away. It reaches zero a little before the branch stops running, so
 * the layers fade out rather than switching off. */
uniform float uDetail;
/** The slab's half-thickness at its outer edge. The disc is drawn as three
 * sheets stacked across its own normal rather than one, and each sheet is
 * bent to the flare profile below rather than sitting at a constant height —
 * so this, times the profile at this radius, is what turns a sheet's own
 * local y back into a signed −1..1. */
uniform float uSlab;
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

  /* Which sheet of the slab this is, −1 at the bottom to +1 at the top.
     A disc with no thickness is a sheet of paper, and edge-on — which is
     where the ending spends twenty-five seconds — a sheet of paper is a line.
     Three of them across the normal, each carrying its own structure, is a
     body of gas: the layers occlude and add over each other as the camera
     crosses, and the eye gets a top and a bottom to the thing it is flying
     over. */
  /* The section. A real disc is not a plate, and it is not a wedge either —
     it is thickest at both ends of its own radius and thinnest in between.

     Inward, the gas is no longer able to radiate away what compression is
     doing to it, so the inner flow puffs up into a torus: this is the part
     that was missing, and it is the part the eye most wants, because a disc
     that tapers to a knife edge exactly where the light is brightest reads as
     a cut-out rather than as a body. Outward, the scale height grows with
     radius the way a thin disc's does, so it flares again toward the rim.
     Between them is a waist at about two fifths.

     The same expression is baked into the geometry vertex for vertex, so this
     division gives back exactly which of the five sheets a fragment is on. */
  float prof = 0.18 + 0.50 * pow(t, 1.2) + 1.60 * exp(-t * 3.6);
  float slab = vPosL.y / max(uSlab * prof, 0.0001);

  /* Where the field is sampled, and the shape of the sample is most of what
     this surface looks like.
     
     It used to be read on a circle of the fragment's OWN radius, which at the
     rim is 17.6 units of noise across — a hundred and ten features around the
     circumference against barely one from the ISCO to the edge. That is
     anisotropy, but pointing the wrong way: fine in azimuth and coarse in
     radius gives short radial hash, and short radial hash on a rotating disc
     is speckle. Gas that has been sheared by differential rotation for a
     million orbits is the opposite — long, smooth and drawn out ALONG the
     flow.

     So the circle has a radius of its own, small and only slowly growing with
     t, and the radial axis carries the detail instead. About a dozen broad
     features round the disc and seven across it, which the shear already in
     the swirl angle then draws into arcs. The slab offset rides on the radial axis so each
     sheet still gets its own structure. */
  float qr = mix(1.6, 3.4, t);
  vec3 q = vec3(cos(swirl) * qr, sin(swirl) * qr, t * 7.0 + slab * 1.7);

  /* Domain warp — the one thing here that makes this a fluid rather than a
   * texture on a turntable.
   *
   * The sample position is displaced by a slower, coarser field of its own
   * before the turbulence is read from it. Without it every filament keeps
   * its shape for ever and merely travels: the disc rotates, and nothing in
   * it ever happens. With it the filaments curl into each other, stretch
   * where the warp diverges and pile up where it converges, and the whole
   * sheet reads as something being stirred — which is what an accretion disc
   * is doing every second of its life.
   *
   * Two octaves and two samples, which is the cheapest domain warp there is,
   * and it buys more than the third turbulence sheet below does. */
  /* The outermost pair of sheets skip the expensive half of this. They are
     the thinnest and dimmest part of the slab and they are seen through the
     three in front of them, so the structure they carry is structure nobody
     can resolve — and skipping it there is what makes five sheets affordable
     when three were already the budget. The test is on a value that is
     constant across each sheet, so it costs nothing at the branch. */
  float rich = uDetail * step(abs(slab), 0.8);
  vec3 warp = vec3(0.0);
  if (rich > 0.01) {
    vec3 wq = vec3(cos(swirl) * 0.9, sin(swirl) * 0.9, t * 2.6);
    float wx = fbm(wq + vec3(0.0, 0.0, uTime * 0.05), 2, 2.3, 0.5);
    float wy = fbm(wq + vec3(5.2, 1.3, uTime * 0.05 + 3.7), 2, 2.3, 0.5);
    warp = vec3(wx, wy, 0.0) * 0.62 * rich;
  }

  /* A fifth octave when there is anything to see it — the extra one is what
     keeps a surface this close to the camera from going soft, and out at the
     resting view it is below a pixel. */
  int oct = rich > 0.01 ? 5 : 4;
  float turb = fbm(q + warp + vec3(0.0, 0.0, uTime * 0.12), oct, 2.2, 0.55) * 0.5 + 0.5;
  float fil = ridged((q + warp * 0.7) * 1.5 - vec3(0.0, 0.0, uTime * 0.2), 3);

  /* A second sheet, going round at its own rate.
   *
   * One field carried by one shear is one sheet of material: it moves, but
   * every part of it moves with its neighbours, and what the eye reads is a
   * texture being dragged round. A real disc is many annuli each orbiting at
   * its own rate and continuously lapping the one outside it, so what should
   * be visible is streams sliding over streams. A second sample of the same
   * field at a slower shear and a coarser scale gives that for three more
   * octaves, and it is what turns the surface into something a craft can be
   * seen to fly over rather than a lit ring it is circling. */
  float swirl2 = ang + uTime * omega * 15.0 + 2.1;
  vec3 q2 = vec3(cos(swirl2) * qr * 0.72, sin(swirl2) * qr * 0.72, t * 5.0 + 11.0);
  float turb2 = fbm(q2, 3, 2.3, 0.55) * 0.5 + 0.5;

  /* And a third, finer and slower still, wound the other way round.
   *
   * Two sheets read as two sheets. What a real disc looks like from close up
   * — which is where the ending now flies — is depth: material at every rate
   * between the fastest and the slowest, so that wherever the eye rests
   * something is sliding over something else. Three is where that starts to
   * be true, and the third is the cheapest of them because it carries the
   * fine detail rather than the body: two octaves, sampled tight. */
  /* Less of the ridge than there was. Ridged noise is |n| folded, which puts
     a crease at every zero crossing — excellent for filaments and, at nearly
     half the mix, the other half of why this read as grain. */
  float density = mix(turb, fil, 0.3);
  density = mix(density, density * (0.55 + turb2 * 0.95), 0.65);
  if (rich > 0.01) {
    float swirl3 = ang + uTime * omega * 8.5 - 1.3;
    vec3 q3 = vec3(cos(swirl3) * qr * 1.45, sin(swirl3) * qr * 1.45, t * 11.0 + 27.0);
    float turb3 = fbm(q3, 2, 2.4, 0.5) * 0.5 + 0.5;
    density = mix(density, density * (0.62 + turb3 * 0.82), 0.5 * rich);
  }

  /* And the lanes, which cost nothing at all. A travelling sine in radius
     whose phase advances with the local orbital rate: the bands are
     concentric, and every one of them slides past the one outside it because
     omega falls off as r^-3/2. That is the many-layers reading in one line,
     and it is also exactly the differential rotation the shear above is.

     Two sets of them now, at frequencies that do not divide into each other,
     so the pattern never lines up into corduroy — one broad and one fine, and
     the fine one runs at a different multiple of omega so the two drift
     through each other instead of travelling together. */
  density *= 0.86 + 0.14 * sin(r * 4.0 - uTime * omega * 34.0);
  density *= 1.0 - uDetail * (0.10 - 0.10 * sin(r * 10.3 - uTime * omega * 51.0 + 2.2));
  /* Thin at both edges: sharp at the ISCO, feathered at the outer rim. The
     outer feather starts later than it used to — the sheet reaches further
     out now, and a disc that has faded to nothing by two thirds of its own
     radius has no far distance for a camera down on it to look across. */
  density *= smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.72, 1.0, t));

  /* Temperature: T ∝ r^-3/4 for a thin disc, and the colour ramp follows it.
     Five stops rather than four. Flown over at close range the ramp is most
     of what the eye has to judge distance by — the far reaches of the sheet
     should be a different colour from the ground under the camera, or the
     whole plane reads as one flat surface at one temperature. The deep red
     at the outside is new, and so is the separation between the gold and the
     white above it. */
  /* Slower than it was — the old 2.1 put the white-hot band inside the first
     ninth of the radius, so the disc was orange almost everywhere and the hot
     core was a rim rather than a region. At 1.5 the heat reaches out far
     enough that the middle of this thing is white and the gradient down to
     the dark red at the rim is something you can see happening. */
  float temp = pow(1.0 - t, 1.5);
  /* Deeper than they were. The ramp had drifted pale — every stop carried
     enough green and blue to sit near white once the brightness was on it,
     and a disc that goes white early has one colour and a lot of exposure
     rather than a temperature gradient. Pulling the off-channels down leaves
     the same sequence with the saturation put back. */
  vec3 ember = vec3(0.26, 0.022, 0.007);
  vec3 cold = vec3(0.80, 0.13, 0.02);
  vec3 warm = vec3(1.0, 0.44, 0.07);
  vec3 hot  = vec3(1.0, 0.80, 0.34);
  vec3 xhot = vec3(0.78, 0.91, 1.0);
  vec3 color = mix(ember, cold, smoothstep(0.0, 0.16, temp));
  color = mix(color, warm, smoothstep(0.10, 0.45, temp));
  color = mix(color, hot, smoothstep(0.42, 0.78, temp));
  color = mix(color, xhot, smoothstep(0.68, 0.95, temp));

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
  /* Raised to a power rather than taken straight. Flown over at close range
     the disc came out a sheet of white with the structure only readable at
     the far edges — density sits mostly in its middle range, so a linear
     brightness gives every layer nearly the same value and the bloom then
     welds them together. The exponent pushes the troughs down without moving
     the crests, which is what separates one stream from the next; the gain
     comes down with it because deepening the lanes is not an excuse to make
     the whole thing brighter. */
  /* The slab's own falloff, which is a Gaussian and not a ramp.
     A column of gas is densest on the mid-plane and thins away from it on a
     curve with no edge to it — which is what stops five evenly spaced sheets
     being five countable sheets. A polynomial ramp gave every one of them a
     definite brightness and a definite edge, so the eye found five; on a
     Gaussian the outer pair are a quarter of the middle and read as the haze
     around a body rather than as layers of one.

     It multiplies the colour as well as the alpha, because these are additive
     surfaces: fading only the alpha leaves every sheet contributing the same
     light and the stack is as bright as ever, which is most of why the middle
     came out as five white discs. */
  float vert = exp(-slab * slab * 1.6);
  /* And the bulge is lit as well as swollen. A thicker column of gas is a
     brighter one — there is more of it in the line of sight — and without the
     lift the puffed middle came out the same value as the thin waist beyond
     it, which reads as a flat disc with a bump drawn on it rather than as
     something that is actually deeper there. */
  float swell = 1.0 + 1.15 * pow(1.0 - t, 3.0);
  float brightness = pow(density, 1.35) * (1.62 + uFeed * 0.7) * swell;
  color *= brightness * vert;

  /* The photon ring: light that orbited the hole before escaping, piling up
     just outside the horizon. Always white, always the brightest thing here —
     and drawn on the middle sheet ALONE.
     It is a lensing feature, one ring of light at one radius, not a property
     of the gas: drawn on all five sheets it came out as five white rings
     stacked up the bulge, which is the single thing that made the slab look
     like a stack of plates rather than a body. */
  float photon = exp(-pow((t - 0.012) * 130.0, 2.0)) * step(abs(slab), 0.25);
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

  /* And the slab's own falloff: the outer sheets are thinner than the middle
     one, so the body has an edge that fades rather than three hard planes. */
  float alpha = clamp(density * 1.7 + photon * 1.4, 0.0, 1.0) * vert;
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
/** Three nebulae, because one haze is a wash and a wash is what made the
 * first version of this dull: an even field of even stars over an even fog
 * has nothing in it for the eye to go to. */
uniform vec3 uNebA;
uniform vec3 uNebB;
uniform vec3 uNebC;
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
vec3 sheet(vec2 p, float scale, float rot, float t, vec3 tint, float gain, float dens) {
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
  vec2 rel = fract(q) - (0.18 + o * 0.64);
  float d = length(rel);
  float core = smoothstep(0.17, 0.0, d);
  // Cubed: a point with a halo around it rather than a soft blob.
  core *= core * core;

  /* And the bright ones get spikes.
   *
   * Every star being a round dot is the other half of what made this field
   * look printed. A real bright star in any real image is a cross, because
   * the thing that photographed it had vanes holding its secondary mirror and
   * the light bends round them — which is why the eye reads a four-pointed
   * star as "bright" and a disc as "near". So the spikes are earned by
   * magnitude rather than sprinkled: below the threshold nothing changes, and
   * the few above it get two thin bars, one across and one down, tapering out
   * and never wider than the core they belong to.
   *
   * The bar is |rel| on one axis against a much tighter falloff on the other,
   * which is a line; multiplying the two gives the cross without a second
   * distance calculation. */
  float bright = hash12(g + 3.9);
  float spike = smoothstep(0.62, 0.95, bright);
  if (spike > 0.0) {
    vec2 bar = abs(rel);
    float across = smoothstep(0.019, 0.0, bar.y) * smoothstep(0.40, 0.0, bar.x);
    float down = smoothstep(0.019, 0.0, bar.x) * smoothstep(0.40, 0.0, bar.y);
    core += (across + down) * spike * 0.38;
  }

  float flicker = 0.74 + 0.26 * sin(t * 2.3 + o.x * 63.0 + o.y * 21.0);
  float mag = 0.32 + hash12(g + 7.3) * 0.68;

  /* Colour. Half of them stay the sheet's own white and the rest are drawn
     off a real stellar sequence — B blue-white, A white, G yellow, K orange,
     M red — because a sky of one colour is a sky that has been tinted rather
     than a sky made of stars, and because the colour of a star is its
     temperature and temperatures vary. The roll decides both which half a
     star is in and, if coloured, which end of the sequence it sits at, so a
     cell's colour is as fixed as its position. */
  float hue = hash12(g + 51.3);
  if (hue > 0.5) {
    float k = (hue - 0.5) * 2.0;
    vec3 hot = mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.98, 0.92), clamp(k * 2.4, 0.0, 1.0));
    vec3 cool = mix(vec3(1.0, 0.86, 0.56), vec3(1.0, 0.56, 0.38), clamp(k * 2.4 - 1.4, 0.0, 1.0));
    tint *= mix(hot, cool, smoothstep(0.34, 0.72, k));
  }
  /* Whether this cell has a star in it at all.
     Dimming a field to thin it only makes a dim field — every cell still
     holds its star and the eye still reads the even spacing underneath. What
     actually thins a real sky is that fewer places are occupied, so the cell
     draws a roll of its own and keeps its star only if the roll comes in
     under the local density. The clusters and the empty lanes both fall out
     of that one test. */
  float keep = step(hash12(g + 19.1), dens);
  return tint * (core * flicker * mag * gain * keep);
}

/* One nebula: a lump of lit gas somewhere in the far sky.
 *
 * The reach term is a circle and the noise is not, and it is the product that
 * is drawn — so the circle never shows as an edge, it only decides how far out
 * the gas is allowed to reach. Three of these at three sizes in three colours
 * is what gives the inside somewhere to look; before them this was an even
 * field of even stars over an even fog, which has no subject anywhere in it.
 *
 * The early out is worth having. Most fragments are outside any given nebula,
 * and the three octaves below are the most expensive thing in this shader. */
vec3 nebula(vec2 p, vec2 at, float size, float seed, vec3 tint, float t) {
  vec2 q = (p - at) / size;
  float reach = 1.0 - smoothstep(0.30, 1.0, dot(q, q));
  if (reach <= 0.002) return vec3(0.0);
  float n = fbm(vec3(q * 1.5 + seed, t * 0.03 + seed), 3, 2.3, 0.55) * 0.5 + 0.5;
  return tint * pow(n * reach, 2.1);
}

/* Puts a point into a flat object's own frame: turned to its position angle,
   then stretched across the minor axis, which is what seeing a round disc from
   off to one side does to it. tilt is the axis ratio — 1 face-on, 0.2 nearly
   edge-on. Stretching rather than squashing because this runs backwards: it is
   asking where a screen point falls on the disc, so the short axis has to be
   opened out before the radius is measured. */
vec2 intoDisc(vec2 p, vec2 at, float size, float roll, float tilt) {
  vec2 q = p - at;
  float c = cos(roll), s = sin(roll);
  q = mat2(c, -s, s, c) * q;
  q.y /= max(tilt, 0.06);
  return q / size;
}

/* A spiral galaxy seen at an angle — an Andromeda.
 *
 * All analytic and no noise at all, which is the whole reason it is affordable
 * next to everything else in here. A spiral galaxy is three things the eye
 * checks for and nothing else: a bulge that falls off much faster than the
 * disc, a disc that falls off exponentially, and arms. The arms are the only
 * interesting term — a logarithmic spiral is one whose pitch angle is
 * constant, which means the arm's angle goes as log(r), so testing cos of
 * (angle − log r × pitch) against two arms puts a pair of them in the disc
 * with no geometry and no texture. Real ones are logarithmic to a good
 * approximation, which is why this reads rather than merely swirls. */
vec3 galaxySpiral(vec2 p, vec2 at, float size, float roll, float tilt, vec3 bulgeTint, vec3 armTint) {
  vec2 q = intoDisc(p, at, size, roll, tilt);
  float r = length(q);
  if (r > 1.35) return vec3(0.0);
  float arms = cos((atan(q.y, q.x) - log(r + 0.11) * 3.3) * 2.0) * 0.5 + 0.5;
  arms = pow(arms, 2.4);
  float disc = exp(-r * 2.5);
  float bulge = exp(-r * 8.5);
  float cut = smoothstep(1.35, 0.25, r);
  return (bulgeTint * bulge * 1.7 + armTint * disc * (0.16 + arms * 1.25)) * cut;
}

/* And an irregular one — a Magellanic Cloud. No arms and no bulge to speak
   of: a bar off to one side and a lumpy body around it, which is what a small
   galaxy that has been pulled about by a large neighbour looks like. The one
   noise call in here is what makes it irregular; everything analytic would
   only give another smooth ellipse, and a smooth ellipse is the one thing this
   object is not. */
/* The same disc seen from its own plane, which is the one orientation where a
   spiral stops being a spiral: a line, with a bulge swelling out of the middle
   of it and a dark lane running the length. The lane is the whole thing — it
   is the galaxy's own dust seen against its own light, and without it this is
   a bright streak and nothing more. It sits on the mid-plane, which in the
   stretched frame is simply q.y = 0, so it costs one exponential. */
vec3 galaxyEdgeOn(vec2 p, vec2 at, float size, float roll, vec3 tint) {
  vec2 q = intoDisc(p, at, size, roll, 0.13);
  float r = length(q);
  if (r > 1.3) return vec3(0.0);
  float disc = exp(-r * 2.2);
  float bulge = exp(-r * 6.5);
  float lane = 1.0 - 0.88 * exp(-q.y * q.y * 220.0);
  return tint * (disc * 0.85 + bulge * 1.55) * lane * smoothstep(1.3, 0.2, r);
}

/* An elliptical. No arms, no dust, no disc — old red stars in a smooth
   ellipsoid, and the least spectacular thing in the sky, which is exactly why
   one belongs here: four galaxies that are all showpieces read as a poster
   rather than as a view. The profile is de Vaucouleurs' quarter power, which
   falls much faster than an exponential near the middle and much slower far
   out, and is what gives one a bright core and no edge you can point to. */
vec3 galaxyElliptical(vec2 p, vec2 at, float size, float roll, vec3 tint) {
  vec2 q = intoDisc(p, at, size, roll, 0.74);
  float r = length(q);
  if (r > 1.2) return vec3(0.0);
  float body = exp(-3.2 * (pow(r + 0.03, 0.25) - 0.42));
  return tint * body * smoothstep(1.2, 0.15, r) * 1.05;
}

vec3 galaxyIrregular(vec2 p, vec2 at, float size, float roll, vec3 tint, float t) {
  vec2 q = intoDisc(p, at, size, roll, 0.68);
  float r = length(q);
  if (r > 1.25) return vec3(0.0);
  float bar = exp(-abs(q.y) * 6.5) * exp(-abs(q.x) * 2.0);
  float lumps = fbm(vec3(q * 2.2 + 91.0, t * 0.02), 3, 2.3, 0.55) * 0.5 + 0.5;
  float body = (bar * 0.85 + lumps * 0.85) * smoothstep(1.25, 0.1, r);
  return tint * pow(body, 1.9) * 1.5;
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
  /* Where the stars crowd and where they do not. One low-frequency field,
     read by all three sheets, so the empty lanes line up through the depth —
     which is what a dust lane in front of a star field actually does, and is
     also the difference between a sky with structure in it and a sky with an
     even sprinkle over the whole of it. */
  float clump = fbm(vec3(p * 1.15 + 4.7, uTime * 0.015), 3, 2.4, 0.5) * 0.5 + 0.5;
  float dens = 0.10 + 0.90 * smoothstep(0.30, 0.74, clump);

  /* Three sheets, each turning at its own rate and drifting its own way,
     which is what gives the inside a depth: near stars slide across far ones,
     and the whole field shears between the layers rather than within them.
     The drift matters as much as the turn — a rotation alone is a plate
     spinning, and what is wanted is material going somewhere. It is a
     straight translation in the FAR sky, so the lens does the rest: a star
     moving at a constant rate out there slows and crowds as it nears the rim,
     which is the flow reading the mapping gives for free. */
  vec3 sky = vec3(0.0);
  sky += sheet(p + vec2(0.012, 0.055) * uTime, 10.0, uTime * 0.013, uTime, vec3(0.74, 0.84, 1.0), 5.0, dens);
  sky += sheet(p + vec2(-0.042, 0.018) * uTime, 21.0, uTime * -0.0085, uTime + 11.0, vec3(1.0, 0.94, 0.86), 3.4, dens * 0.85);
  sky += sheet(p + vec2(0.021, -0.031) * uTime, 43.0, uTime * 0.0055, uTime + 23.0, vec3(0.88, 0.8, 1.0), 2.6 * uNear, dens * 0.7);

  /* And the gas they belong to. Three of them, at three sizes, carried round
     on the same slow turn as the sheets so they are part of that sky rather
     than a pattern painted on the glass.

     And each drifts, at about the rate the stars do. A straight-line drift is
     the honest way to move something in this plane — it is exactly what the
     sheets do — but a sheet is a periodic field and these are three objects:
     sent in a straight line they leave, and the far side is a sky with no gas
     in it for the rest of the session. So each runs its own slow loop, on its
     own two rates, so they are three things drifting rather than one layer
     sliding. The lens does the rest: gas crossing the far sky at a constant
     rate slows and squeezes as it nears the rim, the same as the stars. */
  float nrot = uTime * 0.013;
  float nc = cos(nrot), ns = sin(nrot);
  vec2 np = mat2(nc, -ns, ns, nc) * p;
  vec2 driftA = vec2(sin(uTime * 0.118), cos(uTime * 0.091)) * 0.72;
  vec2 driftB = vec2(cos(uTime * 0.101 + 1.9), sin(uTime * 0.137 + 0.7)) * 0.64;
  vec2 driftC = vec2(sin(uTime * 0.086 + 3.1), cos(uTime * 0.126 + 2.2)) * 0.80;
  sky += nebula(np, vec2(-0.62, 0.30) + driftA, 0.95, 0.0, uNebA, uTime) * 1.15;
  sky += nebula(np, vec2(0.70, -0.45) + driftB, 0.72, 13.7, uNebB, uTime) * 1.0;
  sky += nebula(np, vec2(0.10, 0.98) + driftC, 0.58, 41.2, uNebC, uTime) * 0.9;

  /* Four galaxies out past the gas, drifting on their own loops like it does,
     and deliberately four DIFFERENT ones — a sky where every galaxy is the
     same showpiece spiral is a wallpaper. So: a warm-cored spiral seen well
     off face-on, which is an Andromeda and the one everybody has seen a
     photograph of; a small irregular, which is a Magellanic Cloud; the same
     disc as the first but seen from its own plane, dust lane and all; and a
     plain elliptical, which is what most of the big ones actually are.

     All of them small and far out in the field on purpose. They are what tells
     you the inside of this is a sky with a depth to it rather than a bowl with
     a pattern in it, and a galaxy big enough to be the subject would be a
     galaxy you had flown to rather than one you can see from here. */
  vec2 driftG = vec2(cos(uTime * 0.073 + 0.4), sin(uTime * 0.058 + 2.7)) * 0.55;
  vec2 driftH = vec2(sin(uTime * 0.095 + 1.3), cos(uTime * 0.067 + 0.2)) * 0.62;
  vec2 driftI = vec2(cos(uTime * 0.084 + 2.4), sin(uTime * 0.109 + 1.1)) * 0.58;
  vec2 driftJ = vec2(sin(uTime * 0.062 + 0.9), cos(uTime * 0.088 + 3.4)) * 0.66;
  sky += galaxySpiral(
    np, vec2(1.16, 0.60) + driftG, 0.46, 0.92, 0.36,
    vec3(1.0, 0.92, 0.72), vec3(0.62, 0.76, 1.0)
  ) * 0.85;
  sky += galaxyIrregular(np, vec2(-1.02, -0.80) + driftH, 0.34, -0.5, vec3(0.78, 0.84, 1.0), uTime) * 0.8;
  sky += galaxyEdgeOn(np, vec2(-1.28, 0.72) + driftI, 0.52, 2.25, vec3(1.0, 0.90, 0.74)) * 0.9;
  sky += galaxyElliptical(np, vec2(0.88, -1.14) + driftJ, 0.30, 0.6, vec3(1.0, 0.86, 0.64)) * 0.85;

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
    /** Inside the wormhole, 0 to 1 — how much of the frame the passage owns.
     * See passage() for why this is a screen effect and not a tube. */
    uTunnel: { value: 0 },
    /** Where the axis of the passage sits relative to the middle of the frame.
     * This is the camera moving across the passage rather than straight down
     * the middle of it, and it is the whole difference between flying through
     * something and falling down a drain. */
    uLean: { value: [0, 0] },
    /** How far open the far end is, 0 to 1. */
    uMouth: { value: 0 },
    /** Past the horizon, 0 to 1. See inside(). */
    uInside: { value: 0 },
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
    uniform float uTunnel;
    uniform vec2 uLean;
    uniform float uMouth;
    uniform float uInside;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    /* Value noise on the same hash. Cheap on purpose: the two effects below
       are the only things that want it, they run for about fifteen seconds of
       a session, and pulling the simplex preamble in here for them would put
       forty lines of gradient noise in the pass that every frame of every
       other second has to run through. */
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float fbm2(vec2 p) {
      float s = 0.0;
      float w = 0.5;
      float m = 0.0;
      for (int i = 0; i < 4; i++) {
        s += vnoise(p) * w;
        m += w;
        p *= 2.03;
        w *= 0.5;
      }
      return s / m;
    }

    /* The same thing, wrapped in x.
     *
     * The passage's angular coordinate comes out of atan and so runs from -pi
     * to pi with a seam where it flips. Noise that does not wrap across that
     * seam draws it: the first version of the tunnel had a hard horizontal
     * line running out from the middle of the frame, which is the join in the
     * tunnel wall, and no amount of detail hides a straight edge.
     *
     * Wrapping the integer lattice is all it takes, provided every octave
     * wraps in the same place — so the period doubles with the frequency, and
     * the frequency has to be exactly 2 rather than the 2.03 above that exists
     * to stop octaves stacking. The y offset does that job here instead. */
    float vnoiseWrap(vec2 p, float period) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float x0 = mod(i.x, period);
      float x1 = mod(i.x + 1.0, period);
      return mix(
        mix(hash(vec2(x0, i.y)), hash(vec2(x1, i.y)), f.x),
        mix(hash(vec2(x0, i.y + 1.0)), hash(vec2(x1, i.y + 1.0)), f.x),
        f.y
      );
    }

    float fbmWrap(vec2 p, float period) {
      float s = 0.0;
      float w = 0.5;
      float m = 0.0;
      for (int i = 0; i < 4; i++) {
        s += vnoiseWrap(p, period) * w;
        m += w;
        p *= 2.0;
        p.y += 31.7;
        period *= 2.0;
        w *= 0.5;
      }
      return s / m;
    }

    /* Stars on the passage's own surface — round it and along it — so they
       stream past as it goes. Wrapped in the angular axis like everything
       else in here, and coloured half white and half off the stellar
       sequence, which is what the wormhole's own sky does and for the same
       reason: a field of one colour is a field that has been tinted. */
    vec3 passageStars(float u, float z, float period, float gain, float dens, float t) {
      vec2 g = floor(vec2(u, z));
      vec2 f = fract(vec2(u, z));
      vec2 cell = vec2(mod(g.x, period), g.y);
      /* Whether this cell holds a star at all, tested against the local
         density rather than the star being dimmed by it. Same reasoning as
         the wormhole's own sky: dimming a field to thin it leaves the even
         spacing showing through underneath, and even spacing is what says
         "generated". */
      if (hash(cell + 19.1) > dens) return vec3(0.0);

      vec2 o = vec2(hash(cell), hash(cell + 17.3));
      vec2 rel = f - (0.14 + o * 0.72);
      float d = length(rel);
      /* Small. These were points a sixth of a cell across, which at this
         density is a field of pebbles — a star should be the smallest thing
         the frame can draw and get its presence from being bright, not from
         being wide. */
      float core = smoothstep(0.10, 0.0, d);
      core *= core * core;

      float mag = 0.28 + hash(cell + 41.7) * 0.72;

      /* And the brightest of them get spikes. A bright star in any real
         image is a cross, because whatever photographed it had vanes across
         its aperture — it is why the eye reads a four-pointed star as bright
         and a disc as near. */
      float spike = smoothstep(0.70, 0.97, mag);
      if (spike > 0.0) {
        vec2 bar = abs(rel);
        float across = smoothstep(0.011, 0.0, bar.y) * smoothstep(0.26, 0.0, bar.x);
        float down = smoothstep(0.011, 0.0, bar.x) * smoothstep(0.26, 0.0, bar.y);
        core += (across + down) * spike * 0.42;
      }

      float hue = hash(cell + 71.1);
      vec3 tint = vec3(1.0);
      if (hue > 0.5) {
        tint = mix(vec3(0.60, 0.75, 1.0), vec3(1.0, 0.68, 0.42), (hue - 0.5) * 2.0);
      }
      float tw = 0.75 + 0.25 * sin(t * 2.1 + o.x * 51.0);
      return tint * (core * mag * tw * gain);
    }

    /* And a galaxy every few lengths of it, at a random angle round the tube.
       Three shapes rather than one, drawn on a roll of the same band index —
       a spiral, one seen edge-on with the dust lane down it, and a plain
       elliptical. Every galaxy being the same bulge-over-disc is the thing
       that made the first pass at this read as a repeating sprite.

       All analytic. A logarithmic spiral is one whose arm angle goes as
       log r, so a pair of arms costs an atan and a log and no texture at all,
       and what noise this pass can afford is already spent on the gas. */
    vec3 passageGalaxy(float u, float z, float band, float scale) {
      float k = floor(z / band);
      float du = u - hash(vec2(k, 3.1));
      du -= floor(du + 0.5);
      float roll = hash(vec2(k, 9.7));
      float kind = hash(vec2(k, 5.3));

      vec2 d = vec2(du * 4.0, (z / band - k - 0.5) * 1.7) / scale;
      // Turned to its own position angle, so they are not all lying the same way.
      float c = cos(roll * 6.2831853), s = sin(roll * 6.2831853);
      d = mat2(c, -s, s, c) * d;

      if (kind < 0.22) {
        // Edge-on: stretched hard on one axis, with the lane on the mid-plane.
        d.y /= 0.16;
        float rr = length(d);
        if (rr > 1.2) return vec3(0.0);
        float lane = 1.0 - 0.85 * exp(-d.y * d.y * 180.0);
        return vec3(1.0, 0.90, 0.74)
          * (exp(-rr * 2.2) * 0.85 + exp(-rr * 6.5) * 1.5) * lane * smoothstep(1.2, 0.2, rr);
      }
      if (kind < 0.42) {
        // Elliptical: a smooth quarter-power profile and nothing else.
        d.y /= 0.74;
        float rr = length(d);
        if (rr > 1.15) return vec3(0.0);
        return vec3(1.0, 0.87, 0.68)
          * exp(-3.2 * (pow(rr + 0.03, 0.25) - 0.42)) * smoothstep(1.15, 0.15, rr);
      }
      if (kind < 0.60) {
        /* Irregular. No bulge and no arms — a bar off to one side and a lumpy
           body round it, which is what a small galaxy that has been pulled
           about by a large neighbour looks like. The lumps come out of the
           cell hash rather than out of noise: three fixed knots at hashed
           offsets is enough to break the ellipse, and an ellipse is the one
           thing this shape must not be. */
        d.y /= 0.66;
        float rr = length(d);
        if (rr > 1.2) return vec3(0.0);
        float body = exp(-abs(d.y) * 4.2) * exp(-abs(d.x) * 1.7);
        for (int i = 0; i < 3; i++) {
          vec2 knot = (vec2(hash(vec2(k, 21.0 + float(i))), hash(vec2(k, 37.0 + float(i)))) - 0.5) * 1.2;
          body += exp(-length(d - knot) * 7.0) * 0.55;
        }
        return vec3(0.80, 0.86, 1.0) * body * 0.9 * smoothstep(1.2, 0.15, rr);
      }
      if (kind < 0.78) {
        /* Barred spiral. The bar is the point: two thirds of disc galaxies
           have one, and the arms spring from its ends rather than from the
           middle — which is why a barred one reads as a different object and
           not as a spiral drawn badly. */
        d.y /= 0.52;
        float rr = length(d);
        if (rr > 1.3) return vec3(0.0);
        float bar = exp(-abs(d.y) * 9.0) * exp(-pow(abs(d.x) * 2.1, 3.0));
        float arms = pow(cos((atan(d.y, d.x) - log(rr + 0.14) * 2.2) * 2.0) * 0.5 + 0.5, 3.0);
        return (vec3(1.0, 0.90, 0.70) * (exp(-rr * 9.0) * 1.3 + bar * 1.1)
              + vec3(0.66, 0.78, 1.0) * exp(-rr * 2.6) * arms * 1.15
              * smoothstep(0.24, 0.5, rr))
          * smoothstep(1.3, 0.25, rr);
      }
      /* Grand-design spiral, seen off face-on — with a dust lane along the
         inside of each arm and knots of star formation strung down them,
         because those two are what a photograph of one actually shows and an
         arm without them is a smooth ramp. */
      d.y /= 0.42;
      float rr = length(d);
      if (rr > 1.3) return vec3(0.0);
      float phase = atan(d.y, d.x) - log(rr + 0.11) * 3.3;
      float arms = pow(cos(phase * 2.0) * 0.5 + 0.5, 2.4);
      float lanes = 1.0 - 0.45 * pow(cos(phase * 2.0 - 0.7) * 0.5 + 0.5, 6.0);
      float knots = pow(cos(phase * 2.0) * 0.5 + 0.5, 9.0)
        * (0.5 + 0.5 * sin(rr * 26.0 + roll * 40.0));
      return (vec3(1.0, 0.92, 0.72) * exp(-rr * 8.0) * 1.6
            + vec3(0.62, 0.76, 1.0) * exp(-rr * 2.4) * (0.16 + arms * 1.2) * lanes
            + vec3(0.85, 0.92, 1.0) * exp(-rr * 2.0) * knots * 0.9)
        * smoothstep(1.3, 0.25, rr);
    }

    /* The passage through the wormhole, drawn rather than built.
     *
     * There is no tube anywhere in the scene, and there should not be. A
     * tunnel seen from inside, down its own axis, is one of the very few
     * things that is *exactly* a screen-space effect: the wall's distance
     * along the axis goes as 1/r from the middle of the frame, and its angle
     * round the axis is the pixel's own angle. Two numbers per pixel give a
     * position on an infinite cylinder and everything else is texture on it.
     *
     * Built as geometry it would be a tube sitting somewhere in the world with
     * two open ends, and Saturn visible through one of them.
     *
     * And it is dark, and mostly not there. The first version was a lit blue
     * tube, which is a pipe: the walls were the subject and there was nothing
     * beyond them, so the whole of it read as being inside something small.
     * What it should read as is being carried through open sky at a speed
     * nothing else gets near — so the tube itself is two faint turns of
     * filament, and what fills the frame is what is out past it: three sheets
     * of stars streaming by, gas in three colours, and a galaxy every few
     * lengths. The cylinder is a coordinate system for a sky here rather than
     * a surface with a texture on it.
     *
     * Everything is stretched far harder along the passage than around it,
     * because what it has to read as is material going past — a field with
     * equal detail both ways is a wall, and a wall does not move. */
    vec3 passage(vec2 uv, float t, vec2 lean, float aspect, float mouth) {
      vec2 q0 = uv - 0.5 - lean;
      q0.x *= aspect;
      /* Floored well off zero. Depth goes as 1/r, so at the very middle the
         far end is infinitely away and everything there is infinitely
         compressed — which samples as a knot of rings sitting exactly where
         the eye is going.
         Softened rather than clamped. A max() holds the whole disc inside the
         floor at one value, and the ring where it takes over is a circle
         across which the depth's slope jumps — which draws a small hard-edged
         disc beside the exit. Adding the floor under the square root bends
         the same curve without ever introducing a corner in it. */
      float r0 = sqrt(dot(q0, q0) + 0.000256);

      /* The axis is not straight.
       *
       * A cylinder about one fixed line is a drainpipe, and a drainpipe is
       * what the first version of this was: every ring of it concentric with
       * every other, all of them centred on the same point, and the only
       * motion the eye could find was inward. A wormhole in the film this is
       * taken from does not do that — the throat wanders, and what you are
       * riding is a bend.
       *
       * So the centre is a function of depth. A first pass gives the depth of
       * each pixel on the straight tube; that depth says where the axis has
       * wandered to; and the coordinates are taken again about the wandered
       * centre. Because the depth is large in the middle of the frame and
       * small at its edges, the near rings and the far rings end up centred
       * on different points — which is the whole of what a curved tunnel
       * looks like from inside one. Two low frequencies rather than one, so
       * it never comes back to straight and never repeats. */
      float zStraight = 0.34 / r0 + t * 1.35;
      vec2 bend = vec2(
        sin(zStraight * 0.146 + 1.1) * 0.62 + sin(zStraight * 0.083 + t * 0.21) * 0.38,
        cos(zStraight * 0.121 + 0.4) * 0.58 + cos(zStraight * 0.069 + t * 0.17) * 0.42
      ) * 0.105;

      vec2 q = q0 - bend;
      float r = sqrt(dot(q, q) + 0.000256);
      float a = atan(q.y, q.x);
      float z = 0.34 / r + t * 1.35;
      float u = a / 6.2831853 + t * 0.035;

      /* And nothing at all in the last of it. Past the floor above the
         compression is still severe enough to alias, and the exit is what
         belongs in the middle of the frame anyway. */
      float near = smoothstep(0.03, 0.11, r);

      vec3 col = vec3(0.0);

      /* Gas first, because the low-frequency one of the three does two jobs.
         It is a nebula, and it is also where the stars are allowed to be —
         one field read by all three sheets, so the empty lanes line up
         through the depth the way dust in front of a star field does. Reusing
         it costs nothing; a fourth turn of noise for the clustering alone
         would be the most expensive thing in this pass. */
      float n1 = fbmWrap(vec2(u * 3.0, z * 0.20), 3.0);
      float n2 = fbmWrap(vec2(u * 5.0, z * 0.29 + 53.0), 5.0);
      float n3 = fbmWrap(vec2(u * 4.0, z * 0.24 + 91.0), 4.0);
      float dens = 0.16 + 0.84 * smoothstep(0.30, 0.72, n1);

      /* Four depths of star, and the last of them is not meant to be resolved.
         What separates a photograph of a star field from a scatter of dots is
         that the dots sit on a haze of everything too far to be a dot — so
         the finest sheet is a hundred and ten cells round and dim, and its
         job is to be almost, but not quite, texture. */
      col += passageStars(u * 22.0, z * 1.3, 22.0, 3.4, dens, t) * near;
      col += passageStars(u * 40.0, z * 2.4 + 31.0, 40.0, 2.4, dens * 0.85, t) * near;
      col += passageStars(u * 68.0, z * 4.1 + 77.0, 68.0, 1.6, dens * 0.7, t) * near;
      col += passageStars(u * 110.0, z * 6.6 + 151.0, 110.0, 0.8, dens * 0.5, t) * near;

      /* Filaments, out of the three fields already sampled and so for nothing.
         Folding a smooth field about its own midline — 1 − |2n − 1| — turns
         blobs into ridges, and ridges are what makes a photograph of gas read
         as gas rather than as fog. */
      float f1 = 1.0 - abs(n1 * 2.0 - 1.0);
      float f2 = 1.0 - abs(n2 * 2.0 - 1.0);
      float f3 = 1.0 - abs(n3 * 2.0 - 1.0);
      // One turn of fine structure over all of it, at four hashes.
      float grain = vnoiseWrap(vec2(u * 26.0, z * 1.5), 26.0);
      /* And dust. Real nebulae are cut through by lanes of it, and those
         lanes are most of what the eye uses to tell a photograph from a fog
         machine — gas with no dark in it is a gradient. */
      float dust = smoothstep(0.28, 0.66, n2);

      /* Two things are going on in each colour and they do very different
         jobs. The base term is the broad body of the cloud and the folded one
         is the filament through it — and the exponent on the fold is the whole
         trick, because a fold peaks exactly where the field sits at its
         midline, which is where an fbm spends most of its time. At gentle
         powers the "filaments" cover the frame; at sixteen only the crest
         survives.

         The base terms are now a fifth of what they were. Space is black, and
         the passage was lit like a nebula photograph with the exposure left
         open: every part of the frame carried some cloud, so there was no
         black for anything to be bright against and the stars sat in soup.
         Raising the exponents and cutting the gains leaves the broad body as
         a stain in the deepest folds only — the filaments and the objects do
         the work, and everything between them is the colour of space. */
      vec3 gas = vec3(0.20, 0.52, 0.92) * (pow(n1, 6.0) * 0.55 + pow(f1, 16.0) * 1.15)
               + vec3(0.80, 0.24, 0.50) * (pow(n2, 6.5) * 0.45 + pow(f2, 18.0) * 1.0)
               + vec3(0.95, 0.62, 0.22) * (pow(n3, 7.0) * 0.35 + pow(f3, 20.0) * 0.75);
      // Held well under the stars. In a photograph of a region like this the
      // gas is what the stars are seen against, not the other way round.
      col += gas * (0.28 + grain * 0.5) * dust * near;

      // Two streams of galaxies rather than one, on bands that do not divide
      // into each other, so they never arrive in step.
      col += passageGalaxy(u, z, 5.0, 0.55) * 1.25 * near;
      col += passageGalaxy(u + 0.37, z + 2.6, 3.4, 0.40) * 1.05 * near;

      /* The tube itself, and barely there at all. It is meant to be seen
         THROUGH: a wall you can read the shape of is a pipe, and the whole
         point of this passage is that what surrounds you is sky. Enough of a
         suggestion that something is carrying you, and no more. */
      float wall = fbmWrap(vec2(u * 9.0, z * 0.55), 9.0);
      col += vec3(0.30, 0.55, 1.0) * pow(wall, 9.0) * 0.35 * near;

      /* And the far end. With the walls this dark it is the only thing in the
         frame telling you which way "along" is.

         It has to reach past where the near-fade gives out, and by a margin. Cut off
         at 0.05 against a field that stops at 0.11, it left a ring of nothing
         around itself — so the middle of the passage, which is the one place
         the eye is going, was a dark hole with a small glow at the bottom of
         it. The exit is what belongs there; it should own the whole of what
         the compression takes. */
      col += vec3(0.72, 0.86, 1.0) * smoothstep(0.14 + mouth * 0.86, 0.0, r) * (0.9 + mouth * 6.0);
      return col;
    }

    /* One winding of light.
     *
     * Log-polar, because a straight drift in that space is a logarithmic
     * spiral in the frame, and that is the shape everything near a hole is
     * wound into. arms is how many times it goes round per turn of the frame,
     * pitch how tightly it winds and which way, rate how fast it drains
     * inward.
     *
     * Wrapped at arms × scaleA, which is why every caller passes integers for
     * both: at the seam the angle jumps by exactly that much, and a period
     * that does not divide it draws the join as a straight line. */
    float winding(float a, float r, float t, float arms, float pitch, float rate, float scaleA, float scaleR) {
      float ang = (a / 6.2831853 * arms + log(r) * pitch) * scaleA;
      float along = log(r) * scaleR - t * rate;
      return pow(fbmWrap(vec2(ang, along), arms * scaleA), 2.6);
    }

    /* Past the horizon.
     *
     * Nothing is rendered here because nothing gets out, and four seconds of
     * black screen is indistinguishable from the page having stopped. So what
     * fills it is light with no source. */
    vec3 inside(vec2 uv, float t, float aspect) {
      vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
      float r = max(length(p), 0.002);
      float a = atan(p.y, p.x);

      /* Three windings, not one, at three arm counts and three pitches — and
         the middle one turns the other way. One spiral is a whirlpool, which
         is a thing with a bottom and a direction; three crossing each other
         at different rates is a place where the geometry itself has come
         apart, which is the reading this wants. */
      float lum = winding(a, r, t, 5.0, 1.7, 0.55, 3.0, 2.4)
                + winding(a, r, t, 3.0, -2.6, -0.34, 4.0, 1.8) * 0.78
                + winding(a, r, t, 8.0, 1.05, 0.90, 2.0, 3.2) * 0.58;

      float core = smoothstep(0.58, 0.0, r);
      lum *= 0.42 + core * 3.4;

      /* And the flashes, on three rates that never come back into step, so
         they never fall into a rhythm. */
      lum += (pow(max(sin(t * 5.3), 0.0), 22.0)
            + pow(max(sin(t * 3.1 + 1.7), 0.0), 30.0) * 0.8
            + pow(max(sin(t * 7.9 + 0.4), 0.0), 40.0) * 0.6) * (0.3 + core * 0.95);

      /* White, on black, and nothing else. It was graded blue at the rim and
         gold in the middle, and colour is the one thing that has no business
         being here: past the horizon there is no source and no material, so
         a tint is a claim about something that is not there. Light and the
         absence of it is the whole palette. */
      return vec3(lum);
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

      /* The two places the frame stops being the scene and becomes somewhere
         else. Composited here rather than at the very end so that everything
         below — the vignette, the flash, the grain, the fade — still applies
         to them: they are what the camera is looking at, not an overlay on
         top of a camera looking at something else. */
      if (uTunnel > 0.001) {
        color = mix(color, passage(vUv, uTime, uLean, aspect, uMouth), uTunnel);
      }
      if (uInside > 0.001) {
        color = mix(color, inside(vUv, uTime, aspect), uInside);
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

        /* Cover, not stretch: crop the axis the viewport has too much of, so
           the image keeps its proportions at any viewport shape.
           This was inverted, and it was only ever right by accident — when the
           viewport and the photograph happened to share an aspect, both
           branches came to a no-op. Anywhere else it scaled the wrong axis and
           scaled it the wrong way: a phone held upright is 0.46 against the
           plate's 1.78, which took the horizontal span to ±1.9 of a texture
           that ends at ±0.5, so five sixths of what was on screen was the edge
           pixel smeared sideways.
           A cover fit never scales either axis PAST the image — it takes the
           smaller of the two ratios on each, which is what min does here — and
           the result is always a crop. */
        vec2 frac = vec2(pushed.x / aspect, pushed.y);
        vec2 cover = vec2(min(1.0, aspect / uPlateAspect), min(1.0, uPlateAspect / aspect));
        vec2 plateUv = frac * cover + 0.5;

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
