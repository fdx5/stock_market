import * as THREE from "three";
import type { Materials, Style } from "../../drivegame/world/materials";

/* The walk's buildings, drawn as built (no photographs of buildings: frontend/AGENTS.md): each
 * facade style made in its shader from the wall's own metres (the drive world gives each wall uv in
 * metres along it and up it, floors scaled to a standard height) —
 *   apt     painted concrete, a full-width glazed balcony a floor (the Korean 확장형 front), aluminium
 *           frames, a glass balustrade, a stair-core bay of wall, rain streaks under the sills
 *   villa   red-brown brick in stretcher bond, smaller windows with stone sills
 *   shop    a glazed shopfront on the ground floor, tiled upper floors with windows
 *   office  a curtain wall: glass between mullions, a spandrel at each floor
 * Behind every window a room (interior mapping: the eye's ray followed into a box behind the
 * glass — back wall, side walls, floor, ceiling, a curtain, furniture, its light at night), the
 * window recessed in the wall (its reveal shows with the angle), the glass reflecting the sky by
 * Fresnel. The walls are a mid-tone, not the drive game's near-white. Only the walk uses this: it
 * changes the walk's own copy of the drive materials. */

const STYLE_ID: Record<Style, number> = { apt: 0, villa: 1, shop: 2, office: 3 };

const GLSL_COMMON = /* glsl */`
uniform float fNight; uniform float fLit; uniform float fClock;
varying vec3 vFW; varying vec3 vFN; varying vec2 vFUv;
vec3 fEmit; float fRough; float fMetal; float fGlass;
float fh1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh1(i), fh1(i + vec2(1.0, 0.0)), f.x), mix(fh1(i + vec2(0.0, 1.0)), fh1(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * fn2(p); p *= 2.03; a *= 0.5; } return s; }
float box(vec2 p, vec2 a, vec2 b) { return step(a.x, p.x) * step(a.y, p.y) * step(p.x, b.x) * step(p.y, b.y); }
vec3 fTilt; float fAO;
/* edges softened over the pixel's footprint w (m): no stair-steps and no shimmer far off */
float sedge(float e, float x, float w) { return smoothstep(e - w, e + w, x); }
float sbox(vec2 p, vec2 a, vec2 b, float w) { return sedge(a.x, p.x, w) * sedge(a.y, p.y, w) * (1.0 - sedge(b.x, p.x, w)) * (1.0 - sedge(b.y, p.y, w)); }

/* A room behind a window: ro (m) on the glass, rd the ray in the room's frame (x along the wall, y up,
 * z into the room), the room w × h × d; seed picks its finish, light and curtain. */
vec3 room(vec3 ro, vec3 rd, vec3 sz, float seed, float night) {
  rd.z = max(rd.z, 0.04);
  float tx = rd.x > 0.0 ? (sz.x - ro.x) / rd.x : -ro.x / min(rd.x, -1e-4);
  float ty = rd.y > 0.0 ? (sz.y - ro.y) / rd.y : -ro.y / min(rd.y, -1e-4);
  float tz = (sz.z - ro.z) / rd.z;
  float t = min(min(tx, ty), tz);
  vec3 p = ro + rd * t;
  float s1 = fract(seed * 7.13), s2 = fract(seed * 13.7), s3 = fract(seed * 3.31);
  vec3 wallC = mix(vec3(0.82, 0.79, 0.72), vec3(0.72, 0.74, 0.76), s1);
  vec3 col;
  if (t == tz) {
    col = wallC * 0.92;
    // a doorway or a picture on the back wall
    if (s2 < 0.5 && box(p.xy, vec2(sz.x * 0.6, 0.0), vec2(sz.x * 0.6 + 0.9, 2.05)) > 0.5) col = vec3(0.32, 0.27, 0.22);
    else if (box(p.xy, vec2(sz.x * 0.25, 1.2), vec2(sz.x * 0.25 + 0.8, 1.75)) > 0.5) col = mix(vec3(0.55, 0.42, 0.3), vec3(0.3, 0.4, 0.5), s3);
  } else if (t == tx) col = wallC * 0.78;
  else if (rd.y < 0.0) col = mix(vec3(0.46, 0.33, 0.22), vec3(0.62, 0.55, 0.46), s3) * (0.8 + 0.2 * fn2(p.xz * 3.0));
  else col = vec3(0.86);
  // furniture: a low dark mass (a sofa, a bed, a desk) on the floor part way in
  if (p.y < 0.75 && p.z > 1.6 && p.z < 3.2 && p.x > sz.x * 0.15 && p.x < sz.x * 0.8) col *= 0.45;
  // daylight falls off into the room; a lamp on at night (some rooms dark)
  float day = mix(1.0, 0.35, clamp(p.z / sz.z, 0.0, 1.0));
  // (the share of homes lit follows the hour: fLit, from the evening's ~70% to a few at 3 a.m.)
  float lamp = step(1.0 - fLit, s2) * night;
  // Korean flats: living rooms under cool-white LED panels (주광색), bedrooms and some rooms warm (전구색)
  vec3 lampC = s3 < 0.55 ? vec3(1.12, 1.16, 1.2) : vec3(1.38, 1.02, 0.62);
  // (by day a room is far darker than the sunlit street: a window reads dark, the sky reflected in it)
  vec3 lit = col * (day * (1.0 - night) * 0.14 + lamp * lampC);
  if (t != tz && rd.y > 0.0) lit += lamp * lampC * 0.9 * smoothstep(1.2, 0.0, length(p.xz - vec2(sz.x * 0.5, sz.z * 0.5)));
  // a television watched in the dark: the room flickering blue
  float tv = step(fract(seed * 5.71), 0.16) * night * (1.0 - lamp);
  float flick = (0.55 + 0.25 * sin(fClock * 6.3 + seed * 40.0) + 0.2 * sin(fClock * 17.1 + seed * 13.0)) * (0.7 + 0.3 * step(0.5, fract(fClock * 0.23 + seed)));
  lit += col * tv * flick * vec3(0.32, 0.45, 0.95);
  return lit;
}
`;

