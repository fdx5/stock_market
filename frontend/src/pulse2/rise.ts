// The rally take (index or stock up 1 % or more): in a vast cavern a figure sits in the
// lotus on the floor, meditates, raises its right arm straight to the sky — a red beam pulses up from
// the hand to the vault — and gold and silver dust rains down through the hall, fading
// away as it nears the floor.
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type U = Record<string, { value: unknown }>;
const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;

export const CEILING = 34;

/** Gold dust raining from the vault, drawn like the gold dust on the market home (goldDust.ts):
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
    const seed = new Float32Array(count * 4), kind = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // over the whole cave, a little denser toward the middle
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.pow(Math.random(), 0.9) * 34, z = Math.random();
      seed.set([Math.cos(a) * r, Math.sin(a) * r, Math.random(), z * z], i * 4);
      // tone 0..5, fall speed (m/s), twinkle phase, star (7 %, as on the home)
      kind.set([Math.floor(Math.random() * 6), 1.6 + Math.random() * 2.6, Math.random() * 6.28, Math.random() < 0.07 ? 1 : 0], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("aKind", new THREE.BufferAttribute(kind, 4));
    g.setAttribute("aIdx", new THREE.BufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1));
    // the home's palette: #fff4c2 #ffd76a #f2b53a #ffe9a3 #d9962b #fffbe8
    const tones = ["#fff4c2", "#ffd76a", "#f2b53a", "#ffe9a3", "#d9962b", "#fffbe8"].map(h => new THREE.Color(h));
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...u, uOn: this.on, uVis: this.vis, uShown: this.shown, uTones: { value: tones } }, ...additive,
      vertexShader: /* glsl */`attribute vec4 aSeed; attribute vec4 aKind; attribute float aIdx; uniform float uTime, uOn, uPR, uShown;
        varying float vA; varying float vTw; varying float vStar; varying float vTone;
        void main(){
          float H = ${CEILING.toFixed(1)}, sp = aKind.y;
          float fall = mod(aSeed.z * H + uTime * sp, H);           // metres below the vault
          float y = H - fall;
          float started = step(fall, max(0.0, uOn) * sp + aSeed.z * 2.0) * step(0.0, uOn);
          float sw = aKind.z;
          // a light grain drifts as it falls, swinging a little like a flake
          vec3 c = vec3(aSeed.x + sin(uTime*0.9 + sw)*0.35 + sin(fall*0.21 + sw)*0.5, y, aSeed.y + cos(uTime*0.7 + sw)*0.35);
          vec4 mv = viewMatrix * vec4(c, 1.0);
          float tw = 0.55 + 0.45 * sin(uTime * 11.0 + sw * 7.0);
          vTw = tw; vStar = aKind.w; vTone = aKind.x;
          // grain size in CSS px as on the home (0.35..1.45 x 4), barely scaled by distance;
          // the sprite is three times the grain, to hold its trail and star rays
          float sizePx = (0.35 + aSeed.w * 1.1) * 4.0 * (1.0 + tw * 0.5) * clamp(16.0 / max(1.0, -mv.z), 0.55, 1.35);
          // bright up in the air, fading to nothing as it nears the floor; no grain on the lens;
          // grains past the current count fade in or out one by one as the rally grows or eases
          vA = started * pow(smoothstep(0.1, 4.5, y), 1.3) * smoothstep(H, H - 3.0, y) * smoothstep(0.8, 3.0, -mv.z) * clamp(uShown - aIdx, 0.0, 1.0);
          gl_PointSize = vA > 0.001 ? sizePx * 3.0 * uPR : 0.0;   // nothing to fill for an unseen grain
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; uniform vec3 uTones[6];
        varying float vA; varying float vTw; varying float vStar; varying float vTone;
        void main(){
          vec2 p = gl_PointCoord - 0.5;              // the grain sits in the middle third
          int ti = int(vTone + 0.5); vec3 tone = uTones[0];
          for (int i = 1; i < 6; i++) if (i == ti) tone = uTones[i];
          float r = length(p) * 6.0;                 // 0 at the centre, 1 at the grain's edge
          // the home sprite: white core, the tone by 18 %, a third of it by 45 %, gone by the edge
          vec3 col = mix(vec3(1.0), tone, smoothstep(0.0, 0.18, r)) * (1.0 - smoothstep(0.18, 0.45, r) * 0.67) * (1.0 - smoothstep(0.45, 1.0, r));
          // its light trail, above it (gl_PointCoord y runs down)
          float trail = (1.0 - smoothstep(0.0, 0.035, abs(p.x))) * smoothstep(-0.5, -0.05, p.y) * step(p.y, 0.0) * 0.22;
          col += tone * trail;
          // a star glint when it catches the light
          float g = vStar * smoothstep(0.82, 1.0, vTw);
          float rays = (exp(-abs(p.y) * 70.0) + exp(-abs(p.x) * 70.0)) * (1.0 - smoothstep(0.0, 0.5, length(p)));
          col += mix(vec3(1.0), tone, 0.35) * rays * g * 1.2;
          float a = vA * uVis * (0.45 + vTw * 0.55) * (0.85 + uHigh*0.4 + uBeat*0.25);
          gl_FragColor = vec4(col * a * 1.1, 1.0); }`,
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
      const f = (t: number) => t * t * (3 - 2 * t), ux = f(xf), uy = f(yf), uz = f(zf);
      const L = (a: number, b: number, t: number) => a + (b - a) * t;
      return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), ux), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), ux), uy),
        L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), ux), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), ux), uy), uz);
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
          {
            vec3 w = vCaveW;
            float warp = fbm3(w * 0.045) * 7.0;
            float strata = 0.5 + 0.5 * sin(w.y * 0.85 + warp) * 0.25 * smoothstep(0.35, 0.7, fbm3(w * 0.03 + 7.0));
            float grain = fbm3(w * 0.35);
            float stain = smoothstep(0.45, 0.8, fbm3(w * 0.08 + 11.0));
            vec3 pale = vec3(0.30, 0.34, 0.40), dark = vec3(0.10, 0.12, 0.16), mineral = vec3(0.16, 0.20, 0.26);
            vec3 c = mix(dark, pale, strata * 0.35 + grain * 0.65);
            c = mix(c, mineral, stain * 0.5);
            diffuseColor.rgb = c * ${tone.toFixed(2)};
          }`)
        .replace("#include <roughnessmap_fragment>", /* glsl */`#include <roughnessmap_fragment>
          // wet seeps shine
          roughnessFactor = mix(roughnessFactor, 0.22, ${wet.toFixed(2)} * smoothstep(0.55, 0.75, n3(vCaveW * 0.12 + 3.0)));`)
        // relief: bend the normal along the gradient of a rock height field (strata ledges,
        // joints and a fine grain), so the surface reads as stone rather than facets
        .replace("#include <normal_fragment_maps>", /* glsl */`#include <normal_fragment_maps>
          {
            vec3 w = vCaveW;
            float e = 0.25;
            float fine = 0.25 * exp(-length(cameraPosition - w) / 18.0);
            float h0 = fbm3(w * 0.22) + fine * n3(w * 1.6);
            vec3 g = vec3(
              fbm3((w + vec3(e, 0.0, 0.0)) * 0.22) + fine * n3((w + vec3(e, 0.0, 0.0)) * 1.6) - h0,
              fbm3((w + vec3(0.0, e, 0.0)) * 0.22) + fine * n3((w + vec3(0.0, e, 0.0)) * 1.6) - h0,
              fbm3((w + vec3(0.0, 0.0, e)) * 0.22) + fine * n3((w + vec3(0.0, 0.0, e)) * 1.6) - h0) / e;
            vec3 gv = (viewMatrix * vec4(g, 0.0)).xyz;
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
  private hand: THREE.Sprite; private strike: THREE.Sprite;

  constructor(scene: THREE.Scene, u: U, common: string, glow: THREE.Texture) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
    const mat = (core: number) => new THREE.ShaderMaterial({
      uniforms: { ...u, uLen: this.len, uVis: this.vis, uAge: this.age }, ...additive, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vW; varying float vY; void main(){ vY = position.y; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${common} uniform float uLen, uVis, uAge; varying vec3 vN; varying vec3 vW; varying float vY;
        void main(){
          if (vY > uLen) discard;
          vec3 V = normalize(cameraPosition - vW); float face = abs(dot(normalize(vN), V));
          float L = ${CEILING.toFixed(1)};
          float h = vY * L;
          // a train of fine pulses streaming up, and a big pulse every two seconds
          float fine = pow(0.5 + 0.5*sin(h*1.4 - uTime*22.0), 6.0);
          float big = 0.0;
          for (int i = 0; i < 3; i++) { float ph = mod(uAge - float(i)*2.0, 6.0); big += exp(-pow((h - ph*26.0)*0.35, 2.0)) * step(0.0, uAge - float(i)*2.0); }
          float tipFade = smoothstep(uLen, uLen - 0.04, vY);
          float base = smoothstep(0.0, 0.01, vY);
          float k;
          vec3 col;
          if (${core.toFixed(1)} > 0.5) { k = pow(face, 3.0) * (1.2 + fine*0.8 + big*3.0); col = mix(vec3(1.0, 0.1, 0.05), vec3(1.0, 0.75, 0.6), pow(face, 8.0)) * k * 2.0; }
          else { k = pow(face, 2.0) * (0.25 + fine*0.25 + big*1.4); col = vec3(1.0, 0.06, 0.03) * k * 0.35; }
          col *= (1.0 + uBeat*0.6 + uEnergy*0.4) * tipFade * base * uVis;
          gl_FragColor = vec4(col, 1.0); }`,
    });
    const core = new THREE.Mesh(geo, mat(1)); core.scale.set(0.06, CEILING + 26, 0.06);
    const halo = new THREE.Mesh(geo, mat(0)); halo.scale.set(0.4, CEILING + 26, 0.4);
    const sprite = (c: number) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.renderOrder = 4; return s; };
    this.hand = sprite(0xff3020); this.strike = sprite(0xff2a18);
    for (const m of [core, halo]) { m.frustumCulled = false; this.group.add(m); }
    this.group.visible = false;
    scene.add(this.group, this.hand, this.strike);
  }

  /** `from`: the hand; `age`: seconds since the beam left it (<0: none); `vis` 0..1. */
  update(from: THREE.Vector3, age: number, vis: number, beat: number) {
    const on = age >= 0 && vis > 0.005;
    this.group.visible = on; this.hand.visible = on; this.strike.visible = on;
    if (!on) return;
    this.group.position.copy(from);
    // shoots up to the vault in under a second
    const grow = Math.min(1, age / 0.8), len = 1 - Math.pow(1 - grow, 3);
    this.len.value = len * (CEILING / (CEILING + 26)) + (grow >= 1 ? 26 / (CEILING + 26) : 0); this.vis.value = vis; this.age.value = age;
    const flash = Math.exp(-age * 2.5) * 3;
    this.hand.position.copy(from);
    this.hand.scale.setScalar((0.9 + flash * 0.8 + beat * 0.4 + Math.sin(age * 7) * 0.08) * vis);
    this.hand.material.opacity = Math.min(1, 0.8 + flash) * vis;
    this.strike.position.set(from.x, CEILING + 2, from.z);
    const hit = grow >= 1 ? Math.exp(-(age - 0.8) * 1.5) * 4 + 1 : 0;
    this.strike.scale.setScalar((3 + hit * 2.5 + beat * 1.5) * vis);
    this.strike.material.opacity = Math.min(1, 0.6 + hit * 0.2) * vis * (grow >= 1 ? 1 : 0);
  }
}
