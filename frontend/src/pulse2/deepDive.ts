// 증시 전광판2 — "Deep Dive": an original Anyma-inspired real-time background.
// A translucent energy humanoid crosses a biomechanical chamber of chrome ribs on a wet,
// mirror-like floor, stops at a glowing circular portal, dives in head first and falls
// through an endless tunnel of luminous rings; a flare carries the fall back to the walk,
// so the 90-second take loops without a cut.
//
// Everything that glows takes one colour, the market's mood (see mood.ts), eased so a
// change of stock or index bleeds smoothly through the scene. The music's equaliser
// (see audioLevels.ts) drives the pulses: their flow speed, brightness and the beat flashes.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { AudioLevels } from "./audioLevels";
import { moodColor, moodStrength } from "./mood";
import { PoseRig, loadMocap, sample, blend, type Clip, type Pose, type RootMotion } from "./pose";
import { Worlds } from "./worlds";

const LOOP = 600;           // seconds in one take: ten minutes, mostly the fall
const PORTAL_R = 4.2;
const smooth = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const lerp = THREE.MathUtils.lerp;

// ------------------------------------------------------------------ shared GLSL
const NOISE = /* glsl */`
float h31(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*n3(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
`;
const COMMON = /* glsl */`
uniform float uTime, uEnergy, uBass, uMid, uHigh, uBeat, uFlare, uStrength;
uniform vec4 uW; // weights of the four pulse patterns, crossfading in turn
uniform vec3 uMood, uFog;
uniform vec3 uFocus; // the figure: light gathers round it, the rest falls back into shadow
`;

type U = { value: unknown };