/** the facade, after the material's colour: albedo, roughness, metal, the room's light (emissive) */
const GLSL_FACADE = /* glsl */`
{
  vec3 N = normalize(vFN);
  fEmit = vec3(0.0); fRough = 0.9; fMetal = 0.0; fGlass = 0.0; fTilt = vec3(0.0); fAO = 1.0;
  if (abs(N.y) < 0.6) {
    float u = vFUv.x, h = 1.0 - vFUv.y;             // metres along the wall, scaled metres up it
    vec3 T = normalize(vec3(-N.z, 0.0, N.x));
    vec3 V = normalize(vFW - cameraPosition);
    // (the uv runs along world x or y, whichever the wall follows: match the tangent's sense to it)
    float su = abs(T.x) > abs(T.z) ? sign(T.x) : sign(-T.z);
    vec3 rd = vec3(dot(V, T) * su, V.y, -dot(V, N));
    vec3 tint = vColor.rgb;
    float bld = fh1(floor(vFW.xz / 37.0) + vec2(STYLE_SEED));
    // the pixel's footprint on the wall (m), for the soft edges and for fading fine lines far off
    float px = max(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(h), dFdy(h)))) * 0.75 + 1e-4;
    float fine = 1.0 - smoothstep(0.025, 0.09, px);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 albedo;
    // ---- the wall and the window grid of the style
    float FH = STYLE == 3 ? 3.8 : STYLE == 2 ? 3.4 : 2.9;
    float BW = STYLE == 1 ? 3.0 : STYLE == 3 ? 1.6 : STYLE == 2 ? 2.6 : 3.4;
    float base = STYLE == 2 ? 4.2 : 1.1;            // the shop's ground floor; the others' plinth
    float fl = floor((h - base) / FH), fy = fract((h - base) / FH) * FH;
    float bay = floor(u / BW), fx = fract(u / BW) * BW;
    float cellSeed = fh1(vec2(bay, fl) + bld * 17.0);
    // window opening (x0, y0)-(x1, y1) in the cell, metres
    vec2 w0, w1;
    if (STYLE == 0) { w0 = vec2(0.32, 0.38); w1 = vec2(BW - 0.32, FH - 0.42); }
    else if (STYLE == 1) { w0 = vec2(0.7, 0.95); w1 = vec2(BW - 0.7, FH - 0.55); }
    else if (STYLE == 2) { w0 = vec2(0.4, 0.9); w1 = vec2(BW - 0.4, FH - 0.6); }
    else { w0 = vec2(0.06, 1.05); w1 = vec2(BW - 0.06, FH - 0.08); }
    bool solidBay = STYLE == 0 && mod(bay + floor(bld * 5.0), 6.0) < 1.0;   // the stair core
    bool open = h > base && !solidBay;
    // shopfront: the ground floor all glass between piers
    bool shopfront = STYLE == 2 && h < base && h > 0.15;
    if (shopfront) { fx = fract(u / 3.2) * 3.2; fy = h; w0 = vec2(0.18, 0.15); w1 = vec2(3.02, 3.4); open = true; cellSeed = fh1(vec2(floor(u / 3.2), -1.0) + bld); }
    // the wall's finish
    if (STYLE == 1) {
      // brick, stretcher bond: 0.19 × 0.057 m units, 10 mm mortar
      vec2 bp = vec2(u / 0.2, h / 0.067); bp.x += 0.5 * mod(floor(bp.y), 2.0);
      vec2 bf = fract(bp), bi = floor(bp);
      float mortar = step(bf.x, 0.05) + step(bf.y, 0.15);
      vec3 brick = mix(vec3(0.42, 0.22, 0.16), vec3(0.55, 0.33, 0.24), fh1(bi)) * (0.85 + 0.3 * fn2(bp * 0.7));
      albedo = mix(brick, vec3(0.62, 0.6, 0.56), clamp(mortar, 0.0, 1.0));
      fRough = 0.92;
    } else if (STYLE == 2) {
      // porcelain tile 0.6 × 0.3 on the upper floors
      vec2 tp = vec2(u / 0.6, h / 0.3), tf = fract(tp);
      float joint = step(tf.x, 0.02) + step(tf.y, 0.04);
      albedo = mix(tint * vec3(0.5, 0.49, 0.46), vec3(0.3), clamp(joint, 0.0, 1.0)) * (0.92 + 0.12 * fh1(floor(tp)));
      fRough = 0.55;
    } else if (STYLE == 3) {
      albedo = vec3(0.32, 0.34, 0.36); fRough = 0.45; fMetal = 0.6;   // spandrel panels, aluminium
    } else {
      // painted concrete: a mid tone of the building's colour, large soft variation
      // (a real painted wall reflects ~40%: the drive game's lifted near-white glared in the sun)
      // (toned down: a weathered painted wall a little greyed, the building's colour only a hint)
      albedo = mix(vec3(0.27, 0.265, 0.252), dot(tint, vec3(0.33)) * vec3(0.3) + (tint - dot(tint, vec3(0.33))) * 0.12, 0.45) * (0.9 + 0.18 * fbm(vec2(u, h) * 0.08));
      fRough = 0.88;
      // each floor's slab edge stands proud of the wall: a lighter band, its top catching the sky,
      // its underside dark, and the band's shadow on the wall below it
      if (h > base) {
        float band = 1.0 - sedge(0.2, fy, px);
        albedo = mix(albedo, albedo * 1.14 + 0.015, band);
        fTilt += up * 0.55 * band * (1.0 - sedge(0.17, fy, px)) * sedge(0.12, fy, px);
        fTilt -= up * 0.6 * (1.0 - sedge(0.035, fy, px));
        fAO *= 1.0 - 0.32 * smoothstep(FH - 0.55, FH, fy);
      }
      // the stair core's bay set back a little: its edges shaded
      if (solidBay) fAO *= 1.0 - 0.25 * (1.0 - sedge(0.12, fx, px) * (1.0 - sedge(BW - 0.12, fx, px)));
    }
    // rain streaks under the sills, grime toward the ground
    float under = (fy < w0.y && fx > w0.x && fx < w1.x && open) ? smoothstep(0.0, w0.y, fy) : 0.0;
    albedo *= 1.0 - 0.22 * under * (0.5 + 0.5 * fn2(vec2(u * 9.0, h * 0.6)));
    albedo *= 1.0 - 0.12 * smoothstep(4.0, 0.0, h) * fbm(vec2(u, h) * 1.3);
    albedo *= 0.94 + 0.12 * fbm(vec2(u * 0.6, h * 0.25) + bld);
    // ---- the window: frame, recess, glass, the room behind
    float wm = open ? sbox(vec2(fx, fy), w0 - 0.06, w1 + 0.06, px) : 0.0;
    vec3 wallAlbedo = albedo; float wallRough = fRough, wallMetal = fMetal;
    if (wm > 0.001) {
      vec2 c = vec2(fx, fy);
      float recess = STYLE == 3 ? 0.04 : 0.18;
      // the opening seen at an angle: where the glass (recess deep) lies along the ray
      vec2 shift = rd.xy / max(rd.z, 0.08) * recess;
      vec2 g = c + shift;
      bool onGlass = g.x > w0.x && g.x < w1.x && g.y > w0.y && g.y < w1.y;
      // the recess: the lintel's shadow on the glass's top, less at the sides
      float wao = (1.0 - 0.45 * smoothstep(w1.y - 0.35, w1.y, g.y)) * (1.0 - 0.18 * (1.0 - smoothstep(w0.x, w0.x + 0.2, g.x) * (1.0 - smoothstep(w1.x - 0.2, w1.x, g.x))));
      fAO *= mix(1.0, wao, wm);
      if (!onGlass) {
        albedo = albedo * 0.62; fRough = 0.9;       // the reveal: the opening's side in shadow
        fAO *= mix(1.0, 0.7, wm);
        fTilt += (g.y > w1.y ? -up : g.y < w0.y ? up : vec3(0.0)) * 0.5 * wm;
      } else {
        // aluminium frame: the outer frame, mullions, the transom, (apt) the balustrade rail
        float fw = 0.05;
        float mull = STYLE == 3 ? 0.0 : (STYLE == 0 ? 3.0 : 2.0);
        float frame = 0.0;
        frame += step(g.x, w0.x + fw) + step(w1.x - fw, g.x) + step(g.y, w0.y + fw) + step(w1.y - fw, g.y);
        if (mull > 0.0) { float mx = fract((g.x - w0.x) / ((w1.x - w0.x) / mull)); frame += step(mx, 0.025) + step(0.975, mx); }
        float transom = w0.y + (w1.y - w0.y) * 0.78; frame += box(g, vec2(-9.0, transom - 0.025), vec2(99.0, transom + 0.025));
        float rail = STYLE == 0 ? w0.y + 1.0 : -9.0;
        bool balustrade = STYLE == 0 && g.y < rail;
        if (frame * fine > 0.5) {
          albedo = STYLE == 1 ? vec3(0.62, 0.62, 0.6) : vec3(0.42, 0.44, 0.45); fRough = 0.42; fMetal = 0.45;
        } else {
          // the room
          vec2 gw = g - w0, gs = w1 - w0;
          vec3 ro = vec3(gw, 0.0);
          vec3 sz = vec3(gs.x, max(gs.y + 0.4, 2.4), 4.5);
          ro.y += 0.3;
          vec3 rcol = room(ro, rd, sz, cellSeed, fNight);
          // the curtain: drawn some way from either side, sheer white or heavier
          float cs = fh1(vec2(cellSeed, 3.0));
          float cw = cs < 0.35 ? 0.0 : (cs - 0.35) * 0.9;
          float cur = step(gw.x / gs.x, cw * 0.5) + step(1.0 - cw * 0.5, gw.x / gs.x);
          vec3 curtainC = mix(vec3(0.92, 0.9, 0.84), vec3(0.6, 0.55, 0.48), step(0.75, cs));
          float folds = 0.85 + 0.15 * sin(gw.x * 40.0);
          float roomLit = fNight * step(1.0 - fLit, fract(cellSeed * 13.7));
          rcol = mix(rcol, curtainC * folds * (0.5 + 0.9 * roomLit), clamp(cur, 0.0, 1.0) * 0.92);
          // venetian blinds in some windows, let down part way
          if (cs > 0.2 && cs < 0.35) {
            float down = 0.35 + fh1(vec2(cellSeed, 7.0)) * 0.5, slat = 0.78 + 0.22 * step(0.45, fract(gw.y * 16.0));
            vec3 blindC = mix(vec3(0.88, 0.87, 0.83), vec3(0.62, 0.55, 0.45), step(0.28, cs)) * slat * (0.45 + 1.05 * roomLit);
            rcol = mix(rcol, blindC, step(1.0 - down, gw.y / gs.y) * 0.95);
          }
          // a glass balustrade (apt): frosted, the room less visible through it
          if (balustrade) { rcol *= 0.55; albedo = vec3(0.2, 0.23, 0.24); fRough = 0.3; }
          else albedo = vec3(0.02);
          fGlass = balustrade ? 0.5 : 1.0;
          fRough = balustrade ? 0.25 : 0.04; fMetal = 0.0;
          // the glass slightly green-grey (or a household's tinted film: darker, more mirror-like)
          float film = fh1(vec2(cellSeed, 11.0));
          vec3 glassT = film < 0.12 ? vec3(0.42, 0.48, 0.5) : film < 0.3 ? vec3(0.8, 0.86, 0.95) : vec3(0.86, 0.92, 0.9);
          fEmit = rcol * glassT * (balustrade ? 0.6 : 1.0);
          if (film < 0.12) { fMetal = 0.35; fRough = 0.03; } else fRough += film * 0.04;
          // an air-conditioner's outdoor unit on the balcony, behind the balustrade's glass (실외기)
          if (balustrade && fh1(vec2(cellSeed, 9.0)) < 0.38 && gw.x > gs.x - 1.05 && gw.x < gs.x - 0.2 && g.y < w0.y + 0.72) {
            float grille = 0.82 + 0.18 * step(0.5, fract(gw.x * 22.0)) * step(gw.x, gs.x - 0.55);
            albedo = vec3(0.6, 0.61, 0.6) * grille; fEmit = vec3(0.0); fGlass = 0.0; fRough = 0.55; fMetal = 0.1;
          }
        }
      }
    }
    // (the window's edge blended over the pixel: soft, not stepped)
    albedo = mix(wallAlbedo, albedo, wm); fRough = mix(wallRough, fRough, wm); fMetal = mix(wallMetal, fMetal, wm); fEmit *= wm; fGlass *= wm;
    // the shop's fascia board and its sign band over the shopfront
    if (STYLE == 2 && h > 3.45 && h < base) { albedo = mix(vec3(0.15, 0.17, 0.2), vec3(0.75, 0.2, 0.15), step(0.6, fh1(vec2(floor(u / 6.4), bld)))); fRough = 0.5; fEmit = albedo * 0.6 * fNight; }
    diffuseColor.rgb = albedo;
  } else {
    fRough = 0.92;
  }
}
`;

