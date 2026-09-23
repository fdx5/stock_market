/* GLSL for the 증시버블 observatory.
 *
 * Everything that used to be a stack of MeshPhysicalMaterial features (transmission,
 * which re-renders the scene, sheen, iridescence, clearcoat) plus DOM glass layers is
 * one hand-written pass per sphere here: a tinted glass body, the company's logo
 * floating inside it as a medallion, a studio reflection computed from the reflection
 * vector (no environment map to sample), a thin-film sheen at the rim, and a glow in
 * the colour of the day's move. The result looks richer and costs a fraction. */

export const SPHERE_VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec3 uImpact;
uniform float uDeform;
uniform float uWobble;
uniform float uHover;
varying vec3 vN;
varying vec3 vV;
varying float vRipple;

void main() {
  vec3 n = normalize(normal);
  vec3 p = position;
  vec3 hit = normalize(uImpact);
  float along = dot(p, hit);
  float c = clamp(uDeform, 0.0, 0.32);
  // Squash toward the contact side, bulge around the waist: volume roughly kept.
  p = p - hit * along * c * 0.55 + (p - hit * along) * c * 0.2;
  float facing = dot(n, hit);
  float ripple = sin(facing * 7.0 - uTime * 11.0 + uSeed) * uWobble;
  p += n * ripple * 0.035;
  p *= 1.0 + sin(uTime * 1.25 + uSeed * 3.1) * 0.0065 + uHover * 0.07;
  vRipple = ripple;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * n);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const SPHERE_FRAG = /* glsl */ `
uniform sampler2D uLogo;
uniform float uHasLogo;
uniform vec3 uTint;
uniform vec3 uGlow;
uniform float uGlowAmt;
uniform float uTime;
uniform float uSeed;
uniform float uHover;
uniform float uPulse;
uniform float uDim;
varying vec3 vN;
varying vec3 vV;
varying float vRipple;

// A photographer's studio, computed from the reflection vector in view space: a big
// softbox up and to the left, a strip light on the right, a cool sky and a dark floor.
vec3 studio(vec3 r) {
  vec3 col = mix(vec3(0.006, 0.01, 0.022), vec3(0.05, 0.085, 0.16), smoothstep(-0.35, 0.9, r.y));
  float box = exp(-pow((r.x + 0.42) * 2.6, 2.0) - pow((r.y - 0.52) * 3.4, 2.0));
  col += vec3(1.0, 0.97, 0.93) * box * 2.4;
  float strip = exp(-pow((r.x - 0.8) * 8.0, 2.0)) * smoothstep(-0.1, 0.55, r.y);
  col += vec3(0.72, 0.86, 1.0) * strip * 1.35;
  float kick = exp(-pow((r.x + 0.9) * 6.0, 2.0) - pow((r.y + 0.15) * 5.0, 2.0));
  col += vec3(0.55, 0.62, 1.0) * kick * 0.5;
  return col;
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);

  // The glass body: deep and tinted at the edge, lit from within at the centre.
  vec3 body = uTint * 0.07 + vec3(0.008, 0.012, 0.028);
  body = mix(body, uTint * 0.42 + vec3(0.02), pow(ndv, 1.7) * 0.6);
  body += uGlow * (pow(ndv, 2.6) * 0.5 + 0.08) * uGlowAmt;

  // The medallion: a frosted disc facing the viewer with the logo on it, set a
  // little behind the surface (the parallax term) so it reads as inside the glass.
  vec2 d = N.xy + N.xy * (1.0 - ndv) * 0.12;
  float r = length(d);
  float plate = smoothstep(0.58, 0.5, r) * step(0.0, N.z);
  vec3 frost = mix(vec3(0.9, 0.94, 1.0), uTint, 0.18);
  body = mix(body, frost * (0.72 + 0.28 * ndv), plate * 0.62);
  vec2 luv = d / 0.66 + 0.5;
  vec4 logo = texture2D(uLogo, luv);
  // Outside the logo's own square the texture would smear its edge pixels across
  // the medallion; mask to the square.
  float inside = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
  float la = logo.a * plate * uHasLogo * inside;
  body = mix(body, logo.rgb, la * 0.96);
  // A thin ring where the medallion meets the glass.
  float ring = exp(-pow((r - 0.56) * 45.0, 2.0)) * step(0.0, N.z);
  body += (uGlow * uGlowAmt * 0.8 + vec3(0.25)) * ring * 0.45;

  // Reflection with a soft thin-film sheen toward the rim.
  vec3 R = reflect(-V, N);
  vec3 env = studio(R);
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (fres * 1.35 + uSeed * 0.13 + vec3(0.0, 0.33, 0.67)));
  env *= mix(vec3(1.0), film * 1.25, 0.32 * smoothstep(0.1, 0.8, fres));
  float F = 0.035 + 0.965 * fres;
  vec3 col = mix(body, env, clamp(F, 0.0, 1.0));

  // Two sharp speculars: the key and a small kicker.
  float s1 = pow(max(dot(R, normalize(vec3(-0.46, 0.62, 0.64))), 0.0), 220.0);
  float s2 = pow(max(dot(R, normalize(vec3(0.78, 0.18, 0.6))), 0.0), 70.0);
  col += vec3(1.0) * (s1 * 3.4 + s2 * 0.55);

  // The day's move, as light: a rim in its colour, a flash when the price ticks.
  col += uGlow * fres * (0.25 + uGlowAmt * 1.25);
  col += uGlow * uPulse * (fres * 1.4 + 0.3);
  col += uGlow * abs(vRipple) * 0.6;
  col *= 1.0 + uHover * 0.22;
  col = mix(col, col * 0.16 + vec3(0.004, 0.007, 0.014), uDim);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* A soft additive halo behind each sphere, in the colour of its move. */
export const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  mv.xy += position.xy * scale;
  gl_Position = projectionMatrix * mv;
}
`;

