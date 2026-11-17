// The depths the diver falls into, and the light it sheds as it goes.
//
// AbyssSky: a sky sphere that follows the camera once it is under the floor, so no world of
// the fall is ever an empty black: deep slow nebulae in the market's colour and a quieter
// accent hue, aurora curtains, a far bright destination glow below, a faint memory of the
// opening above, and a field of stars that stretch into streaks with the speed of the fall.
//
// Embers: sparks peeling off the body — rising gently from the shoulders and hands as it
// walks, streaming away above it like a comet's tail while it falls.
import * as THREE from "three";

type U = Record<string, { value: unknown }>;

export class AbyssSky {
  readonly mesh: THREE.Mesh;
  private vis = { value: 0 };
  private speed = { value: 0 };
  private scroll = { value: 0 };

  constructor(scene: THREE.Scene, u: U, common: string, noise: string) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 64, 32), new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis, uSpeed: this.speed, uScroll: this.scroll },
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${common}${noise} uniform float uVis, uSpeed, uScroll, uDeep; varying vec3 vD;
        float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
        // a star field on a cylinder round the fall: cells, one star in some; stretched
        // vertically with the speed so the fall reads as motion
        float stars(vec3 d, float scale, float drift, float seed){
          float a = atan(d.z, d.x) / 6.2831853 + 0.5;
          vec2 p = vec2(a * scale, d.y * scale * 0.5 / max(0.25, sqrt(1.0 - d.y*d.y)) + drift);
          vec2 cell = floor(p), f = fract(p) - 0.5;
          float h = hash2(cell + seed);
          if (h < 0.72) return 0.0;
          vec2 o = (vec2(hash2(cell + 3.1 + seed), hash2(cell + 7.7 + seed)) - 0.5) * 0.6;
          vec2 q = f - o; q.y /= 1.0 + uSpeed * 2.6;
          float k = exp(-dot(q, q) * 900.0) * (h - 0.72) * 6.0;
          return k * (0.6 + 0.4*sin(uTime*(1.0 + h*3.0) + h*40.0));
        }
        void main(){
          vec3 d = normalize(vD);
          float down = max(-d.y, 0.0), up = max(d.y, 0.0);
          // how deep the fall has gone (0 at the portal .. 1 a few minutes down): the colour
          // drains, the light from above dwindles, the unknown takes over
          float deep = uDeep, lit = mix(1.0, 0.42, deep);
          // an accent hue: the mood turned a third of the way round the wheel, kept dimmer
          vec3 acc = vec3(uMood.b*0.9 + uMood.g*0.2, uMood.r*0.5 + uMood.b*0.15, uMood.g*0.4 + uMood.r*0.7) * 0.8 + vec3(0.01, 0.0, 0.02);
          // slow nebulae, drifting up with the fall
          vec3 np = d * 2.2 + vec3(0.0, uScroll * 0.0025, uTime * 0.008);
          float n1 = fbm3(np), n2 = fbm3(np * 1.9 + vec3(4.1, -uScroll*0.002, 2.3));
          float neb = smoothstep(0.42, 0.85, n1) * (0.55 + 0.45*smoothstep(0.3, 0.8, n2));
          float neb2 = smoothstep(0.5, 0.9, n2) * (1.0 - smoothstep(0.4, 0.7, n1));
          vec3 col = vec3(0.003, 0.005, 0.012) * lit;
          col += (uMood * neb * 0.16 * (0.8 + uEnergy*0.6) + acc * neb2 * 0.07) * lit;
          // aurora curtains: soft vertical folds round the fall, swaying
          float az = atan(d.z, d.x);
          float fold = sin(az * 5.0 + sin(d.y * 3.0 + uTime*0.15) * 1.6 + uTime*0.05);
          float curtain = pow(0.5 + 0.5*fold, 6.0) * smoothstep(0.75, 0.0, abs(d.y + 0.15)) * (0.4 + 0.6*n2);
          col += mix(uMood, acc, 0.35) * curtain * 0.07 * (0.7 + uMid*0.8) * lit;
          // the unknown: vast dark forms drifting up past the fall, swallowing the light
          // behind them, a thin iridescent rim where light grazes their edge
          vec3 fp = vec3(az * 1.3, d.y * 2.2 - uScroll * 0.004, uTime * 0.01);
          float form = fbm3(fp * 0.9 + vec3(9.0, 0.0, 0.0));
          float body = smoothstep(0.56, 0.62, form) * smoothstep(0.95, 0.2, abs(d.y));
          float rim = (smoothstep(0.53, 0.56, form) - smoothstep(0.56, 0.6, form)) * smoothstep(0.95, 0.2, abs(d.y));
          vec3 film = 0.5 + 0.5 * cos(6.2831853 * (form * 3.0 + d.y * 0.8 + uTime * 0.03 + vec3(0.0, 0.33, 0.67)));
          float unk = smoothstep(0.05, 0.6, deep) * 0.85 + 0.15;
          col *= 1.0 - body * 0.85 * unk;
          col += mix(uMood, film, 0.55) * rim * 0.09 * unk * (0.7 + uHigh * 0.8);
          // veils of light, very faint, slowly turning, with the colours of a soap film
          float veil = pow(1.0 - abs(sin(az * 2.0 + d.y * 3.5 + n1 * 5.0 + uTime * 0.07)), 26.0) * smoothstep(0.85, 0.1, abs(d.y - 0.1));
          col += film * veil * 0.035 * (0.4 + 0.6 * deep) * (0.6 + uMid);
          // far below, now and then, a living thing flashes: a soft bloom of light in the deep
          for (int i = 0; i < 3; i++) {
            float fi = float(i), per = 7.0 + fi * 3.7, ph = mod(uTime + fi * 4.3, per);
            float seed = floor((uTime + fi * 4.3) / per) + fi * 13.0;
            float a = hash2(vec2(seed, 1.7)) * 6.2831853, el = -0.25 - hash2(vec2(seed, 5.3)) * 0.6;
            vec3 dir = normalize(vec3(cos(a) * sqrt(1.0 - el*el), el, sin(a) * sqrt(1.0 - el*el)));
            float ang = acos(clamp(dot(d, dir), -1.0, 1.0));
            float flash = exp(-ph * 1.6) * smoothstep(0.0, 0.25, ph);
            float shape = exp(-pow(ang * 18.0, 2.0)) * 1.4 + exp(-pow((ang - ph * 0.03) * 40.0, 2.0)) * 0.6;
            col += mix(acc, film, 0.4) * shape * flash * 0.22 * (0.3 + 0.7 * deep);
          }
          // the destination: a far glow below, a hot white heart
          col += uMood * (pow(down, 4.0) * 0.16 + pow(down, 40.0) * 0.55) * (0.75 + uEnergy*0.5 + uBeat*0.3) * mix(1.0, 0.7, deep);
          col += (uMood + vec3(0.4)) * pow(down, 400.0) * 0.8;
          // the light from above, dwindling as the fall goes on: a wide pale glow that
          // shrinks to a point, the opening a fading ring
          float far = mix(1.0, 0.12, deep);
          col += (uMood*0.4 + vec3(0.1, 0.13, 0.17)) * pow(up, mix(6.0, 60.0, deep)) * 0.22 * far;
          col += (uMood*0.5 + vec3(0.12)) * exp(-pow((up - 0.985) * 90.0, 2.0)) * 0.35 * far;
          col += (stars(d, 90.0, uScroll*0.05, 0.0) + stars(d, 46.0, uScroll*0.025, 17.0) * 0.8) * (uMood * 0.8 + vec3(0.35)) * mix(1.0, 0.65, deep);
          gl_FragColor = vec4(col * uVis, 1.0);
        }`,
    }));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** `vis`: 0 in the hall, 1 once under the floor; `speed`: the fall's speed (m/s). */
  update(cam: THREE.Vector3, vis: number, speed: number, scroll: number) {
    this.vis.value = vis; this.mesh.visible = vis > 0.005;
    this.speed.value = Math.min(1.5, speed / 7);
    this.scroll.value = scroll;
    this.mesh.position.copy(cam);
  }
}

/** Marine snow: fine pale motes hanging in the dark all round the camera, rising past it as
 *  the diver sinks (faster with the fall), the nearest soft and large, the far ones pin
 *  points. What makes the sinking felt in every frame. */
export class MarineSnow {
  readonly points: THREE.Points;
  private off = { value: 0 };
  private vis = { value: 0 };
  private at = { value: new THREE.Vector3() };

  constructor(scene: THREE.Scene, u: U, common: string, count: number) {
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...u, uOff: this.off, uVisS: this.vis, uAt: this.at }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uOff, uTime, uPxScale; uniform vec3 uAt; varying float vA; varying float vS;
        void main(){
          float B = 44.0;
          // a box round the camera, wrapped, rising (the diver sinks)
          vec3 p = (aSeed.xyz - 0.5) * B;
          p.y = mod(p.y + uOff * (0.7 + aSeed.w * 0.6) + B * 0.5, B) - B * 0.5;
          p.x += sin(uTime * 0.13 + aSeed.w * 30.0) * 0.6; p.z += cos(uTime * 0.11 + aSeed.w * 20.0) * 0.6;
          vec3 w = uAt + p;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          float dist = -mv.z;
          vS = aSeed.w;
          vA = smoothstep(0.6, 2.5, dist) * (1.0 - smoothstep(14.0, 22.0, length(p))) * (0.35 + aSeed.w * 0.65);
          gl_PointSize = vA > 0.001 ? (0.6 + aSeed.w * 1.6) * 26.0 * uPxScale / max(1.0, dist) + 1.0 : 0.0;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`${common} uniform float uVisS; varying float vA; varying float vS;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float k = exp(-r * r * 4.0) * vA * uVisS * 0.55;
          vec3 c = mix(vec3(0.62, 0.74, 0.86), uMood * 1.2 + vec3(0.15), 0.35 + vS * 0.3);
          gl_FragColor = vec4(c * k, 1.0); }`,
    }));
    this.points.frustumCulled = false; this.points.visible = false;
    scene.add(this.points);
  }

  /** `speed`: the fall's speed (m/s); `vis` 0..1. */
  update(cam: THREE.Vector3, speed: number, vis: number, dt: number) {
    this.off.value += (0.35 + speed * 0.9) * dt; this.vis.value = vis; this.at.value.copy(cam);
    this.points.visible = vis > 0.01;
  }
}

export class Embers {
  readonly points: THREE.Points;
  private N: number;
  private pos: Float32Array; private vel: Float32Array; private life: Float32Array; private age: Float32Array;
  private head = 0; private carry = 0;
  private _v = new THREE.Vector3();

  constructor(scene: THREE.Scene, u: U, common: string, count: number) {
    this.N = count;
    this.pos = new Float32Array(count * 3); this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count).fill(1); this.age = new Float32Array(count).fill(9);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAge", new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSeed", new THREE.BufferAttribute(Float32Array.from({ length: count }, () => Math.random()), 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: /* glsl */`attribute float aAge; attribute float aSeed; uniform float uPxScale; varying float vA; varying float vS;
        void main(){ vec4 mv = viewMatrix*vec4(position,1.0);
          float life = clamp(aAge, 0.0, 1.0);
          vA = smoothstep(0.0, 0.08, life) * (1.0 - life) * (1.0 - life); vS = aSeed;
          gl_PointSize = (0.5 + aSeed*1.1) * (1.0 - life*0.6) * 20.0 * uPxScale / max(0.4, -mv.z);
          gl_Position = projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`${common} varying float vA; varying float vS;
        void main(){ float r = length(gl_PointCoord - 0.5); float k = (smoothstep(0.5, 0.0, r)*0.35 + smoothstep(0.16, 0.0, r)*1.3) * vA * (0.45 + uHigh*0.8 + uBeat*0.4);
          gl_FragColor = vec4(mix(uFigMood*1.7, vec3(1.0, 0.95, 0.9), 0.15 + 0.25*vS) * k, 1.0); }`,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** Emit `rate` sparks a second from the given bones; `rise`: how fast they stream up (m/s). */
  update(dt: number, sources: THREE.Object3D[], rate: number, rise: number, spread: number) {
    const N = this.N;
    if (sources.length) {
      this.carry += rate * dt;
      while (this.carry >= 1) {
        this.carry -= 1;
        const i = this.head++ % N, b = sources[(Math.random() * sources.length) | 0];
        b.getWorldPosition(this._v);
        this.pos[i * 3] = this._v.x + (Math.random() - 0.5) * 0.12; this.pos[i * 3 + 1] = this._v.y + (Math.random() - 0.5) * 0.12; this.pos[i * 3 + 2] = this._v.z + (Math.random() - 0.5) * 0.12;
        this.vel[i * 3] = (Math.random() - 0.5) * spread; this.vel[i * 3 + 1] = rise * (0.35 + Math.random() * 0.75); this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
        this.age[i] = 0; this.life[i] = 1.1 + Math.random() * 1.4;
      }
    } else this.carry = 0;
    const ages = (this.points.geometry.attributes.aAge as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < N; i++) {
      if (this.age[i] > this.life[i]) { ages[i] = 1; continue; }
      this.age[i] += dt;
      // a little curl so the tail eddies rather than runs in straight lines
      const k = i * 3, s = Math.sin(this.age[i] * 2.3 + i), c = Math.cos(this.age[i] * 1.9 + i * 0.7);
      this.vel[k] += s * 0.6 * dt; this.vel[k + 2] += c * 0.6 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      ages[i] = this.age[i] / this.life[i];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAge.needsUpdate = true;
  }
}
