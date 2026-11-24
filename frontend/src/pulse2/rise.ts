// The rally take (index or stock up 1 % or more): in a vast cavern a figure sits in the
// lotus on the floor, meditates, raises its right arm straight to the sky — a red beam pulses up from
// the hand to the vault — and gold and silver dust rains down through the hall, fading
// away as it nears the floor.
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type U = Record<string, { value: unknown }>;
const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;

export const CEILING = 34;
/** The canopy of light the beam strikes, low enough to be seen in the frontal wide view;
 *  the light spreads across it to SPREAD_R (63 % of the way in SPREAD_T seconds). */
export const CANOPY = 22;
const SPREAD_R = 36, SPREAD_T = 2.4;

/** Gold dust raining from the vault:
 *  small round grains with a white core in six gold tones, twinkling, a faint light trail
 *  above each, and now and then a four-point star glint. GPU only: each grain falls on its
 *  own loop; `uOn` is the seconds since the rain began, so its front comes down from the
 *  vault; grains fade away as they near the floor. */
export class GoldRain {
  readonly mesh: THREE.Points;
  private on = { value: -1 };
  private vis = { value: 0 };
  /** Grains shown now (eased) and wanted: the base count times the rally's density. */
  private shown = { value: 0 };
  private want = 0;
  private readonly base: number;
  private readonly cap: number;