/* The 공동현관's openings: the wall (and the plinth along its foot) left out where an entrance is,
 * so its doors and lobby are seen and walked into, not a painted wall behind glass. The 16 nearest
 * entrances, set every quarter second (WalkGame): a centre on the wall line (three's x, z), the
 * wall's direction, the half width, the foot and the head of the opening. */
const OPEN_N = 16;
const cutA = Array.from({ length: OPEN_N }, () => new THREE.Vector4(0, 0, 1, 0));
const cutB = Array.from({ length: OPEN_N }, () => new THREE.Vector4(0, 0, 0, 0));
export interface Opening { x: number; z: number; tx: number; tz: number; hw: number; base: number; top: number }
export function setOpenings(list: readonly Opening[]) {
  for (let i = 0; i < OPEN_N; i++) {
    const o = list[i];
    if (o) { cutA[i].set(o.x, o.z, o.tx, o.tz); cutB[i].set(o.hw, o.base - 0.6, o.top, 0); } else cutB[i].set(0, 0, 0, 0);
  }
}
export function cutOpenings(m: THREE.Material) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.cutA = { value: cutA }; sh.uniforms.cutB = { value: cutB };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCutW;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvec4 cutW = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ncutW = instanceMatrix * cutW;\n#endif\nvCutW = (modelMatrix * cutW).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vCutW; uniform vec4 cutA[${OPEN_N}]; uniform vec4 cutB[${OPEN_N}];`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        for (int i = 0; i < ${OPEN_N}; i++) {
          if (cutB[i].x <= 0.0) continue;
          vec2 d = vCutW.xz - cutA[i].xy;
          float along = dot(d, cutA[i].zw), across = dot(d, vec2(-cutA[i].w, cutA[i].z));
          if (abs(along) < cutB[i].x && abs(across) < 0.9 && vCutW.y > cutB[i].y && vCutW.y < cutB[i].z) discard;
        }`);
  };
  m.customProgramCacheKey = () => prevKey.call(m) + "-cut";
  m.needsUpdate = true;
}

/** Make the walk's copy of the drive materials' facades into the buildings described above. */
export function realFacades(mats: Materials, night: number) {
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  const nightU = { value: night }, litU = { value: 0.6 }, clockU = { value: 0 };
  for (const style of Object.keys(STYLE_ID) as Style[]) {
    const m = mats.facades[style];
    // (the drive game's facade pictures and maps off; a white texel keeps the uv in the shader)
    m.map = white; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.emissiveMap = null; m.aoMap = null;
    m.roughness = 1; m.metalness = 1; m.emissive.set("#ffffff"); m.emissiveIntensity = 1;
    // (less of the blue sky's fill on the walls: in shade they read a neutral grey, not blue-white)
    m.envMapIntensity = 0.62;
    m.onBeforeCompile = sh => {
      sh.uniforms.fNight = nightU; sh.uniforms.fLit = litU; sh.uniforms.fClock = clockU;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFW; varying vec3 vFN; varying vec2 vFUv;")
        .replace("#include <project_vertex>", "vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFN = normalize(mat3(modelMatrix) * objectNormal);\nvFUv = uv;\n#include <project_vertex>");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\n#define STYLE ${STYLE_ID[style]}\n#define STYLE_SEED ${STYLE_ID[style] * 11 + 3}.0\n${GLSL_COMMON}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${GLSL_FACADE}`)
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = fEmit;")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;\nroughnessFactor = fRough;")
        // (the relief: normals tilted at the slab edges and reveals; their shade on the light taken)
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(fTilt, 0.0)).xyz);")
        .replace("#include <aomap_fragment>", "#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= fAO; reflectedLight.indirectSpecular *= fAO; reflectedLight.directDiffuse *= mix(1.0, fAO, 0.6);");
    };
    m.customProgramCacheKey = () => `walkFacade3-${style}`;
    cutOpenings(m);
  }
  return {
    setNight(k: number) { nightU.value = k; },
    /** the share of homes with a light on (the hour's) */
    setLit(f: number) { litU.value = f; },
    tick(seconds: number) { clockU.value = seconds % 1000; },
    dispose() { white.dispose(); },
  };
}
