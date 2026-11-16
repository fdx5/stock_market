// What surrounds the diver changes as it falls, and the hall it walks through is alive:
// hall dressing (hanging tendrils, drifting orbs, far arches, light pillars) and five
// "worlds" for the fall that crossfade every ~70 s — the ribbed ring tunnel (in
// deepDive.ts), a vortex of light, a field of crystal shards, an open nebula, and
// hexagonal lattice rings. Everything is lit by the shared mood/music uniforms.
import * as THREE from "three";

type U = Record<string, { value: unknown }>;
const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;

export class Worlds {
  readonly hall = new THREE.Group();
  private vortex = new THREE.Group();
  private hex = new THREE.Group();
  private shards: THREE.Mesh;
  private nebula: THREE.Mesh;
  private vis: Record<string, { value: number }> = { hall: { value: 1 }, vortex: { value: 0 }, shards: { value: 0 }, nebula: { value: 0 }, hex: { value: 0 } };

  constructor(scene: THREE.Scene, private u: U, common: string, noise: string) {
    // ---------------------------------------------------------------- the hall
    // Tendrils hanging from the vault, a slow pulse of light running down each.
    const tendrilMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.hall }, ...additive,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec2 vUv;
        void main(){ float u=vUv.x; float run = pow(0.5+0.5*sin(u*14.0 - uTime*(1.2+uBass*2.5)), 8.0);
          float tip = smoothstep(0.75, 1.0, u)*1.5;
          float k = (0.08 + run*0.9 + tip) * (0.6 + uEnergy*1.2) * uVis;
          gl_FragColor = vec4((uMood*1.4 + vec3(0.05))*k, 1.0); }`,
    });
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 28, top = 38 + Math.random() * 8, len = 10 + Math.random() * 20;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.3 && r < 22) continue; // keep the aisle clear
      const x = Math.cos(a) * r, z = Math.sin(a) * r, sway = (Math.random() - 0.5) * 3;
      const c = new THREE.CatmullRomCurve3([new THREE.Vector3(x, top, z), new THREE.Vector3(x + sway * 0.3, top - len * 0.4, z + sway * 0.2), new THREE.Vector3(x + sway, top - len, z + sway * 0.5)]);
      this.hall.add(new THREE.Mesh(new THREE.TubeGeometry(c, 60, 0.03 + Math.random() * 0.05, 5, false), tendrilMat));
    }
    // Drifting orbs of light in the air of the hall.
    const ON = 90, og = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    const os = new Float32Array(ON * 4);
    for (let i = 0; i < ON; i++) { const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 30; os.set([Math.cos(a) * r, 2 + Math.random() * 28, Math.sin(a) * r, Math.random()], i * 4); }
    og.setAttribute("aSeed", new THREE.InstancedBufferAttribute(os, 4)); og.instanceCount = ON;
    const orbs = new THREE.Mesh(og, new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.hall }, ...additive,
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uTime; varying vec2 vUv; varying float vS;
        void main(){ vec3 c = aSeed.xyz + vec3(sin(uTime*0.11 + aSeed.w*20.0)*1.5, sin(uTime*0.17 + aSeed.w*9.0)*1.2, cos(uTime*0.13 + aSeed.w*14.0)*1.5);
          float s = 0.15 + aSeed.w*0.5; vS = aSeed.w;
          vec4 mv = viewMatrix*vec4(c,1.0); mv.xy += position.xy * s; vUv = uv; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec2 vUv; varying float vS;
        void main(){ float r = length(vUv-0.5)*2.0; float k = (smoothstep(1.0,0.0,r)*0.5 + smoothstep(0.35,0.0,r)*1.6) * (0.5 + uHigh*1.2 + 0.4*sin(uTime*1.7 + vS*30.0)) * uVis;
          gl_FragColor = vec4((uMood*1.3 + vec3(0.12))*k, 1.0); }`,
    }));
    orbs.frustumCulled = false;
    this.hall.add(orbs);
    // Far arches beyond the hall, their edges and window-slots glowing.
    const archMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.hall }, ...additive,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec2 vUv;
        void main(){ float a = vUv.x; float slots = step(0.6, fract(a*26.0)) * 0.6; float run = pow(0.5+0.5*sin(a*20.0 - uTime*0.8), 6.0);
          gl_FragColor = vec4(uMood*(0.25 + slots + run*0.8)*0.55*uVis, 1.0); }`,
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26, R = 66;
      const arch = new THREE.Mesh(new THREE.TorusGeometry(14 + (i % 3) * 3, 0.35, 8, 120, Math.PI), archMat);
      arch.position.set(Math.cos(a) * R, -2, Math.sin(a) * R); arch.lookAt(0, -2, 0);
      this.hall.add(arch);
    }
    // Tall shafts of light far round the hall.
    const pillarMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.hall }, ...additive, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${common}${noise} uniform float uVis; varying vec2 vUv;
        void main(){ float x = 1.0 - abs(vUv.x*2.0-1.0); float n = n3(vec3(vUv.x*6.0, vUv.y*3.0 - uTime*0.3, 0.0));
          float k = pow(x, 3.0) * (0.4 + n*0.8) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.6, vUv.y) * (0.18 + uEnergy*0.3) * uVis;
          gl_FragColor = vec4((uMood + vec3(0.1))*k, 1.0); }`,
    });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.6, R = 54;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 80), pillarMat);
      p.position.set(Math.cos(a) * R, 30, Math.sin(a) * R); p.lookAt(0, 30, 0);
      this.hall.add(p);
    }
    scene.add(this.hall);

    // ---------------------------------------------------------------- the fall's worlds
    // 1. A vortex: long spiralling streams of light round the fall, turning.
    const vortexMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.vortex }, ...additive,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec2 vUv;
        void main(){ float u=vUv.x; float run = dot(uW, vec4(pow(0.5+0.5*sin(u*60.0 - uTime*5.0),8.0), pow(0.5+0.5*sin(u*25.0 + uTime*3.0),10.0), pow(0.5+0.5*sin(u*8.0 - uTime*2.0),4.0), pow(0.5+0.5*sin(u*40.0 - uTime*7.0),16.0)));
          float k = (0.12 + run*1.6) * (0.5 + uEnergy*1.4 + uBeat) * uVis;
          gl_FragColor = vec4((uMood*1.5 + vec3(0.1))*k, 1.0); }`,
    });
    for (let k = 0; k < 14; k++) {
      const pts: THREE.Vector3[] = [], R = 8 + (k % 5) * 2.2, turns = 3 + (k % 3), ph = (k / 14) * Math.PI * 2;
      for (let i = 0; i <= 200; i++) { const t = i / 200, a = ph + t * turns * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * R, t * 120 - 60, Math.sin(a) * R)); }
      this.vortex.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 600, 0.06 + (k % 2) * 0.05, 5, false), vortexMat));
    }
    this.vortex.visible = false;
    scene.add(this.vortex);

    // 2. Crystal shards drifting past: glassy, edge-lit, slowly tumbling.
    const SN = 520, sg = new THREE.InstancedBufferGeometry().copy(new THREE.OctahedronGeometry(1, 0) as unknown as THREE.InstancedBufferGeometry);
    const ss = new Float32Array(SN * 4), sr = new Float32Array(SN * 4);
    for (let i = 0; i < SN; i++) { const a = Math.random() * Math.PI * 2, r = 4 + Math.pow(Math.random(), 0.7) * 24; ss.set([Math.cos(a) * r, Math.random() * 120, Math.sin(a) * r, 0.15 + Math.random() * 0.7], i * 4); sr.set([Math.random() * 6.28, Math.random() * 6.28, Math.random(), 0.4 + Math.random() * 2.5], i * 4); }
    sg.setAttribute("aSeed", new THREE.InstancedBufferAttribute(ss, 4)); sg.setAttribute("aRot", new THREE.InstancedBufferAttribute(sr, 4)); sg.instanceCount = SN;
    this.shards = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.shards, uBase: { value: 0 }, uScroll: { value: 0 } }, ...additive,
      vertexShader: /* glsl */`attribute vec4 aSeed; attribute vec4 aRot; uniform float uTime, uBase, uScroll; varying vec3 vN; varying vec3 vV; varying float vS;
        mat3 rot(vec3 a){ float cx=cos(a.x),sx=sin(a.x),cy=cos(a.y),sy=sin(a.y),cz=cos(a.z),sz=sin(a.z);
          return mat3(cy*cz, cy*sz, -sy, sx*sy*cz-cx*sz, sx*sy*sz+cx*cz, sx*cy, cx*sy*cz+sx*sz, cx*sy*sz-sx*cz, cx*cy); }
        void main(){ mat3 R = rot(vec3(aRot.x + uTime*0.3*aRot.z, aRot.y + uTime*0.2, uTime*0.1*aRot.z));
          vec3 p = R * (position * vec3(aSeed.w*0.35, aSeed.w*aRot.w, aSeed.w*0.35));
          vec3 c = vec3(aSeed.x, uBase + mod(aSeed.y + uScroll*0.8, 120.0) - 60.0, aSeed.z);
          vec4 w = modelMatrix*vec4(c + p, 1.0); vN = normalize(R*normal); vV = normalize(cameraPosition - w.xyz); vS = aSeed.w;
          gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec3 vN; varying vec3 vV; varying float vS;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0); float glint = pow(max(0.0, dot(normalize(vN), normalize(vec3(0.3,1.0,0.2)))), 24.0);
          float k = (0.06 + f*1.1 + glint*1.5) * (0.6 + uHigh*1.2 + uBeat*0.6) * uVis;
          gl_FragColor = vec4((uMood*1.3 + vec3(0.2))*k, 1.0); }`,
    }));
    this.shards.frustumCulled = false; this.shards.visible = false;
    scene.add(this.shards);

    // 3. An open nebula: vast slow clouds of coloured gas and a far field of stars.
    const NN = 40, ng = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    const ns = new Float32Array(NN * 4);
    for (let i = 0; i < NN; i++) { const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 40; ns.set([Math.cos(a) * r, Math.random() * 160, Math.sin(a) * r, Math.random()], i * 4); }
    ng.setAttribute("aSeed", new THREE.InstancedBufferAttribute(ns, 4)); ng.instanceCount = NN;
    this.nebula = new THREE.Mesh(ng, new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.nebula, uBase: { value: 0 }, uScroll: { value: 0 } }, ...additive,
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uBase, uScroll; varying vec2 vUv; varying float vS; varying float vFade;
        void main(){ vec3 c = vec3(aSeed.x, uBase + mod(aSeed.y + uScroll*0.35, 160.0) - 80.0, aSeed.z);
          vec4 mv = viewMatrix*vec4(c,1.0); float sz = 18.0 + aSeed.w*26.0; mv.xy += position.xy * sz; vUv = uv; vS = aSeed.w;
          // a cloud the camera is inside or close to fades out instead of filling the frame
          vFade = smoothstep(sz*0.4, sz*1.2, -mv.z);
          gl_Position = projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`${common}${noise} uniform float uVis; varying vec2 vUv; varying float vS; varying float vFade;
        void main(){ vec2 c = vUv-0.5; float r = length(c)*2.0;
          float n = fbm3(vec3(c*3.0 + vS*10.0, uTime*0.03 + vS));
          float k = smoothstep(1.0, 0.2, r) * smoothstep(0.35, 0.85, n) * 0.06 * (0.7 + uEnergy*0.8) * uVis * vFade;
          vec3 tint = mix(uMood, uMood.bgr*0.6 + vec3(0.05,0.0,0.08), vS*0.5);
          gl_FragColor = vec4(tint*k*2.0, 1.0); }`,
    }));
    this.nebula.frustumCulled = false; this.nebula.visible = false;
    scene.add(this.nebula);

    // 4. Hexagonal lattice rings, alternate ones counter-rotating.
    const hexMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.hex }, ...additive,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec2 vUv; void main(){ float a=vUv.x*6.2831853;
        float k = (0.5 + 0.8*pow(0.5+0.5*sin(a*6.0 - uTime*2.5), 6.0)) * (0.6 + uEnergy*1.4 + uBeat) * uVis;
        gl_FragColor = vec4((uMood*1.4 + vec3(0.1))*k, 1.0); }`,
    });
    for (let i = 0; i < 16; i++) {
      const ring = new THREE.Group();
      const R = 7 + (i % 4) * 1.6;
      const outer = new THREE.Mesh(new THREE.TorusGeometry(R, 0.09, 4, 6), hexMat); outer.rotation.x = Math.PI / 2;
      const inner = new THREE.Mesh(new THREE.TorusGeometry(R * 0.82, 0.05, 4, 6), hexMat); inner.rotation.x = Math.PI / 2; inner.rotation.z = Math.PI / 6;
      ring.add(outer, inner);
      this.hex.add(ring);
    }
    this.hex.visible = false;
    scene.add(this.hex);
  }

  /** `hall`: 0..1 how much of the hall is in view; `w`: weights of [rings, vortex, shards, nebula, hex]. */
  update(T: number, camY: number, scroll: number, hall: number, w: number[]) {
    this.vis.hall.value = hall; this.hall.visible = hall > 0.01;
    const set = (key: string, obj: THREE.Object3D, v: number) => { this.vis[key].value = v; obj.visible = v > 0.01; };
    set("vortex", this.vortex, w[1]); set("shards", this.shards, w[2]); set("nebula", this.nebula, w[3]); set("hex", this.hex, w[4]);
    this.vortex.position.y = camY - 10; this.vortex.rotation.y = -T * 0.12;
    for (const m of [this.shards, this.nebula]) { const s = (m.material as THREE.ShaderMaterial).uniforms; s.uBase.value = camY - 6; s.uScroll.value = scroll; }
    this.hex.children.forEach((r, i) => {
      const spacing = 7.5, L = this.hex.children.length * spacing;
      r.position.y = camY - 60 + ((i * spacing + scroll * 0.9) % L);
      r.rotation.y = (i % 2 ? 1 : -1) * T * 0.15 + i * 0.3;
    });
  }
}
