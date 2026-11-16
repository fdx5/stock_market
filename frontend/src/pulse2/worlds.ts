// What surrounds the diver changes as it falls, and the hall it walks through is alive:
// hall dressing (hanging tendrils, drifting orbs, far arches, light pillars) and five
// "worlds" for the fall that crossfade every ~70 s — the ribbed ring tunnel (in
// deepDive.ts), rising streamers of light, a field of crystal shards, an open nebula, and
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
    // Slanted beams falling from openings high in the vault, dust turning in them.
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.hall }, ...additive, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${common}${noise} uniform float uVis; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        void main(){ vec3 V = normalize(cameraPosition - vW); float face = pow(abs(dot(vN, V)), 1.5);
          float x = 1.0 - abs(vUv.x*2.0 - 1.0);
          float motes = n3(vec3(vUv.x*14.0, vUv.y*30.0 - uTime*0.25, uTime*0.1));
          float k = face * (0.55 + 0.6*motes) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.75, vUv.y) * (0.07 + uEnergy*0.07) * uVis;
          gl_FragColor = vec4((uMood*0.8 + vec3(0.2))*k, 1.0); }`,
    });
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i - 2) * 0.55 + (i % 2 ? 0.12 : -0.08), R = 26 + (i % 3) * 4;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 1.0, 62, 24, 1, true), beamMat);
      // from high on the far side, leaning down toward the hall's middle
      beam.position.set(Math.cos(a + Math.PI) * R * 0.5, 22, Math.sin(a + Math.PI) * R * 0.5);
      beam.lookAt(0, -40, 0); beam.rotateX(Math.PI / 2);
      this.hall.add(beam);
    }
    scene.add(this.hall);

    // ---------------------------------------------------------------- the fall's worlds
    // 1. Streamers: ribbons of light that rush up past the diver as it falls, each one
    //    swaying, uncoiling and recoiling as it goes, light running along it with the music.
    //    Short strands recycled below, so the fall is felt as motion, never a fixed pattern.
    const vortexMat = new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.vortex }, ...additive, side: THREE.DoubleSide,
      vertexShader: /* glsl */`uniform float uTime; attribute float aK; varying vec2 vUv; varying float vK; varying float vY;
        void main(){ vUv = uv; vK = aK;
          vec3 p = position; float y = p.y;
          // coil that tightens and loosens over time, and a slow travelling sway
          float coil = (0.6 + 0.5*sin(uTime*0.23 + aK*6.0)) * 0.11;
          float ang = atan(p.z, p.x) + y*coil + uTime*(0.25 + 0.2*sin(aK*9.0));
          float r = length(p.xz) * (1.0 + 0.22*sin(y*0.09 + uTime*0.6 + aK*11.0));
          p.x = cos(ang)*r + sin(y*0.05 + uTime*0.4 + aK*5.0)*1.6; p.z = sin(ang)*r + cos(y*0.06 + uTime*0.35 + aK*7.0)*1.6;
          vec4 w = modelMatrix*vec4(p,1.0); vY = w.y - cameraPosition.y;
          gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec2 vUv; varying float vK; varying float vY;
        void main(){ float u = vUv.x;
          float ends = smoothstep(0.0, 0.25, u) * smoothstep(1.0, 0.75, u);          // strands fade at both ends
          float across = pow(1.0 - abs(vUv.y*2.0 - 1.0), 2.0);
          float run = pow(0.5+0.5*sin(u*18.0 - uTime*(2.0 + uMid*4.0) - vK*20.0), 6.0);
          float near = exp(-abs(vY)*0.05);
          float k = (0.10 + run*(0.9 + uBass*1.2 + uBeat*1.0)) * ends * across * near * uVis;
          gl_FragColor = vec4((uMood*1.4 + vec3(0.08))*k, 1.0); }`,
    });
    for (let k = 0; k < 22; k++) {
      const pts: THREE.Vector3[] = [], R = 4.5 + Math.random() * 12, ph = Math.random() * Math.PI * 2, len = 26 + Math.random() * 24, turns = 0.3 + Math.random() * 0.7;
      for (let i = 0; i <= 80; i++) { const t = i / 80, a = ph + t * turns * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * R, t * len - len / 2, Math.sin(a) * R)); }
      // a flat ribbon (a thin, wide tube reads as a soft band from every side)
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.05 + Math.random() * 0.1, 4, false);
      g.setAttribute("aK", new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(Math.random()), 1));
      const m = new THREE.Mesh(g, vortexMat); m.frustumCulled = false;
      m.userData = { base: Math.random() * 140, speed: 0.8 + Math.random() * 0.6 };
      this.vortex.add(m);
    }
    this.vortex.visible = false;
    scene.add(this.vortex);

    // 2. Pearls of light drifting past: smooth glassy spheres, a soft rim and a quiet core.
    const SN = 220, sg = new THREE.InstancedBufferGeometry().copy(new THREE.IcosahedronGeometry(1, 3) as unknown as THREE.InstancedBufferGeometry);
    const ss = new Float32Array(SN * 4), sr = new Float32Array(SN * 4);
    for (let i = 0; i < SN; i++) { const a = Math.random() * Math.PI * 2, r = 5 + Math.pow(Math.random(), 0.6) * 26; ss.set([Math.cos(a) * r, Math.random() * 120, Math.sin(a) * r, 0.12 + Math.pow(Math.random(), 2.5) * 1.6], i * 4); sr.set([Math.random() * 6.28, Math.random(), Math.random(), 0], i * 4); }
    sg.setAttribute("aSeed", new THREE.InstancedBufferAttribute(ss, 4)); sg.setAttribute("aRot", new THREE.InstancedBufferAttribute(sr, 4)); sg.instanceCount = SN;
    this.shards = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.shards, uBase: { value: 0 }, uScroll: { value: 0 } }, ...additive,
      vertexShader: /* glsl */`attribute vec4 aSeed; attribute vec4 aRot; uniform float uTime, uBase, uScroll; varying vec3 vN; varying vec3 vV; varying float vS; varying float vD;
        void main(){ vec3 c = vec3(aSeed.x + sin(uTime*0.07 + aRot.x)*1.5, uBase + mod(aSeed.y + uScroll*(0.5 + aRot.y*0.4), 120.0) - 60.0, aSeed.z + cos(uTime*0.06 + aRot.x)*1.5);
          vec4 w = modelMatrix*vec4(c + position*aSeed.w, 1.0); vN = normal; vV = normalize(cameraPosition - w.xyz); vS = aRot.z;
          vD = smoothstep(1.5, 6.0, distance(cameraPosition, c));
          gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec3 vN; varying vec3 vV; varying float vS; varying float vD;
        void main(){ float f = 1.0 - abs(dot(normalize(vN), vV)); float rim = pow(f, 3.0); float core = pow(1.0 - f, 6.0)*0.25;
          float breath = 0.75 + 0.25*sin(uTime*0.6 + vS*40.0);
          float k = (rim*0.9 + core) * breath * (0.55 + uHigh*0.8 + uBeat*0.3) * uVis * vD;
          gl_FragColor = vec4((uMood*1.2 + vec3(0.16))*k, 1.0); }`,
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

    // 4. An armillary of light: vast thin circles on different axes turning slowly round the
    // diver, and wide soft halos drifting up past it. Smooth, sparse, quiet.
    const ringMat = (bright: number) => new THREE.ShaderMaterial({
      uniforms: { ...u, uVis: this.vis.hex }, ...additive,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${common} uniform float uVis; varying vec2 vUv; void main(){ float a=vUv.x*6.2831853;
        float run = pow(0.5+0.5*sin(a*2.0 - uTime*0.45), 4.0);
        float k = (0.22 + run*0.9) * ${bright.toFixed(2)} * (0.6 + uEnergy*0.9 + uBeat*0.4) * uVis;
        gl_FragColor = vec4((uMood*1.3 + vec3(0.1))*k, 1.0); }`,
    });
    for (let i = 0; i < 6; i++) {
      const R = 13 + i * 2.6, ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.035 + i * 0.006, 8, 360), ringMat(1.0));
      ring.userData = { ax: new THREE.Vector3(Math.sin(i * 1.7), 0.6 + 0.4 * Math.cos(i), Math.cos(i * 2.3)).normalize(), sp: (i % 2 ? 1 : -1) * (0.035 + i * 0.008), tilt: 0.5 + i * 0.37 };
      this.hex.add(ring);
    }
    for (let i = 0; i < 9; i++) {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(10 + (i % 3) * 3.5, 0.05, 8, 360), ringMat(0.7));
      halo.rotation.x = Math.PI / 2; halo.userData = { halo: i };
      this.hex.add(halo);
    }
    this.hex.visible = false;
    scene.add(this.hex);
  }

  /** `hall`: 0..1 how much of the hall is in view; `w`: weights of [rings, vortex, shards, nebula, hex]. */
  update(T: number, camY: number, scroll: number, hall: number, w: number[]) {
    this.vis.hall.value = hall; this.hall.visible = hall > 0.01;
    const set = (key: string, obj: THREE.Object3D, v: number) => { this.vis[key].value = v; obj.visible = v > 0.01; };
    set("vortex", this.vortex, w[1]); set("shards", this.shards, w[2]); set("nebula", this.nebula, w[3]); set("hex", this.hex, w[4]);
    // streamers rise past the camera (faster ones nearer), recycled below
    this.vortex.children.forEach(m => { const d = m.userData as { base: number; speed: number }; m.position.y = camY - 70 + ((d.base + scroll * d.speed * 1.4) % 140); });
    for (const m of [this.shards, this.nebula]) { const s = (m.material as THREE.ShaderMaterial).uniforms; s.uBase.value = camY - 6; s.uScroll.value = scroll; }
    this.hex.position.y = camY - 4;
    this.hex.children.forEach(r => {
      const d = r.userData as { ax?: THREE.Vector3; sp?: number; tilt?: number; halo?: number };
      if (d.ax) { r.rotation.set(d.tilt!, T * d.sp!, d.tilt! * 0.6); r.rotateOnAxis(d.ax, T * d.sp! * 0.7); }
      else { const spacing = 14, L = 9 * spacing; r.position.y = -60 + ((d.halo! * spacing + scroll * 0.6) % L); }
    });
  }
}