  /** `count` grains at +1 %; room is made for up to `maxMult` times that. */
  constructor(scene: THREE.Scene, u: U, common: string, count: number, maxMult = 1) {
    this.base = count; this.cap = Math.ceil(count * maxMult); this.want = this.shown.value = count;
    count = this.cap;
    const tones = ["#fff4c2", "#ffd76a", "#f2b53a", "#ffe9a3", "#d9962b", "#fffbe8", "#eef3fb", "#c9d4e6"].map(h => new THREE.Color(h));
    const seed = new Float32Array(count * 4), kind = new Float32Array(count * 4), colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // over the whole cave, a little denser toward the middle
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.pow(Math.random(), 0.9) * 34, z = Math.random();
      seed.set([Math.cos(a) * r, Math.sin(a) * r, Math.random(), z * z], i * 4);
      // tone 0..5 gold, 6..7 silver (a third), fall speed (m/s), twinkle phase, star (7 %, as on the home)
      const toneIdx = Math.random() < 0.34 ? 6 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * 6);
      const tc = tones[toneIdx];
      colors[i * 3] = tc.r; colors[i * 3 + 1] = tc.g; colors[i * 3 + 2] = tc.b;
      kind.set([toneIdx, 1.6 + Math.random() * 2.6, Math.random() * 6.28, Math.random() < 0.22 ? 1 : 0], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("aKind", new THREE.BufferAttribute(kind, 4));
    g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aIdx", new THREE.BufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1));
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...u, uOn: this.on, uVis: this.vis, uShown: this.shown }, ...additive,
      vertexShader: /* glsl */`attribute vec4 aSeed; attribute vec4 aKind; attribute vec3 aColor; attribute float aIdx; uniform float uTime, uOn, uPR, uShown;
        varying float vA; varying float vTw; varying float vStar; varying vec3 vTone;
        void main(){
          float H = ${CANOPY.toFixed(1)}, sp = aKind.y;
          // The light reaches this grain's place on the canopy (spreading out from the
          // beam), a drop beads there for a moment, then lets go and falls; afterwards it
          // keeps falling on its own loop (continuous: the same clock).
          float r = length(aSeed.xy);
          float reach = -${SPREAD_T.toFixed(2)} * log(max(1e-3, 1.0 - min(r, ${(SPREAD_R - 0.5).toFixed(1)}) / ${SPREAD_R.toFixed(1)}));
          float tau = uOn - reach - (0.5 + aSeed.z * 2.2);        // < 0: still beading
          float beading = step(0.0, uOn - reach) * step(tau, 0.0);
          float fall = tau > 0.0 ? mod(tau * sp, H) : 0.0;
          float y = H - fall - 0.15;
          float started = step(0.0, tau) + beading;
          float sw = aKind.z;
          // a light grain drifts as it falls, swinging a little like a flake
          // (and the air stirs: slow gusts carry the dust sideways in swirls, so it flies, not just drops)
          float gust = sin(uTime*0.23 + aSeed.y*0.05) * 0.6 + sin(uTime*0.11 + aSeed.x*0.04) * 0.4;
          vec3 c = vec3(aSeed.x + sin(uTime*0.9 + sw)*0.7 + sin(fall*0.21 + sw)*1.1 + gust*fall*0.09, y, aSeed.y + cos(uTime*0.7 + sw)*0.7 + cos(fall*0.17 + sw*1.3)*0.9);
          vec4 mv = viewMatrix * vec4(c, 1.0);
          float tw = 0.62 + 0.38 * sin(uTime * (2.2 + fract(sw * 3.7) * 1.6) + sw * 7.0);   // a slow glint, never a strobe
          vTw = tw; vStar = aKind.w; vTone = aColor;
          // grain size in CSS px as on the home (0.35..1.45 x 4), barely scaled by distance;
          // the sprite is three times the grain, to hold its trail and star rays
          float sizePx = (0.35 + aSeed.w * 1.1) * 4.0 * (1.0 + tw * 0.5) * clamp(16.0 / max(1.0, -mv.z), 0.55, 1.35);
          // a drop swells as it beads
          if (beading > 0.5) sizePx *= mix(0.4, 1.15, smoothstep(-(0.5 + aSeed.z * 2.2), 0.0, tau));
          // bright up in the air, fading to nothing as it nears the floor; no grain on the lens;
          // grains past the current count fade in or out one by one as the rally grows or eases
          vA = started * pow(smoothstep(0.1, 4.5, y), 1.3) * smoothstep(0.8, 3.0, -mv.z) * clamp(uShown - aIdx, 0.0, 1.0);
          gl_PointSize = vA > 0.001 ? sizePx * 3.0 * uPR : 0.0;   // nothing to fill for an unseen grain
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`${common} uniform float uVis;
        varying float vA; varying float vTw; varying float vStar; varying vec3 vTone;
        void main(){
          vec2 p = gl_PointCoord - 0.5;              // the grain sits in the middle third
          float d2 = dot(p, p);
          if (d2 > 0.25) discard;
          float d = sqrt(d2);
          vec3 tone = vTone;
          float r = d * 6.0;                         // 0 at the centre, 1 at the grain's edge
          // the home sprite: white core, the tone by 18 %, a third of it by 45 %, gone by the edge
          vec3 col = mix(vec3(1.0), tone, smoothstep(0.0, 0.18, r)) * (1.0 - smoothstep(0.18, 0.45, r) * 0.67) * (1.0 - smoothstep(0.45, 1.0, r));
          // its light trail, above it (gl_PointCoord y runs down)
          float trail = (1.0 - smoothstep(0.0, 0.035, abs(p.x))) * smoothstep(-0.5, -0.05, p.y) * step(p.y, 0.0) * 0.22;
          col += tone * trail;
          // a star glint when it catches the light
          float g = mix(0.25, 1.0, vStar) * smoothstep(0.7, 1.0, vTw);
          float rays = (exp(-abs(p.y) * 70.0) + exp(-abs(p.x) * 70.0)) * (1.0 - smoothstep(0.0, 0.5, d));
          col += mix(vec3(1.0), tone, 0.35) * rays * g * 2.0;
          // and a soft sheen round the grain at the top of its glint
          col += mix(vec3(1.0), tone, 0.5) * exp(-d * 22.0) * g * 0.6;
          float a = vA * uVis * (0.45 + vTw * 0.55) * (0.85 + uHigh*0.25 + uBeat*0.1) * 0.9;
          gl_FragColor = vec4(col * a * 1.3, 1.0); }`,
    }));
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** `since`: seconds since the rain began (<0: not yet); `vis` 0..1. */
  update(since: number, vis: number, dt = 1 / 60) {
    this.on.value = since; this.vis.value = vis; this.mesh.visible = vis > 0.005 && since >= 0;
    // ease toward the wanted count over about a second and a half
    const s = this.shown.value; this.shown.value = s + (this.want - s) * Math.min(1, dt * 2.5);
    this.mesh.geometry.setDrawRange(0, Math.min(this.cap, Math.ceil(this.shown.value + 1)));
  }

  /** Density relative to +1 %: 1.2 at +2 %, 1.4 at +3 %… */
  setDensity(mult: number) { this.want = Math.min(this.cap, this.base * Math.max(1, mult)); }
}

/** The rally take's room: a vast limestone cavern. A dome of rock with a chimney open to the
 *  sky over the figure; its surface carries bedding strata, joints and a fine grain (normals
 *  bent by noise), wet patches that shine; flowing stalactites in clusters hang from the
 *  vault, each with a drop of light at its tip, and stalagmites rise round the walls' foot.
 *  It is lit by the cool light from the chimney and the pool of light round the figure, and
 *  the red beam washes the vault while it burns. */
export class Cave {
  readonly group = new THREE.Group();
  private red = { value: 0 };

  constructor(scene: THREE.Scene, u: U, common: string, noise: string, quality: "high" | "medium") {
    const h = (x: number, y: number, z: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
    const vn = (x: number, y: number, z: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
      const ux = xf * xf * (3 - 2 * xf), uy = yf * yf * (3 - 2 * yf), uz = zf * zf * (3 - 2 * zf);
      const a00 = h(xi, yi, zi), a10 = h(xi + 1, yi, zi), a01 = h(xi, yi + 1, zi), a11 = h(xi + 1, yi + 1, zi);
      const b00 = h(xi, yi, zi + 1), b10 = h(xi + 1, yi, zi + 1), b01 = h(xi, yi + 1, zi + 1), b11 = h(xi + 1, yi + 1, zi + 1);
      const x00 = a00 + (a10 - a00) * ux, x01 = a01 + (a11 - a01) * ux;
      const x10 = b00 + (b10 - b00) * ux, x11 = b01 + (b11 - b01) * ux;
      const y0 = x00 + (x01 - x00) * uy, y1 = x10 + (x11 - x10) * uy;
      return y0 + (y1 - y0) * uz;
    };
    const fbm = (x: number, y: number, z: number) => { let s = 0, a = 0.5; for (let i = 0; i < 5; i++) { s += a * vn(x, y, z); x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1; a *= 0.5; } return s; };
    // (a wide, low vault: the ceiling and the formations hanging from it stay in the wide view)
    const R = 92, HY = 0.42;
    const radius = (d: THREE.Vector3) => {
      // broad bays and buttresses, then rubble-scale relief
      // (ridged noise: sharp crags and fissures rather than soft lumps)
      const ridge = (x: number, y: number, z: number) => 1 - Math.abs(fbm(x, y, z) * 2 - 1);
      let r = R * (0.8 + 0.4 * fbm(d.x * 1.4 + 5, d.y * 1.4, d.z * 1.4)) - 10 * ridge(d.x * 4, d.y * 4 + 3, d.z * 4) - 4 * ridge(d.x * 11 + 2, d.y * 11, d.z * 11);
      if (d.y > 0.9) r += Math.pow((d.y - 0.9) / 0.1, 2) * 40;   // the chimney
      return r;
    };

    // ---- the rock: shared by the dome and the formations
    const red = this.red;
    const rockShader = (wet: number, tone = 1) => (sh: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(sh.uniforms, u, { uRed: red });
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vCaveW;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvCaveW = (modelMatrix*vec4(transformed,1.0)).xyz;")
        // (instanced formations: the world position needs the instance's matrix)
        .replace("vCaveW = (modelMatrix*vec4(transformed,1.0)).xyz;", "#ifdef USE_INSTANCING\nvCaveW = (modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;\n#else\nvCaveW = (modelMatrix*vec4(transformed,1.0)).xyz;\n#endif");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 vCaveW; uniform float uRed;\n${common}${noise}`)
        // limestone colour: bedding strata, mineral staining, darker in the joints
        .replace("#include <color_fragment>", /* glsl */`#include <color_fragment>
          float goldSeam;
          {
            vec3 w = vCaveW;
            float warp = fbm3(w * 0.045) * 7.0;
            float strata = 0.5 + 0.5 * sin(w.y * 0.85 + warp) * 0.25 * smoothstep(0.35, 0.7, fbm3(w * 0.03 + 7.0));
            float grain = fbm3(w * 0.35);
            float stain = smoothstep(0.45, 0.8, fbm3(w * 0.08 + 11.0));
            vec3 pale = vec3(0.30, 0.34, 0.40), dark = vec3(0.10, 0.12, 0.16), mineral = vec3(0.16, 0.20, 0.26);
            // Folded gold-bearing seams share the same strata and grain as the stone.
            float bedding = w.y * 0.27 + warp * 0.72 + grain * 0.55;
            float seamDist = abs(fract(bedding + 0.5) - 0.5);
            float width = clamp(fwidth(bedding), 0.008, 0.12);
            float seam = (1.0 - smoothstep(0.012, 0.022 + width, seamDist))
              * smoothstep(0.34, 0.67, stain * 0.6 + grain * 0.55);
            vec3 c = mix(dark, pale, strata * 0.35 + grain * 0.65);
            c = mix(c, mineral, stain * 0.5);
            goldSeam = seam;
            c = mix(c, vec3(0.53, 0.31, 0.12), seam * 0.65);
            diffuseColor.rgb = c * ${tone.toFixed(2)};
          }`)
        .replace("#include <roughnessmap_fragment>", /* glsl */`#include <roughnessmap_fragment>
          // wet seeps shine
          roughnessFactor = mix(roughnessFactor, 0.22, ${wet.toFixed(2)} * smoothstep(0.55, 0.75, n3(vCaveW * 0.12 + 3.0)));`)
        // relief: analytical screen-space bump gradient from a SINGLE rock height evaluation
        // (replaces 4x finite-difference fbm3 = 20 n3() calls -> 5 n3() calls, 75% less bump ALU!)
        .replace("#include <normal_fragment_maps>", /* glsl */`#include <normal_fragment_maps>
          {
            vec3 w = vCaveW;
            float fine = 0.25 * exp(-length(cameraPosition - w) / 18.0);
            float h0 = fbm3(w * 0.22) + fine * n3(w * 1.6);
            vec3 dpdx = dFdx(w), dpdy = dFdy(w);
            vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
            vec3 r1 = cross(dpdy, nW), r2 = cross(nW, dpdx);
            float det = dot(dpdx, r1);
            vec3 surfGrad = (r1 * dFdx(h0) + r2 * dFdy(h0)) * (sign(det + 1e-9) / (abs(det) + 1e-5));
            vec3 gv = (viewMatrix * vec4(clamp(surfGrad, vec3(-3.2), vec3(3.2)), 0.0)).xyz;
            normal = normalize(normal - gv * 0.8);
          }`)
        .replace("#include <emissivemap_fragment>", /* glsl */`#include <emissivemap_fragment>
          {
            vec3 w = vCaveW;
            vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
            // the cool light falling through the chimney, on the faces turned toward it
            vec3 toSky = normalize(vec3(0.0, 70.0, 0.0) - w);
            float sky = pow(max(dot(nW, toSky), 0.0), 2.6) * (0.3 + 0.7 * exp(-length(w.xz) / 45.0));
            // the glow round the figure, on the lower walls and the formations near it
            vec3 toPool = normalize(vec3(0.0, 2.0, 0.0) - w);
            float pool = max(dot(nW, toPool), 0.0) * exp(-max(w.y, 0.0) / 16.0) * exp(-length(w.xz) / 42.0);
            vec3 albedo = diffuseColor.rgb;
            float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 4.0);
            // the vault, facing down, lit from below by the floor's sheen and the figure's glow
            float under = max(-nW.y, 0.0) * smoothstep(4.0, 24.0, w.y) * exp(-length(w.xz) / 70.0);
            vec3 e = albedo * (uMood * 0.9 + vec3(0.25, 0.3, 0.38)) * sky * 1.3 + albedo * uMood * pool * 1.6
              + albedo * (uMood * 0.35 + vec3(0.04, 0.05, 0.07)) * 0.25 // the cavern's own dim fill
              + albedo * (uMood * 0.7 + vec3(0.06, 0.08, 0.12)) * under * 1.4
              + uMood * rim * 0.12;
            // the red beam on the vault round the chimney
            float vault = smoothstep(10.0, 44.0, w.y) * exp(-length(w.xz) / 38.0);
            e += albedo * vec3(1.0, 0.1, 0.06) * uRed * vault * (1.4 + 0.6 * uBeat);
            // The strike warms the upper strata first. The reflection reaches
            // lower ledges as the gold starts to fall, then ebbs with the beam.
            float age = mod(uTime, 60.0) - 7.65;
            float travel = (length(w.xz) + abs(w.y - 22.0)) * 0.095;
            float arrival = smoothstep(travel, travel + 2.5, age);
            e += vec3(0.83, 0.38, 0.09) * goldSeam * arrival * uRed
              * (0.32 + 0.45 * max(nW.y, 0.0));
            totalEmissiveRadiance += e;
          }`);
    };
    const rock = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05, envMapIntensity: 0.6, side: THREE.BackSide });
    rock.onBeforeCompile = rockShader(0.6);
    const stone = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.08, envMapIntensity: 1.0 });
    stone.onBeforeCompile = rockShader(1.0, 0.55);
    // broken rock adrift: crisp facets
    const shard = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.08, envMapIntensity: 0.8, flatShading: true });
    shard.onBeforeCompile = rockShader(0.6, 0.7); shard.customProgramCacheKey = () => "cave-shard";
    // (the two compile to different programs: three keys programs by the callback's source)
    rock.customProgramCacheKey = () => "cave-rock"; stone.customProgramCacheKey = () => "cave-stone";

    // ---- the dome
    const shell = new THREE.IcosahedronGeometry(1, quality === "high" ? 6 : 5);
    const pos = shell.attributes.position as THREE.BufferAttribute, d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { d.fromBufferAttribute(pos, i).normalize(); const r = radius(d); pos.setXYZ(i, d.x * r, d.y * r * HY + 1, d.z * r); }
    // smooth normals across the facets (the geometry is non-indexed: merge by position)
    const merged = mergeVertices(shell); merged.computeVertexNormals();
    const dome = new THREE.Mesh(merged, rock); dome.userData.speed = 0.003; this.rings.push(dome as unknown as THREE.Group);
    this.group.add(dome);

    const o = new THREE.Object3D();
    // ---- the sanctuary that turns round the figure: three rings of carved stone monoliths
    // at different distances, each turning at its own pace and way, so the space has depth
    // (near stones sweep past far ones) and the whole of it revolves through 360 degrees.
    // Each monolith carries a slit of light down its face. All beyond the camera (26 m out),
    // so nothing ever passes between the lens and the figure.
    const slab = new THREE.BoxGeometry(1, 1, 1, 1, 6, 1).translate(0, 0.5, 0);
    // chamfer the vertical edges a little: a carved block, not a box
    { const p = slab.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), y = p.getY(i); const t = 1 - 0.08 * Math.abs(Math.sin(y * 9.0)) * 0.3; p.setX(i, x * t); p.setZ(i, z * t); } slab.computeVertexNormals(); }
    const inlayMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uRedI: red }, ...additive,
      vertexShader: `attribute float aPh; varying vec2 vUv; varying float vPh; void main(){ vUv = uv; vPh = aPh; gl_Position = projectionMatrix*viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${common} uniform float uRedI; varying vec2 vUv; varying float vPh;
        void main(){
          float x = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float run = pow(0.5 + 0.5 * sin(vUv.y * 9.0 - uTime * (0.8 + uBass) + vPh * 6.0), 6.0);
          float ends = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
          float k = pow(x, 3.0) * ends * (0.25 + run * 1.1) * (0.6 + uEnergy * 0.8);
          vec3 c = mix(uMood * 1.4 + vec3(0.05), vec3(1.0, 0.12, 0.06) * 1.3, uRedI * 0.35);
          gl_FragColor = vec4(c * k, 1.0); }`,
    });
    const rings = [
      { r: 34, n: 22, h: [9, 14], w: [1.6, 2.4], speed: 0.018 },
      { r: 45, n: 30, h: [14, 21], w: [1.8, 2.8], speed: -0.011 },
      { r: 57, n: 40, h: [20, 30], w: [2.0, 3.2], speed: 0.0065 },
    ];
    this.rings.push(...rings.map((ring, ri) => {
      const g = new THREE.Group(), stones = new THREE.InstancedMesh(slab, stone, ring.n);
      const inlays = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 1).translate(0, 0.5, 0), inlayMat, ring.n);
      const ph = new Float32Array(ring.n);
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + h(ri, i, 1) * 0.08, hh = ring.h[0] + h(ri, i, 2) * (ring.h[1] - ring.h[0]), ww = ring.w[0] + h(ri, i, 3) * (ring.w[1] - ring.w[0]);
        o.position.set(Math.cos(a) * ring.r, -0.4, Math.sin(a) * ring.r); o.rotation.set(0, -a + Math.PI / 2, 0); o.scale.set(ww, hh, ww * 0.7); o.updateMatrix();
        stones.setMatrixAt(i, o.matrix);
        // the slit of light on the face toward the figure
        o.position.set(Math.cos(a) * (ring.r - ww * 0.36), 0.6, Math.sin(a) * (ring.r - ww * 0.36)); o.rotation.set(0, -a - Math.PI / 2, 0); o.scale.set(1, hh * 0.86, 1); o.updateMatrix();
        inlays.setMatrixAt(i, o.matrix); ph[i] = h(ri, i, 4);
      }
      inlays.geometry.setAttribute("aPh", new THREE.InstancedBufferAttribute(ph, 1));
      stones.frustumCulled = false; inlays.frustumCulled = false;
      stones.matrixAutoUpdate = false; stones.updateMatrix();
      inlays.matrixAutoUpdate = false; inlays.updateMatrix();
      g.add(stones, inlays); g.userData.speed = ring.speed; g.rotation.y = h(ri, 9, 9) * 6.28;
      this.group.add(g);
      return g;
    }));

    // ---- fragments of rock adrift in the air, orbiting slowly at many distances and heights
    const chunk = new THREE.IcosahedronGeometry(1, 1);
    { const p = chunk.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { d.fromBufferAttribute(p, i); const k = 0.55 + 0.9 * fbm(d.x * 1.7 + 4, d.y * 1.7, d.z * 1.7); p.setXYZ(i, d.x * k * 1.2, d.y * k * 0.6, d.z * k); } }
    chunk.computeVertexNormals();
    const NC = quality === "high" ? 70 : 44;
    const drift = new THREE.InstancedMesh(chunk, shard, NC);
    this.drift = [];
    for (let i = 0; i < NC; i++) this.drift.push({ r: 30 + h(i, 1, 7) * 34, a: h(i, 2, 7) * 6.28, y: 3 + Math.pow(h(i, 3, 7), 1.3) * 26, s: 0.4 + Math.pow(h(i, 4, 7), 2.2) * 3.2, sp: (h(i, 5, 7) - 0.5) * 0.03, spin: h(i, 6, 7) * 6.28 });
    drift.frustumCulled = false;
    this.driftMesh = drift;
    this.group.add(drift);

    this.group.visible = false;
    scene.add(this.group);
  }

  private rings: THREE.Group[] = [];
  private drift: { r: number; a: number; y: number; s: number; sp: number; spin: number }[] = [];
  private driftMesh!: THREE.InstancedMesh;
  private _o = new THREE.Object3D();
  update(show: boolean, red: number, T: number) {
    this.group.visible = show; this.red.value = red;
    if (!show) return;
    for (const g of this.rings) g.rotation.y = (g.userData.base ??= g.rotation.y) + T * (g.userData.speed as number);
    const o = this._o;
    this.drift.forEach((c, i) => {
      const a = c.a + T * c.sp;
      o.position.set(Math.cos(a) * c.r, c.y + Math.sin(T * 0.2 + c.spin) * 0.6, Math.sin(a) * c.r);
      o.rotation.set(c.spin + T * 0.05, c.spin * 2 + T * 0.03, 0); o.scale.setScalar(c.s); o.updateMatrix();
      this.driftMesh.setMatrixAt(i, o.matrix);
    });
    this.driftMesh.instanceMatrix.needsUpdate = true;
  }
}