export class DeepDive {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 600);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private audio = new AudioLevels();
  private u: Record<string, U> = {
    uTime: { value: 0 }, uEnergy: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uBeat: { value: 0 },
    uFlare: { value: 0 }, uStrength: { value: 0 }, uW: { value: new THREE.Vector4(1, 0, 0, 0) }, uSteps: { value: [new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0)] }, uFocus: { value: new THREE.Vector3(0, 1, 13) }, uMood: { value: new THREE.Color(0x3a8bff) }, uFog: { value: new THREE.Color(0x02040a) },
  };
  private moodTarget = new THREE.Color(0x3a8bff);
  private strengthTarget = 0;
  private figure = new THREE.Group();
  private body?: THREE.Object3D;
  private rig?: PoseRig;
  private walk?: Clip; private idle?: Clip;
  private chamber = new THREE.Group();
  private tunnel = new THREE.Group();
  private tunnelSegs: THREE.Object3D[] = [];
  private abyss?: THREE.Mesh;
  private rain!: THREE.Mesh; private dust!: THREE.Points; private sparks!: THREE.Points;
  private ribbons = new THREE.Group();
  private worlds!: Worlds;
  private floor?: Reflector;
  private raf = 0; private last = 0; private t0 = performance.now();
  private disposed = false;
  private scroll = 0;     // rain/dust scroll (m)
  private tunnelScroll = 0;
  private resizeObs: ResizeObserver;
  private visible = true;

  constructor(private canvas: HTMLCanvasElement, private quality: "high" | "medium" = "high") {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "high" ? 1.5 : 1));
    // (Neutral keeps a saturated blue blue; ACES turns it violet)
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x01030a);
    this.scene.fog = new THREE.FogExp2(0x02050d, 0.011);

    this.environment();
    this.buildFloor();
    this.buildPortal();
    this.buildChamber();
    this.buildShaft();
    this.buildTunnel();
    this.buildRain();
    this.worlds = new Worlds(this.scene, this.u, COMMON, NOISE);
    this.buildMist();
    this.loadFigure();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // (any NaN or infinite pixel would be smeared across the whole frame by the bloom: scrub
    // them, and cap the HDR so a hot spot cannot flood the glow)
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv);
        if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b) || c.r > 1e4 || c.g > 1e4 || c.b > 1e4) c = vec4(0.0);
        gl_FragColor = vec4(min(c.rgb, vec3(24.0)), 1.0); }`,
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.95, 0.5, 0.55);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uFlare: this.u.uFlare, uMood: this.u.uMood, uTime: this.u.uTime, uRes: { value: new THREE.Vector2(1, 1) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uFlare, uTime; uniform vec3 uMood; uniform vec2 uRes; varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5; float r = length(c);
          // a whisper of chromatic aberration toward the edges
          vec2 off = c * r * 0.006;
          vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
          // vignette round the subject (sat low in the frame), deep at the edges
          float rs = length((vUv - vec2(0.5, 0.4)) * vec2(1.0, 1.15));
          col *= mix(1.0, 0.18, smoothstep(0.2, 0.85, rs));
          // contrast: mid-tones settle, highlights keep their punch
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col *= mix(0.62, 1.0, smoothstep(0.05, 0.9, lum));
          col = mix(col, vec3(1.0) * 0.6 + uMood * 0.8, clamp(uFlare, 0.0, 1.0)); // the loop's flare
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    document.addEventListener("visibilitychange", this.onVis);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The colour of the market: the index change on arrival, a chosen stock's afterwards. */
  setMood(changePct: number | null | undefined) {
    moodColor(changePct, this.moodTarget);
    // (working in linear light: the stops are authored in sRGB)
    this.moodTarget.convertSRGBToLinear();
    // Equal brightness whatever the hue: yellow and orange carry far more luminance than
    // blue, and would wash the hall white through the bloom.
    const c = this.moodTarget, lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    c.multiplyScalar(Math.min(1.1, 0.3 / Math.max(0.05, lum)));
    this.strengthTarget = moodStrength(changePct);
  }

  /** Jump the take to `t` seconds (checks and screenshots). */
  seek(t: number) { this.t0 = performance.now() - t * 1000; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVis);
    this.resizeObs.disconnect();
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose(); });
    this.floor?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  private feet: { name: string; down: boolean }[] = [{ name: "foot_l", down: true }, { name: "foot_r", down: true }];
  private stepIdx = 0;
  private liveMix = 0;
  private avg = { all: 0.4, bass: 0.4, mid: 0.4, high: 0.3 };
  private _fv = new THREE.Vector3();
  private footsteps(T: number, fig: THREE.Object3D) {
    if (!this.rig) return;
    fig.updateMatrixWorld(true);
    for (const f of this.feet) {
      const bone = this.rig.bones.get(f.name); if (!bone) continue;
      const p = bone.getWorldPosition(this._fv), h = p.y - fig.position.y;
      // (the ankle sits ~9 cm above the sole: below 13 cm the foot is on the floor)
      const down = h < 0.13;
      if (down && !f.down) {
        const steps = this.u.uSteps.value as THREE.Vector4[];
        steps[this.stepIdx++ % 4].set(p.x, p.z, T, 0.6 + (this.u.uBass.value as number) * 0.8 + (this.u.uBeat.value as number) * 0.6);
      }
      f.down = down;
    }
  }

  private onVis = () => { this.visible = !document.hidden; if (this.visible) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); } };

  private resize() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    // The subject sits low in the frame (~60 % down), clear of the board above it.
    this.camera.setViewOffset(w, h, 0, -h * 0.12, w, h);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ build
  /** A dark, cool studio for the chrome to reflect: a blue band and a bright overhead disc. */
  private environment() {
    const env = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vD; void main(){ float y=vD.y;
        vec3 c = vec3(0.004,0.008,0.02);
        c += vec3(0.10,0.35,0.9) * exp(-abs(y-0.08)*9.0) * 0.9;     // horizon band
        c += vec3(0.6,0.85,1.0) * pow(max(y,0.0), 18.0) * 6.0;     // overhead light
        c += vec3(0.05,0.2,0.6) * pow(max(-y,0.0), 3.0) * 0.6;     // glow from the pit
        float az = atan(vD.z, vD.x);
        c += vec3(0.35,0.7,1.0) * pow(max(0.0, sin(az*9.0)), 40.0) * smoothstep(-0.1, 0.5, y) * 2.5; // tall light strips for the chrome to catch
        gl_FragColor = vec4(c,1.0); }`,
    }));
    env.add(sky);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(env, 0.02).texture;
    pm.dispose();
  }

  private buildFloor() {
    const geo = new THREE.PlaneGeometry(260, 260);
    const shader = {
      uniforms: { color: { value: new THREE.Color(0x7f7f7f) }, tDiffuse: { value: null }, textureMatrix: { value: null }, ...this.u, uPortalR: { value: PORTAL_R } },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
        void main(){ vUv = textureMatrix * vec4(position,1.0); vec4 w = modelMatrix*vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uPortalR; uniform vec4 uSteps[4]; varying vec4 vUv; varying vec3 vWorld;
        ${COMMON}${NOISE}
        void main(){
          float r = length(vWorld.xz);
          if (r < uPortalR - 0.05) discard;
          float a = atan(vWorld.z, vWorld.x);
          // wet stone: broad ripples bend the reflection a little
          vec2 nn = vec2(n3(vec3(vWorld.xz*0.9, uTime*0.05)), n3(vec3(vWorld.xz*0.9+7.0, uTime*0.05))) - 0.5;
          vec4 uv = vUv; uv.xy += nn * 0.035 * uv.w;
          vec3 refl = texture2DProj(tDiffuse, uv).rgb;
          // inlaid rings and radial seams around the portal
          float dr = abs(fract(r/2.4 + 0.5) - 0.5) * 2.4;
          float rings = (1.0 - smoothstep(0.015, 0.06, dr)) * smoothstep(40.0, 6.0, r);
          float seg = 6.2831853 / 32.0, da = abs(fract(a/seg + 0.5) - 0.5) * seg * r;
          float seams = (1.0 - smoothstep(0.01, 0.05, da)) * smoothstep(34.0, 8.0, r) * step(uPortalR + 0.6, r);
          // pulses running outward from the portal, faster and brighter with the bass
          // four pulse patterns, crossfaded in turn: rings outward, a spiral, a radar sweep, a heartbeat
          float sp = uTime*(0.9 + uBass*1.6);
          float pRings = pow(0.5 + 0.5*sin(r*0.75 - sp), 10.0);
          float pSpiral = pow(0.5 + 0.5*sin(r*0.55 + a*3.0 - sp), 10.0);
          float sweepA = mod(a - uTime*0.7, 6.2831853);
          float pSweep = exp(-sweepA*2.2) * 2.0 * smoothstep(34.0, 6.0, r);
          float hb = fract(uTime*0.85); float beat2 = exp(-pow(hb*9.0, 2.0)) + 0.65*exp(-pow((hb-0.2)*9.0, 2.0));
          float pHeart = beat2 * exp(-(r - uPortalR)*0.08) * (0.6 + 0.4*pow(0.5+0.5*sin(r*1.4 - uTime*6.0), 4.0));
          float wave = dot(uW, vec4(pRings, pSpiral, pSweep, pHeart)) * (0.25 + uBass*1.8 + uBeat*1.2);
          float near = exp(-(r - uPortalR) * 0.45);
          vec3 base = vec3(0.004, 0.007, 0.012) * (0.6 + 0.8*n3(vec3(vWorld.xz*0.35, 1.0)));
          float focus = 0.15 + 0.85*exp(-length(vWorld.xz - uFocus.xz) / 9.0);
          vec3 glow = uMood * ((rings*0.55 + seams*0.35) * (0.05 + wave) * (0.4 + 0.6*near) * focus + near * (0.7 + uEnergy*1.4 + uBeat));
          // footfalls: where a sole lands, a flash, an electric ring running out and crackling
          // filaments along the floor's seams, fading in about two seconds
          for (int i = 0; i < 4; i++) {
            vec4 st = uSteps[i]; float age = uTime - st.z;
            if (age < 0.0 || age > 2.2) continue;
            float d = length(vWorld.xz - st.xy), life = 1.0 - age/2.2;
            float ring = exp(-pow((d - age*1.8)*7.0, 2.0)) * life * life;
            float core = exp(-d*5.0) * exp(-age*3.5) * 2.4;
            float arc = pow(n3(vec3(vWorld.xz*7.0, uTime*14.0 + float(i)*3.0)), 7.0) * 9.0 * exp(-d*1.4) * exp(-age*2.2);
            float lines = (rings + seams) * exp(-d*0.6) * exp(-age*1.6) * 1.6;
            glow += (uMood*1.3 + vec3(0.15)) * (ring*1.4 + core + arc + lines) * st.w;
          }
          float fres = 0.55;
          vec3 col = base + refl * fres + glow;
          float d = length(cameraPosition - vWorld);
          col = mix(col, uFog, 1.0 - exp(-d*0.018));
          gl_FragColor = vec4(col, 1.0);
        }`,
    };
    const floor = new Reflector(geo, { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, shader });
    floor.rotation.x = -Math.PI / 2;
    const m = floor.material as THREE.ShaderMaterial;
    for (const k of Object.keys(this.u)) m.uniforms[k] = this.u[k];
    this.floor = floor;
    this.scene.add(floor);
  }

  private buildPortal() {
    const ringMat = (_width: number, power: number) => new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${COMMON} varying vec2 vUv;
        void main(){ float a = vUv.x * 6.2831853;
          float flow = 0.65 + 0.35*sin(a*6.0 - uTime*(1.5+uMid*3.0)) * sin(a*2.0 + uTime*0.7);
          float k = (${power.toFixed(1)}) * flow * (1.0 + uEnergy*1.8 + uBeat*1.5 + uStrength*0.8);
          gl_FragColor = vec4(uMood * k + vec3(k*0.08), 1.0); }`,
    });
    void ringMat;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_R, 0.07, 16, 256), ringMat(0.07, 3.2));
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.03;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_R + 0.55, 0.03, 12, 256), ringMat(0.03, 1.2));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.02;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_R - 0.05, 0.22, 24, 192), new THREE.MeshStandardMaterial({ color: 0x0b0e15, metalness: 1, roughness: 0.18 }));
    lip.rotation.x = -Math.PI / 2; lip.position.y = -0.12;
    this.scene.add(rim, halo, lip);
    // The abyss under it: a shaft wall of glowing bands drifting down into a bright core.
    const abyss = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_R - 0.1, PORTAL_R - 0.6, 70, 128, 1, true), new THREE.ShaderMaterial({
      uniforms: { ...this.u }, side: THREE.BackSide, transparent: true,
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${COMMON}${NOISE} varying vec2 vUv; varying vec3 vW;
        void main(){ float depth = -vW.y; float a = vUv.x*6.2831853;
          float bands = pow(0.5+0.5*sin(depth*1.3 + uTime*(3.0+uBass*4.0)), 18.0);
          float streak = pow(n3(vec3(a*7.0, depth*0.08 + uTime*0.6, 0.0)), 6.0) * 2.0;
          float fade = smoothstep(0.0, 6.0, depth) * exp(-depth*0.015);
          vec3 col = uMood * (bands*1.4 + streak*0.8) * (0.5+uEnergy*1.5) * fade + uMood * smoothstep(40.0, 68.0, depth) * 3.0;
          gl_FragColor = vec4(col + vec3(0.002,0.004,0.01), 1.0); }`,
    }));
    abyss.position.y = -35;
    this.abyss = abyss;
    const core = new THREE.Mesh(new THREE.CircleGeometry(PORTAL_R, 64), new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${COMMON}${NOISE} varying vec2 vUv; void main(){ vec2 c=vUv-0.5; float r=length(c)*2.0; float a=atan(c.y,c.x);
        float swirl = n3(vec3(a*3.0 + r*6.0 - uTime*1.2, r*4.0, uTime*0.2));
        float k = exp(-r*3.0)*3.0 + swirl*0.6*exp(-r*1.5);
        gl_FragColor = vec4(uMood*k*(0.8+uEnergy*1.5) + vec3(k*0.15), 1.0); }`,
    }));
    // (a child of the abyss, so it goes when the abyss does: the fall passes its depth
    // later, and flying through it whited out the frame)
    core.rotation.x = -Math.PI / 2; core.position.y = -69 - abyss.position.y;
    abyss.add(core);
    this.scene.add(abyss);
  }

  /** A tapered tube along a curve (radius r0 → r1), uv.x along, uv.y around. */
  private tube(curve: THREE.Curve<THREE.Vector3>, seg: number, rad: number, r0: number, r1: number) {
    const frames = curve.computeFrenetFrames(seg, false), pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, p = curve.getPointAt(u), r = lerp(r0, r1, Math.pow(u, 0.8)) * (1 + 0.12 * Math.sin(u * 40));
      for (let j = 0; j <= rad; j++) {
        const v = (j / rad) * Math.PI * 2, n = frames.normals[i].clone().multiplyScalar(Math.cos(v)).addScaledVector(frames.binormals[i], Math.sin(v));
        pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r); uv.push(u, j / rad);
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  /** Chrome biomechanical ribs with glowing slots; a light pulse runs along each. */
  private ribMaterial(phase: number, slots = 22) {
    const m = new THREE.MeshStandardMaterial({ color: 0x141a24, metalness: 1, roughness: 0.12, envMapIntensity: 3.2 });
    const u = this.u;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u, { uPhase: { value: phase } });
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vRib; varying vec3 vRibW;").replace("#include <uv_vertex>", "#include <uv_vertex>\nvRib = uv;").replace("#include <project_vertex>", "#include <project_vertex>\nvRibW = (modelMatrix*vec4(transformed,1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec2 vRib; varying vec3 vRibW; uniform float uPhase;\n${COMMON}`)
        .replace("#include <emissivemap_fragment>", /* glsl */`#include <emissivemap_fragment>
          {
            float u = vRib.x, v = vRib.y;
            // elongated slots on one face of the rib, like lit gills
            // lit oval cells set into the inner face, irregular like living tissue
            float side = smoothstep(0.78, 0.96, 0.5 + 0.5*sin(v*6.2831853));
            float cu = u*${slots.toFixed(1)}, ci = floor(cu), cell = fract(cu);
            float on = step(0.66, fract(sin(ci*12.9898 + uPhase*3.1)*43758.5453));
            float slot = side * on * smoothstep(0.5, 0.15, length(vec2(cell - 0.5, (v - 0.25) * 4.0) * vec2(1.0, 1.0)) - 0.0);
            float sp = uTime*(1.2 + uBass*2.5);
            float pUp = pow(0.5 + 0.5*sin(u*28.0 - sp + uPhase), 10.0);
            float pDown = pow(0.5 + 0.5*sin(u*20.0 + sp*0.8 + uPhase), 12.0);
            float hb = fract(uTime*0.85 + uPhase*0.05); float pHeart = (exp(-pow(hb*9.0,2.0)) + 0.65*exp(-pow((hb-0.2)*9.0,2.0))) * 0.9;
            float pSpark = pow(0.5 + 0.5*sin(u*9.0 + uPhase*2.0 + uTime*0.35), 12.0) * pow(0.5 + 0.5*sin(uTime*0.5 + uPhase), 2.0) * 1.6;
            float pulse = dot(uW, vec4(pUp, pDown, pHeart, pSpark));
            float edge = pow(1.0 - abs(v*2.0 - 1.0), 1.0) * 0.0;
            // a thin glowing seam along the rib, brighter where the pulse passes
            float seam = (1.0 - smoothstep(0.0, 0.035, abs(v - 0.25))) * (0.25 + pulse*2.5);
            // lit cells mostly dark until a pulse passes; all of it brightest near the figure
            float focus = 0.1 + 0.9*exp(-length(vRibW - uFocus) / 11.0);
            totalEmissiveRadiance += uMood * (slot * (0.25 + uEnergy*1.2 + uBeat*0.9) * (0.25 + pulse*2.2) + seam*(0.15 + uEnergy*0.6)*(0.3 + pulse) + edge) * focus;
          }`);
    };
    return m;
  }

  private buildChamber() {
    // Ribs all round the hall but the aisle the figure walks in (from +z), which the
    // camera follows: never a rib between the camera and the walk.
    const N = 16;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + 0.11, tw = 0.35;
      const aisle = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
      if (aisle < 0.42) continue;
      const at = (r: number, y: number, s: number) => new THREE.Vector3(Math.cos(a + s * tw) * r, y, Math.sin(a + s * tw) * r);
      const curve = new THREE.CatmullRomCurve3([at(23, -2, 0), at(22.5, 7, 0.12), at(20, 17, 0.32), at(15, 26, 0.55), at(9, 32, 0.8), at(5.4, 36, 1)], false, "centripetal");
      const main = new THREE.Mesh(this.tube(curve, 180, 20, 1.9, 0.5), this.ribMaterial(k * 1.3));
      this.chamber.add(main);
      // two branches peeling off each rib, like roots
      for (const s of [-1, 1]) {
        const b = new THREE.CatmullRomCurve3([at(22, 3, 0.1), at(20 + s * 1.5, 10, 0.1 + s * 0.35), at(17, 15, s * 0.55), at(13.5, 17, s * 0.75)], false, "centripetal");
        this.chamber.add(new THREE.Mesh(this.tube(b, 90, 14, 0.75, 0.2), this.ribMaterial(k * 1.3 + s, 12)));
      }
    }
    // a far wall of arches, each with a lit oval pod, ringing the hall
    const podMat = new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${COMMON} varying vec2 vUv; void main(){ vec2 c=(vUv-0.5)*vec2(2.0,1.0); float r=length(c); float k=smoothstep(0.5,0.0,r)*1.6 + smoothstep(0.52,0.46,r)*0.6;
        gl_FragColor = vec4(uMood*k*(0.14+uEnergy*0.5), 1.0); }`,
    });
    const M = 64, pods = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 4.4), podMat, M * 2);
    const tmp = new THREE.Object3D();
    for (let i = 0; i < M * 2; i++) {
      const row = i < M ? 0 : 1, a = ((i % M) / M) * Math.PI * 2, r = 44 + row * 2;
      tmp.position.set(Math.cos(a) * r, 3 + row * 9, Math.sin(a) * r); tmp.lookAt(0, tmp.position.y, 0); tmp.scale.setScalar(1 - row * 0.25); tmp.updateMatrix();
      pods.setMatrixAt(i, tmp.matrix);
    }
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(46, 46, 60, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.9, roughness: 0.35, side: THREE.BackSide }));
    wall.position.y = 26;
    this.chamber.add(pods, wall);
    this.scene.add(this.chamber);
  }

  /** The light falling through the ceiling's opening onto the portal. */
  private buildShaft() {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.2, PORTAL_R, 52, 64, 1, true), new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vW; varying float vY; void main(){ vN = normalize(normalMatrix*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vY=position.y; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${COMMON}${NOISE} varying vec3 vN; varying vec3 vW; varying float vY;
        void main(){ vec3 V = normalize(cameraPosition - vW); float face = pow(abs(dot(normalize(vN), V)), 2.0);
          float a = atan(vW.z, vW.x);
          float streak = 0.35 + pow(n3(vec3(a*9.0, vW.y*0.05 + uTime*0.35, 0.0)), 3.0) * 1.6;
          float fade = smoothstep(-26.0, -18.0, vY) * smoothstep(26.0, 14.0, vY);
          float k = face * streak * fade * (0.28 + uEnergy*0.45 + uBeat*0.25);
          gl_FragColor = vec4((uMood*0.8 + vec3(0.25)) * k, 1.0); }`,
    }));
    shaft.position.y = 26;
    const top = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.12, 12, 160), new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `${COMMON} void main(){ gl_FragColor = vec4(uMood*(2.2+uEnergy*2.0)+vec3(0.3), 1.0); }`,
    }));
    top.rotation.x = Math.PI / 2; top.position.y = 50;
    this.scene.add(shaft, top);
  }

  /** The endless fall: ring segments recycled below the diver. */
  private buildTunnel() {
    const ringMat = this.ribMaterial(0, 40);
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`${COMMON} varying vec2 vUv; void main(){ float a=vUv.x*6.2831853; float hb=fract(uTime*0.85); float k = dot(uW, vec4(0.8+0.6*sin(a*6.0 - uTime*1.2), 0.5+1.0*pow(0.5+0.5*sin(a*3.0 + uTime*2.0),6.0), 0.6+1.2*pow(max(0.0,cos(a - uTime*1.5)),12.0), 0.5+1.4*(exp(-pow(hb*9.0,2.0))+0.65*exp(-pow((hb-0.2)*9.0,2.0)))))*(1.0+uEnergy*2.0+uBeat*1.5);
        gl_FragColor = vec4(uMood*k*k*0.55, 1.0); }`,
    });
    for (let i = 0; i < 14; i++) {
      const seg = new THREE.Group();
      const R = 9 + (i % 3) * 1.5;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.55, 20, 160), ringMat);
      ring.rotation.x = Math.PI / 2;
      const line = new THREE.Mesh(new THREE.TorusGeometry(R - 0.5, 0.05, 8, 200), glowMat);
      line.rotation.x = Math.PI / 2;
      seg.add(ring, line);
      // curved ribs between this ring and the next, sweeping in a spiral
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + i * 0.3;
        const at = (r: number, y: number, s: number) => new THREE.Vector3(Math.cos(a + s) * r, y, Math.sin(a + s) * r);
        const c = new THREE.CatmullRomCurve3([at(R, 0, 0), at(R + 2.2, -2.2, 0.18), at(R + 1.4, -4.6, 0.38), at(R, -6, 0.5)]);
        seg.add(new THREE.Mesh(this.tube(c, 40, 10, 0.32, 0.22), ringMat));
      }
      seg.visible = false;
      this.tunnel.add(seg);
      this.tunnelSegs.push(seg);
    }
    this.scene.add(this.tunnel);
  }

  /** Falling streaks of light (down in the hall, rushing up past the diver) and drifting dust. */
  private buildRain() {
    const N = this.quality === "high" ? 2600 : 1400;
    const g = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(0.035, 2.2) as unknown as THREE.InstancedBufferGeometry);
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, r = 2 + Math.sqrt(Math.random()) * 30; seed.set([Math.cos(a) * r, Math.sin(a) * r, Math.random() * 90, 0.6 + Math.random() * 0.8], i * 4); }
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = N;
    const u = { ...this.u, uBase: { value: 0 }, uScroll: { value: 0 } };
    this.rain = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uBase, uScroll; uniform vec3 uFocus; varying vec2 vUv; varying float vA;
        void main(){ float y = uBase + mod(aSeed.z - uScroll*aSeed.w, 90.0) - 45.0;
          vec3 c = vec3(aSeed.x, y, aSeed.y);
          vec3 toCam = cameraPosition - c; toCam.y = 0.0; toCam = normalize(toCam);
          vec3 right = normalize(cross(vec3(0.0,1.0,0.0), toCam));
          vec3 p = c + right*position.x + vec3(0.0,1.0,0.0)*position.y;
          vUv = uv; vA = smoothstep(45.0, 30.0, abs(y - uBase)) * (0.5 + 0.5*aSeed.w) * (0.2 + 0.8*exp(-length(c - uFocus) / 10.0));
          gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0); }`,
      fragmentShader: /* glsl */`${COMMON} varying vec2 vUv; varying float vA;
        void main(){ float x = 1.0 - abs(vUv.x*2.0-1.0); float k = x*x * pow(vUv.y, 1.5) * vA * (0.35 + uHigh*1.3 + uBeat*0.5);
          gl_FragColor = vec4((uMood*1.6 + vec3(0.15))*k, 1.0); }`,
    }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    const D = 2500, dp = new Float32Array(D * 4);
    for (let i = 0; i < D; i++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 34; dp.set([Math.cos(a) * r, Math.random() * 90, Math.sin(a) * r, Math.random()], i * 4); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(D * 3), 3)); dg.setAttribute("aSeed", new THREE.BufferAttribute(dp, 4));
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      uniforms: u, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uBase, uScroll, uTime; varying float vA;
        void main(){ float y = uBase + mod(aSeed.y - uScroll*0.25*(0.3+aSeed.w), 90.0) - 45.0;
          vec3 p = vec3(aSeed.x + sin(uTime*0.2 + aSeed.w*30.0)*0.6, y, aSeed.z + cos(uTime*0.17 + aSeed.w*20.0)*0.6);
          vec4 mv = viewMatrix*vec4(p,1.0); gl_PointSize = (0.8 + aSeed.w*2.2) * 45.0 / max(1.0,-mv.z); vA = smoothstep(45.0, 25.0, abs(y-uBase)) * (0.4+aSeed.w);
          gl_Position = projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`${COMMON} varying float vA; void main(){ float r=length(gl_PointCoord-0.5); float k=smoothstep(0.5,0.0,r)*vA*(0.5+uMid*1.4);
        gl_FragColor = vec4((uMood*1.4+vec3(0.1))*k, 1.0); }`,
    }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  /** Luminous ribbons spiralling round the diver; light runs along them with the music. */
  private buildRibbons() {
    for (let k = 0; k < 4; k++) {
      const pts: THREE.Vector3[] = [], turns = 1.4 + k * 0.3, r0 = 0.9 + k * 0.35, h = 3.2 + k * 0.6, ph = k * 1.6;
      for (let i = 0; i <= 120; i++) { const t = i / 120, a = ph + t * turns * Math.PI * 2, r = r0 * (0.8 + 0.4 * Math.sin(t * 3 + k)); pts.push(new THREE.Vector3(Math.cos(a) * r, t * h - 0.3, Math.sin(a) * r)); }
      const curve = new THREE.CatmullRomCurve3(pts);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 300, 0.006 + (k % 2) * 0.004, 6, false), new THREE.ShaderMaterial({
        uniforms: { ...this.u, uK: { value: k } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */`${COMMON} uniform float uK; varying vec2 vUv;
          void main(){ float u=vUv.x; float sp = uTime*(3.0+uMid*6.0);
            float run = dot(uW, vec4(pow(0.5+0.5*sin(u*46.0 - sp - uK*2.0), 8.0), pow(0.5+0.5*sin(u*30.0 + sp*0.7 - uK), 10.0),
              pow(0.5+0.5*sin(u*6.0 - sp*0.4 - uK), 6.0), (exp(-pow(fract(uTime*0.85)*9.0,2.0)) + 0.6*exp(-pow((fract(uTime*0.85)-0.2)*9.0,2.0)))));
            float ends = smoothstep(0.0,0.12,u)*smoothstep(1.0,0.75,u);
            float k = (0.15 + run*1.8) * ends * (0.45 + uEnergy*1.4 + uBeat*0.7);
            gl_FragColor = vec4((uMood*1.5 + vec3(0.12))*k, 1.0); }`,
      }));
      this.ribbons.add(mesh);
    }
    this.scene.add(this.ribbons);
  }

  /** Low drifting mist over the floor. */
  private buildMist() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${COMMON}${NOISE} varying vec3 vW; void main(){ float r=length(vW.xz);
        float m = fbm3(vec3(vW.xz*0.12 + vec2(uTime*0.02, uTime*0.013), vW.y*0.3 + uTime*0.03));
        float k = smoothstep(0.45, 0.85, m) * smoothstep(40.0, 12.0, r) * smoothstep(PORTAL_R_, PORTAL_R_+3.0, r) * 0.05;
        gl_FragColor = vec4((uMood*0.5 + vec3(0.18,0.22,0.3))*k, 1.0); }`.replace(/PORTAL_R_/g, PORTAL_R.toFixed(1)),
    });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat); m.rotation.x = -Math.PI / 2; m.position.y = 0.25 + i * 0.35; this.scene.add(m);
    }
  }

  private loadFigure() {
    new GLTFLoader().loadAsync("/3d/pulse2/energy_human.glb").then(async g => {
      if (this.disposed) return;
      const mat = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, depthWrite: true, roughness: 1, metalness: 0 });
      const u = this.u;
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vObj;").replace("#include <project_vertex>", "vObj = transformed;\n#include <project_vertex>");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 vObj;\n${COMMON}${NOISE}`)
          .replace("#include <opaque_fragment>", /* glsl */`
            {
              vec3 V = normalize(vViewPosition); float ndv = abs(dot(normal, V));
              float fres = pow(1.0 - ndv, 2.4);
              // currents of light flowing up through the body, veins brighter on the beat
              vec3 p = vObj * 5.0;
              float flow = fbm3(p*0.6 + vec3(0.0, -uTime*0.9, uTime*0.2));
              float vein = pow(1.0 - abs(n3(p*1.4 + vec3(uTime*0.25, -uTime*0.6, 0.0))*2.0 - 1.0), 7.0);
              vec3 col = uMood * (0.55 + flow*1.1 + vein*(1.6 + uEnergy*2.6 + uBeat*1.8) + fres*(3.6 + uEnergy*2.0)) + vec3(0.06 + fres*0.5 + vein*0.25);
              gl_FragColor = vec4(col, clamp(0.72 + fres*0.28, 0.0, 1.0));
            }
            #include <opaque_fragment>`.replace("#include <opaque_fragment>", ""));
      };
      g.scene.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isMesh) { m.material = mat; m.frustumCulled = false; } });
      g.scene.scale.setScalar(0.93);
      this.body = g.scene;
      this.figure.add(g.scene);
      this.rig = new PoseRig(g.scene);
      const [walk, idle] = await Promise.all([loadMocap("u_walk"), loadMocap("u_idle")]);
      if (walk) this.walk = { name: "walk", duration: (walk.frames / walk.fps) / 0.85, loop: true, keys: [{ t: 0, pose: {} }], mocap: walk, mocapStart: 0, mocapSpeed: 0.85, inPlace: true };
      if (idle) this.idle = { name: "idle", duration: idle.frames / idle.fps, loop: true, keys: [{ t: 0, pose: {} }], mocap: idle, mocapStart: 0, inPlace: true };
    }).catch(e => console.warn("deep dive figure", e));
    // energy sparks orbiting the figure
    const S = 180, sp = new Float32Array(S * 4);
    for (let i = 0; i < S; i++) sp.set([Math.random() * Math.PI * 2, 0.3 + Math.random() * 1.7, 0.25 + Math.random() * 0.6, Math.random()], i * 4);
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(S * 3), 3)); sg.setAttribute("aSeed", new THREE.BufferAttribute(sp, 4));
    this.sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uTime; varying float vA;
        void main(){ float a = aSeed.x + uTime*(0.6+aSeed.w); float y = aSeed.y + sin(uTime*1.3 + aSeed.w*9.0)*0.15;
          vec3 p = vec3(cos(a)*aSeed.z, y, sin(a)*aSeed.z);
          vec4 mv = modelViewMatrix*vec4(p,1.0); gl_PointSize = (0.6+aSeed.w*1.2)*40.0/max(0.5,-mv.z); vA = 0.4+aSeed.w*0.6; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `${COMMON} varying float vA; void main(){ float r=length(gl_PointCoord-0.5); float k=smoothstep(0.5,0.0,r)*vA*(0.6+uHigh*1.5+uBeat);
        gl_FragColor = vec4((uMood*1.6+vec3(0.2))*k, 1.0); }`,
    }));
    this.sparks.frustumCulled = false;
    this.figure.add(this.sparks);
    this.scene.add(this.figure);
  }

  // ------------------------------------------------------------------ animate
  private pose: Pose = {}; private root: RootMotion = { x: 0, y: 0, z: 0, yaw: 0 };
  private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3(); private camInit = false; private lastT = 0;
  private tmpA: Pose = {}; private tmpB: Pose = {};
  private static DIVE: Pose = {
    // a swan dive held loosely: arms opened wide from the A-pose and a little forward, elbows
    // softly bent, wrists straight in line with the forearms; back gently arched, toes pointed
    upperarm_l: [-12, 8, 34], upperarm_r: [-12, -8, -34], lowerarm_l: [-16, 0, 0], lowerarm_r: [-16, 0, 0],
    clavicle_l: [0, 0, 6], clavicle_r: [0, 0, -6], spine_01: [-4, 0, 0], spine_02: [-6, 0, 0], spine_03: [-5, 0, 0], neck: [-8, 0, 0], head: [-12, 0, 0],
    thigh_l: [3, 0, -2], thigh_r: [5, 0, 2], calf_l: [8, 0, 0], calf_r: [4, 0, 0], foot_l: [32, 0, 0], foot_r: [30, 0, 0],
  };

  private frame = (now: number) => {
    if (this.disposed || !this.visible) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - (this.last || now)) / 1000)); this.last = now;
    const T = (now - this.t0) / 1000, t = T % LOOP;
    this.audio.update(dt, T);
    const a = this.audio.v, u = this.u;
    (u.uTime.value as number) = T;
    // (the equaliser modulates the light; it must never flood it: about half its range is used,
    // and the floor of the music's level is taken out so a loud passage is not a white-out)
    const lift = (x: number) => Math.max(0, x - 0.18) / 0.82;
    // Music off: a steady base glow with a slow breath and a gentle heartbeat, so the
    // scene never goes dark; music on blends in over a couple of seconds.
    this.liveMix += ((this.audio.live ? 1 : 0) - this.liveMix) * (1 - Math.exp(-dt * 1.2));
    const breath = 0.5 + 0.5 * Math.sin(T * 0.9), hbp = (T * 0.75) % 1, heart = Math.exp(-Math.pow(hbp * 9, 2)) + 0.6 * Math.exp(-Math.pow((hbp - 0.2) * 9, 2));
    const base = { e: 0.22 + 0.08 * breath, b: 0.24 + 0.1 * breath, m: 0.2 + 0.06 * Math.sin(T * 0.6), h: 0.2, beat: heart * 0.25 };
    const L = this.liveMix, mixv = (x: number, y: number) => x * (1 - L) + y * L;
    // Follow the music by its movement, not its loudness: each band against its own
    // slow average (a few seconds), so every swell and hit shows at once, on a quiet
    // track as on a loud one, without the frame washing out.
    const avg = this.avg, ka = 1 - Math.exp(-dt / 3.5);
    avg.all += (a.all - avg.all) * ka; avg.bass += (a.bass - avg.bass) * ka; avg.mid += (a.mid - avg.mid) * ka; avg.high += (a.high - avg.high) * ka;
    const dyn = (x: number, m: number, g: number) => Math.min(1, Math.max(0, 0.35 + (x - m) * g));
    const live = { e: 0.08 + dyn(a.all, avg.all, 2.6) * 0.5 + lift(a.all) * 0.08, b: 0.06 + dyn(a.bass, avg.bass, 2.4) * 0.7,
      m: 0.06 + dyn(a.mid, avg.mid, 2.6) * 0.6, h: 0.05 + dyn(a.high, avg.high, 3.0) * 0.6, beat: Math.min(1, a.beat * 1.1) };
    u.uEnergy.value = mixv(base.e, live.e); u.uBass.value = mixv(base.b, live.b); u.uMid.value = mixv(base.m, live.m);
    u.uHigh.value = mixv(base.h, live.h); u.uBeat.value = mixv(base.beat, live.beat);
    (u.uMood.value as THREE.Color).lerp(this.moodTarget, 1 - Math.exp(-dt * 1.4));
    u.uStrength.value = lerp(u.uStrength.value as number, this.strengthTarget, 1 - Math.exp(-dt * 1.4));
    const fogC = (u.uFog.value as THREE.Color).copy(u.uMood.value as THREE.Color).multiplyScalar(0.035).add(new THREE.Color(0x010206));
    (this.scene.fog as THREE.FogExp2).color.copy(fogC);
    (this.scene.background as THREE.Color).copy(fogC).multiplyScalar(0.7);

    // ---- the take
    const fig = this.figure, cam = this.camera;
    // The walk keeps the capture's stride: speed = stride length x playback rate, so the feet
    // never slide. A slow, solemn pace.
    const WALK_RATE = 0.62, WALK_SPEED = 1.05 * WALK_RATE;
    const zStart = 18, zEdge = PORTAL_R + 0.7;
    const WALK0 = 2, WALK1 = WALK0 + (zStart - zEdge) / WALK_SPEED, EDGE1 = WALK1 + 5, FALL1 = EDGE1 + 6, G = 1.5;
    let figY = 0, figZ = zStart, figTilt = 0, diveMix = 0;
    const drop = (x: number) => -Math.pow(Math.max(0, x), 2) * G * 0.5;
    if (t < WALK0) figZ = zStart;
    else if (t < WALK1) figZ = lerp(zStart, zEdge, (t - WALK0) / (WALK1 - WALK0));
    else if (t < EDGE1) figZ = zEdge;
    else if (t < FALL1) { const k = (t - EDGE1) / (FALL1 - EDGE1); figZ = lerp(zEdge, 1.2, smooth(k * 1.6)); figY = drop(t - EDGE1 - 1.2); figTilt = smooth((t - EDGE1 - 0.8) / 4.2) * Math.PI; diveMix = smooth((t - EDGE1 - 0.3) / 3.5); }
    else { figZ = 1.2; figY = drop(FALL1 - EDGE1 - 1.2) - (t - FALL1) * 0.25; figTilt = Math.PI; diveMix = 1; }
    const walking = t >= WALK0 && t < WALK1;
    fig.position.set(0, figY, figZ);
    fig.rotation.set(0, Math.PI, 0);
    if (figTilt > 0) { fig.rotation.x = -figTilt; fig.position.y += Math.sin(Math.min(figTilt, Math.PI) / 2) * 1.0; }
    if (t >= FALL1) { fig.rotation.y = Math.PI + (t - FALL1) * 0.1; fig.rotation.z = Math.sin((t - FALL1) * 0.21) * 0.12; }
    if (this.rig) {
      const r: RootMotion = { x: 0, y: 0, z: 0, yaw: 0 };
      if (this.walk) { this.walk.mocapSpeed = WALK_RATE; sample(this.walk, t - WALK0, this.tmpA, r); } else for (const k in this.tmpA) delete this.tmpA[k];
      if (this.idle) sample(this.idle, T, this.tmpB, r); else for (const k in this.tmpB) delete this.tmpB[k];
      // walk -> stand eased over a stride, stand -> dive over the fall's first seconds
      const standMix = t < WALK0 ? 1 : t < WALK1 - 1.0 ? 0 : smooth((t - (WALK1 - 1.0)) / 1.4);
      blend(this.pose, [{ pose: this.tmpA, w: (walking || t < WALK1 + 0.5 ? 1 - standMix : 0) * (1 - diveMix) + 1e-6 }, { pose: this.tmpB, w: standMix * (1 - diveMix) }, { pose: DeepDive.DIVE, w: diveMix }]);
      // drifting while it falls: arms float, legs part a little, slow and uneven (wrists stay in line)
      if (diveMix > 0.01) {
        const add = (k: string, x: number, y: number, z: number) => { const o = this.pose[k] ?? (this.pose[k] = [0, 0, 0]); o[0] += x * diveMix; o[1] += y * diveMix; o[2] += z * diveMix; };
        const s1 = Math.sin(T * 0.55), s2 = Math.sin(T * 0.43 + 1.3), s3 = Math.sin(T * 0.31 + 2.1);
        add("upperarm_l", s1 * 6, 0, s2 * 9); add("upperarm_r", -s2 * 5, 0, -s1 * 9);
        add("lowerarm_l", s3 * 5, 0, 0); add("lowerarm_r", -s1 * 5, 0, 0);
        add("thigh_l", s3 * 4, 0, -2 - s1 * 2); add("thigh_r", -s3 * 4, 0, 2 + s2 * 2);
        add("spine_02", s1 * 2, s2 * 2, 0);
        // the captured walk's wrist bend must not carry into the dive
        for (const h of ["hand_l", "hand_r"]) this.pose[h] = [0, 0, 0];
      }
      this.rig.apply(this.pose);
    }
    // footfalls: a sole reaching the floor fires a pulse there
    if (this.body && walking || (this.body && t < WALK1 + 1)) this.footsteps(T, fig);

    (u.uFocus.value as THREE.Vector3).set(fig.position.x, fig.position.y + (figTilt > 1.5 ? -1 : 1), fig.position.z);
    // ---- camera
    const figPos = fig.position;
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    let fov = 52;
    if (t < WALK1) {
      const k = (t - WALK0) / (WALK1 - WALK0);
      pos.set(lerp(1.1, 0.6, smooth(k)), lerp(2.3, 2.1, k), figZ + lerp(9.0, 6.5, smooth(k)));
      look.set(0, lerp(2.6, 1.9, k), figZ - 9);
    } else if (t < EDGE1) {
      const k = smooth((t - WALK1) / (EDGE1 - WALK1));
      pos.set(lerp(0.6, 4.2, k), lerp(2.1, 5.5, k), lerp(zEdge + 6.5, zEdge + 5.6, k));
      look.set(0, lerp(1.9, -1.0, k), lerp(zEdge - 9, 0, k));
      fov = lerp(52, 54, k);
    } else if (t < FALL1 + 3) {
      // The camera goes over the edge with the diver: it follows the body down (always
      // framing it) and, once the body is under the floor, keeps over the portal's opening
      // so the floor never hides it.
      const k = smooth((t - EDGE1) / (FALL1 + 3 - EDGE1));
      const F = new THREE.Vector3(0, figPos.y - 0.9, figPos.z);
      const off = new THREE.Vector3(4.2, 6.4, 5.6).lerp(new THREE.Vector3(0, -6.0, 4.0), k);
      pos.copy(F).add(off);
      const under = smooth((-F.y - 0.2) / 1.8) * (1 - smooth((-pos.y - 10) / 6));
      const rr = Math.hypot(pos.x, pos.z), maxR = lerp(99, PORTAL_R - 1.0, under);
      if (rr > maxR) { pos.x *= maxR / rr; pos.z *= maxR / rr; }
      look.copy(F).add(new THREE.Vector3(0, lerp(-0.2, 1.2, k), 0));
      fov = lerp(54, 64, k);
    } else {
      // Five ways of watching the fall, each held 32 s and crossfaded over 5 s.
      const tf = t - (FALL1 + 3), F = new THREE.Vector3(0, figPos.y - 0.9, figPos.z);
      const moves = [
        (q: number) => { const th = q * 0.08; return { p: new THREE.Vector3(Math.sin(th) * 4.0, -6.0, Math.cos(th) * 4.0), l: new THREE.Vector3(0, 1.2, 0), f: 64 }; },
        (q: number) => { const th = 1.0 + q * 0.12; return { p: new THREE.Vector3(Math.cos(th) * 5.5, 0.4, Math.sin(th) * 5.5), l: new THREE.Vector3(0, -0.4, 0), f: 56 }; },
        (q: number) => { const th = q * 0.05; return { p: new THREE.Vector3(Math.cos(th) * 1.6, 6.5, Math.sin(th) * 1.6), l: new THREE.Vector3(0, -8, 0), f: 70 }; },
        (q: number) => { const th = -q * 0.14; return { p: new THREE.Vector3(Math.cos(th) * 2.3, -0.5, Math.sin(th) * 2.3), l: new THREE.Vector3(0, -0.2, 0), f: 50 }; },
        (q: number) => { const th = 2.0 + q * 0.04; return { p: new THREE.Vector3(Math.cos(th) * 7.2, -2.5, Math.sin(th) * 7.2), l: new THREE.Vector3(0, -1.5, 0), f: 60 }; },
      ];
      const HOLD = 32, BLEND = 5, idx = Math.floor(tf / HOLD), within = tf - idx * HOLD;
      const A = moves[idx % moves.length](tf), Bm = moves[(idx + 1) % moves.length](tf), b = smooth((within - (HOLD - BLEND)) / BLEND);
      pos.copy(A.p).lerp(Bm.p, b).add(F); look.copy(A.l).lerp(Bm.l, b).add(F); fov = lerp(A.f, Bm.f, b);
    }
    // eased camera: no jitter, even across the crossfades
    if (!this.camInit || Math.abs(t - this.lastT) > 1) { this.camPos.copy(pos); this.camLook.copy(look); this.camInit = true; }
    this.lastT = t;
    const kc = 1 - Math.exp(-dt * 3.5);
    this.camPos.lerp(pos, kc); this.camLook.lerp(look, kc);
    cam.position.copy(this.camPos); cam.lookAt(this.camLook);
    cam.fov += (fov - cam.fov) * kc; cam.updateProjectionMatrix();

    // ---- dive environment
    const diving = t > EDGE1 + 1;
    // a slow, floating fall: the rings drift up past the diver rather than rush
    const fallSpeed = diving ? 6.5 * smooth((t - EDGE1 - 1) / 6) + (u.uBass.value as number) * 4 : 0;
    this.tunnelScroll += fallSpeed * dt;
    const camY = cam.position.y;
    this.tunnelSegs.forEach((s, i) => {
      s.visible = t > EDGE1 + 0.5;
      const spacing = 6.5, L = this.tunnelSegs.length * spacing;
      s.position.y = camY - 50 + ((i * spacing + this.tunnelScroll) % L);
      s.rotation.y = T * 0.05 + i * 0.2;
    });
    if (this.abyss) this.abyss.visible = camY > -10;
    // rain/dust: down through the hall; once falling, rushing up past the camera
    const rainSpeed = t < EDGE1 ? 6 : -(fallSpeed * 0.8 + 3);
    this.scroll += rainSpeed * dt;
    const ru = (this.rain.material as THREE.ShaderMaterial).uniforms;
    ru.uScroll.value = this.scroll; ru.uBase.value = Math.max(camY, 0) + (camY < 0 ? camY : 0) + 20 * (camY >= 0 ? 1 : 0);
    // The fall's surroundings change: five worlds take turns (~70 s each, 10 s crossfades),
    // the ribbed ring tunnel first; the hall's dressing fades as the camera goes under.
    const fallT = Math.max(0, t - FALL1);
    const ERA = 70, EB = 16, ei = Math.floor(fallT / ERA), eb = smooth(((fallT % ERA) - (ERA - EB)) / EB);
    const ew = [0, 0, 0, 0, 0]; ew[ei % 5] = 1 - eb; ew[(ei + 1) % 5] += eb;
    if (!diving) { ew.fill(0); ew[0] = 1; }
    // the ribbed rings open out and away when their world ends
    this.tunnelSegs.forEach(sg => sg.scale.setScalar(1 + (1 - ew[0]) * 1.6));
    this.tunnel.visible = ew[0] > 0.01;
    this.worlds.update(T, camY, this.tunnelScroll, smooth((camY + 4) / 6), ew);

    // ---- the loop flare: grows over the last 10 s, flashes, then the walk fades back in
    const flare = Math.max(smooth((t - (LOOP - 9)) / 8) * 0.9 + (t > LOOP - 1.2 ? smooth((t - (LOOP - 1.2)) / 1.0) * 0.1 : 0), 1 - smooth(t / 2.2));
    u.uFlare.value = flare;
    // pulse patterns take turns every 16 s, each fading into the next
    { const ph = T / 16, i = Math.floor(ph) % 4, b = smooth((ph % 1 - 0.7) / 0.3), w = [0, 0, 0, 0]; w[i] = 1 - b; w[(i + 1) % 4] += b; (u.uW.value as THREE.Vector4).set(w[0], w[1], w[2], w[3]); }
    this.bloom.strength = 0.9 + (u.uBeat.value as number) * 0.55 + (u.uEnergy.value as number) * 0.35 + flare * 1.2;
    this.renderer.toneMappingExposure = 0.88 + (u.uEnergy.value as number) * 0.12 + (u.uBeat.value as number) * 0.08;
    this.composer.render(dt);
  };
}