export const HALO_FRAG = /* glsl */ `
uniform vec3 uGlow;
uniform float uAmt;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.36, d) * smoothstep(0.26, 0.5, d);
  gl_FragColor = vec4(uGlow * a * uAmt, 1.0);
}
`;

/* The sky: a deep radial gradient, two slow aurora bands and a whisper of grain. */
export const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uMood;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uRes.x / max(uRes.y, 1.0);
  float d = length(p * vec2(0.8, 1.15));
  vec3 col = mix(vec3(0.016, 0.03, 0.062), vec3(0.002, 0.003, 0.008), smoothstep(0.0, 0.85, d));
  float t = uTime * 0.035;
  float band1 = exp(-pow((p.y - 0.22 - sin(p.x * 2.2 + t * 3.0) * 0.07) * 7.0, 2.0));
  float band2 = exp(-pow((p.y - 0.34 - sin(p.x * 1.4 - t * 2.0 + 1.7) * 0.09) * 9.0, 2.0));
  float fade = smoothstep(1.1, 0.1, abs(p.x));
  col += vec3(0.05, 0.22, 0.34) * band1 * fade * 0.3;
  col += mix(vec3(0.2, 0.1, 0.36), uMood, 0.45) * band2 * fade * 0.2;
  col += uMood * smoothstep(0.7, 0.0, d) * 0.035;
  col += (hash(vUv * uRes + fract(uTime)) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/* Dust and distant stars, twinkling, fading with depth. */
export const STAR_VERT = /* glsl */ `
uniform float uTime;
uniform float uPx;
attribute float aSize;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec3 p = position;
  p.y += sin(uTime * 0.2 + aSeed * 6.28) * 6.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed * 1.7) + aSeed * 40.0);
  vAlpha = tw * smoothstep(5200.0, 900.0, -mv.z);
  gl_PointSize = aSize * uPx * (900.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const STAR_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a;
  gl_FragColor = vec4(vec3(0.72, 0.86, 1.0) * a * vAlpha, 1.0);
}
`;

/* The observatory floor: a sonar of rings sweeping outward under the cluster. */
export const FLOOR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMood;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float rings = pow(0.5 + 0.5 * cos((r * 26.0 - uTime * 0.9) * 3.14159), 18.0);
  float fine = pow(0.5 + 0.5 * cos(r * 140.0 * 3.14159), 30.0) * 0.25;
  float ang = atan(p.y, p.x);
  float spokes = pow(0.5 + 0.5 * cos(ang * 24.0), 60.0) * 0.35;
  float sweep = pow(max(0.0, cos(ang - uTime * 0.35)), 24.0) * 0.6;
  float fade = smoothstep(1.0, 0.1, r) * smoothstep(0.0, 0.12, r);
  vec3 base = mix(vec3(0.2, 0.6, 1.0), uMood, 0.35);
  vec3 col = base * (rings * 0.55 + fine + spokes * smoothstep(0.2, 0.9, r) + sweep * smoothstep(0.95, 0.2, r)) * fade;
  col += base * exp(-r * r * 6.0) * 0.12;
  gl_FragColor = vec4(col * 0.26, 1.0);
}
`;