/** The red beam from the raised hand to the vault: a white-hot core, a red glow round it,
 *  pulses of light running up it, a flare where it leaves the hand and where it strikes. */
export class RedBeam {
  readonly group = new THREE.Group();
  private len = { value: 0 };
  private vis = { value: 0 };
  private age = { value: 0 };
  private gain = { value: 1 }; private haloGain = { value: 1 };
  /** Where the beam ends (the canopy), or past the vault when unset. */
  top: number | null = null;
  private thick = 1; private haloK = 1;
  private core: THREE.Mesh; private halo: THREE.Mesh;
  private hand: THREE.Sprite; private strike: THREE.Sprite;

  constructor(scene: THREE.Scene, u: U, common: string, glow: THREE.Texture) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
    const mat = (core: number) => new THREE.ShaderMaterial({
      uniforms: { ...u, uLen: this.len, uVis: this.vis, uAge: this.age, uGain: core ? this.gain : this.haloGain, uIsCore: { value: core } }, ...additive, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vW; varying float vY; void main(){ vY = position.y; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${common} uniform float uLen, uVis, uAge, uGain, uIsCore; varying vec3 vN; varying vec3 vW; varying float vY;
        void main(){
          if (vY > uLen) discard;
          vec3 V = normalize(cameraPosition - vW); float face = abs(dot(normalize(vN), V));
          float L = ${CEILING.toFixed(1)};
          float h = vY * L;
          // a train of fine pulses streaming up, and a big pulse every two seconds
          float fine = pow(0.5 + 0.5*sin(h*0.9 - uTime*5.0), 4.0);
          float big = 0.0;
          for (int i = 0; i < 3; i++) { float ph = mod(uAge - float(i)*2.0, 6.0); big += exp(-pow((h - ph*26.0)*0.35, 2.0)) * step(0.0, uAge - float(i)*2.0); }
          float tipFade = smoothstep(uLen, uLen - 0.04, vY);
          float base = smoothstep(0.0, 0.01, vY);
          float k;
          vec3 col;
          if (uIsCore > 0.5) { k = pow(face, 3.0) * (1.2 + fine*0.35 + big*1.7); col = mix(vec3(1.0, 0.12, 0.06), vec3(1.0, 0.78, 0.62), pow(face, 8.0)) * k * 1.55; }
          else { k = pow(face, 2.0) * (0.25 + fine*0.12 + big*0.9); col = vec3(1.0, 0.07, 0.035) * k * 0.3; }
          col *= (1.0 + uBeat*0.2 + uEnergy*0.25) * tipFade * base * uVis * uGain;
          gl_FragColor = vec4(col, 1.0); }`,
    });
    const core = new THREE.Mesh(geo, mat(1)); core.scale.set(0.06, CEILING + 26, 0.06);
    const halo = new THREE.Mesh(geo, mat(0)); halo.scale.set(0.4, CEILING + 26, 0.4);
    this.core = core; this.halo = halo;
    const sprite = (c: number) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.renderOrder = 4; return s; };
    this.hand = sprite(0xff3020); this.strike = sprite(0xff2a18);
    for (const m of [core, halo]) { m.frustumCulled = false; this.group.add(m); }
    this.group.visible = false;
    scene.add(this.group, this.hand, this.strike);
  }

  /** A stronger beam: `thick` times as wide, `gain` times as bright (1, 1: the usual); the
   *  glow round it can be held back on its own (`halo`: its width and brightness). */
  setPower(thick: number, gain: number, halo = 1) {
    if (thick !== this.thick || halo !== this.haloK) {
      this.thick = thick; this.haloK = halo;
      this.core.scale.set(0.06 * thick, CEILING + 26, 0.06 * thick); this.halo.scale.set(0.4 * thick * halo, CEILING + 26, 0.4 * thick * halo);
    }
    this.gain.value = gain; this.haloGain.value = gain * halo;
  }

  private static UP = new THREE.Vector3(0, 1, 0);
  private _d = new THREE.Vector3();
  /** `from`: the hand; `age`: seconds since the beam left it (<0: none); `vis` 0..1; `to`:
   *  where it ends instead of the vault (a beam bending in to meet another). */
  update(from: THREE.Vector3, age: number, vis: number, beat: number, to?: THREE.Vector3) {
    const on = age >= 0 && vis > 0.005;
    this.group.visible = on; this.hand.visible = on; this.strike.visible = on;
    if (!on) return;
    this.group.position.copy(from);
    // shoots up to the vault in under a second
    const grow = Math.min(1, age / 0.8), len = 1 - Math.pow(1 - grow, 3);
    this.len.value = len * (CEILING / (CEILING + 26)) + (grow >= 1 ? 26 / (CEILING + 26) : 0); this.vis.value = vis; this.age.value = age;
    if (to) {
      const d = this._d.subVectors(to, from), dist = d.length();
      this.group.quaternion.setFromUnitVectors(RedBeam.UP, d.multiplyScalar(1 / Math.max(1e-4, dist)));
      this.len.value = Math.min(this.len.value, dist / (CEILING + 26));
    } else {
      this.group.quaternion.identity();
      if (this.top !== null) this.len.value = len * Math.max(0.01, this.top - from.y) / (CEILING + 26);
    }
    if (to) this.strike.visible = false;
    const flash = Math.exp(-age * 1.6) * 1.5;   // (a swell, not a flash)
    this.hand.position.copy(from);
    this.hand.scale.setScalar((0.9 + flash * 0.6 + beat * 0.15 + Math.sin(age * 2.2) * 0.04) * vis * Math.sqrt(this.thick));
    this.hand.material.opacity = Math.min(1, 0.8 + flash) * vis;
    this.strike.position.set(from.x, this.top ?? CEILING + 2, from.z);
    const hit = grow >= 1 ? Math.exp(-(age - 0.8) * 1.0) * 2.2 + 1 : 0;
    this.strike.scale.setScalar((3 + hit * 2.0 + beat * 0.5) * vis * Math.sqrt(this.thick));
    this.strike.material.opacity = Math.min(1, 0.6 + hit * 0.2) * vis * (grow >= 1 ? 1 : 0);
  }
}

/** The canopy of light the beam strikes: where it meets it the light spreads out across
 *  the canopy in a widening ring (red at the heart, gold toward the rim, a breath of silver
 *  at the edge), a web of light pooling inside it, and drops of gold and silver beading on
 *  it, glinting, before they fall (the falling is GoldRain's). */
export class LightCanopy {
  readonly mesh: THREE.Mesh;
  private age = { value: -1 };
  private vis = { value: 0 };
  private at = { value: new THREE.Vector2() };

  constructor(scene: THREE.Scene, u: U, common: string, noise: string) {
    const geo = new THREE.CircleGeometry(SPREAD_R + 2, 160).rotateX(Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { ...u, uAge: this.age, uVisC: this.vis, uAt: this.at }, ...additive, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${common}${noise} uniform float uAge, uVisC; uniform vec2 uAt; varying vec3 vW;
        float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          if (uAge < 0.0) discard;
          vec2 q = vW.xz - uAt; float r = length(q);
          float Rs = ${SPREAD_R.toFixed(1)} * (1.0 - exp(-uAge / ${SPREAD_T.toFixed(2)}));
          // the spreading front, bright as it races out, calmer as it slows
          float speed = exp(-uAge / ${SPREAD_T.toFixed(2)});
          float front = exp(-pow((r - Rs) * 0.55, 2.0)) * (0.35 + 1.4 * speed);
          // inside it, light pooling in a slow web (caustics on a ceiling of water)
          float inside = smoothstep(Rs + 0.5, Rs - 5.0, r);
          vec3 p3 = vec3(q * 0.16, uTime * 0.07);
          float web = pow(1.0 - abs(n3(p3) - 0.5) * 2.0, 7.0) * 0.8 + pow(1.0 - abs(n3(p3 * 2.3 + 4.0) - 0.5) * 2.0, 10.0) * 0.5;
          float pool = inside * (0.1 + web * 0.75) * (0.85 + 0.15 * sin(uTime * 0.6 - r * 0.2));
          // the heart where the beam meets it
          float heart = exp(-r * 0.45) * 1.6 + exp(-r * 1.6) * 2.5;
          // drops beading on it: one in each cell of a fine grid, swelling and glinting
          vec2 cell = floor(q / 1.1), f = fract(q / 1.1) - 0.5;
          float hs = hash2(cell); vec2 jit = vec2(hash2(cell + 7.1), hash2(cell + 3.3)) - 0.5;
          float d = length(f - jit * 0.6);
          float cr = length((cell + 0.5) * 1.1);
          float born = smoothstep(0.0, 1.2, uAge - (-${SPREAD_T.toFixed(2)} * log(max(1e-3, 1.0 - min(cr, ${(SPREAD_R - 0.5).toFixed(1)}) / ${SPREAD_R.toFixed(1)}))));
          float glint = pow(0.5 + 0.5 * sin(uTime * (0.7 + hs * 1.3) + hs * 40.0), 4.0);
          float bead = exp(-d * d * 260.0) * born * step(0.45, hs) * (0.4 + glint * 0.85);
          vec3 red = vec3(1.0, 0.16, 0.08), gold = vec3(1.0, 0.72, 0.28), silver = vec3(0.82, 0.88, 1.0);
          vec3 tint = mix(red, gold, smoothstep(1.5, 12.0, r));
          tint = mix(tint, silver, smoothstep(16.0, 32.0, r) * 0.45);
          vec3 beadTint = mix(gold * 1.2, silver * 1.2, step(0.72, hs));
          float edge = smoothstep(${(SPREAD_R + 2).toFixed(1)}, ${(SPREAD_R - 6).toFixed(1)}, r);
          vec3 col = (tint * (front * 0.55 + pool * 0.5) + mix(red, vec3(1.0, 0.8, 0.6), 0.4) * heart * 0.36) * edge + beadTint * bead * edge;
          col *= uVisC * (0.8 + uBeat * 0.1 + uEnergy * 0.15);
          gl_FragColor = vec4(col, 1.0); }`,
    }));
    this.mesh.position.y = CANOPY; this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  /** `at`: where the beam meets the canopy; `age`: seconds since it did (<0: not yet). */
  update(at: THREE.Vector3, age: number, vis: number) {
    this.age.value = age; this.vis.value = vis; this.at.value.set(at.x, at.z);
    this.mesh.visible = age >= 0 && vis > 0.005;
  }
}
