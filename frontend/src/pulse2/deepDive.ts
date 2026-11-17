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
import { AbyssSky, Embers, MarineSnow } from "./abyss";
import { CANOPY, CEILING, Cave, GoldRain, LightCanopy, RedBeam } from "./rise";

const LOOP = 600;           // seconds in one take: ten minutes, mostly the fall
const RISE_LOOP = 60;       // the rally take: meditation, the raised arm and beam, the gold rain
const PORTAL_R = 4.2;
const RISE_Z = 0; // where the figure sits: the middle of the cave (no pool in the rally take)
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
uniform vec3 uFigMood; // the figure's own colour: the mood, or red while it fires the beam
uniform vec3 uFocus; // the figure: light gathers round it, the rest falls back into shadow
`;

const THIGH_FIX = /* glsl */`
#ifdef USE_SKINNING
  // Volume kept round a deeply turned hip: linear-blend skinning pulls the skin shared by the
  // pelvis and a thigh in toward the thigh's axis when the thigh twists far (the inner thigh
  // pinches). Put each such vertex back at its rest distance from the axis.
  if (uFixOn > 0.5 && aFix.z > 0.001) {
    vec3 hp = aFix.x < 1.5 ? uHipL : uHipR, dr = aFix.x < 1.5 ? uDirL : uDirR;
    vec3 dd = transformed - hp; float ax = dot(dd, dr); vec3 rad = dd - ax * dr; float rl = length(rad);
    if (rl > 1e-4 && rl < aFix.y) transformed = hp + ax * dr + rad * mix(1.0, aFix.y / rl, aFix.z);
  }
#endif
`;
const THIGH_FIX_DECL = "attribute vec3 aFix; uniform float uFixOn; uniform vec3 uHipL, uDirL, uHipR, uDirR;";

/** Gold in the rally take: 20 % more grains for every further whole 1 % of rise
 *  (+1 % = 1x, +2 % = 1.2x, +3 % = 1.4x…), up to +30 % (the Korean daily limit). */
const GOLD_MAX_PCT = 30;
/** The figure's underside map for its shadow: a camera under the floor looking up. */
const FIGH_NEAR = -0.3, FIGH_FAR = 6, FIGH_R = 3.4;
const goldDensity = (pct: number) => 1 + 0.2 * Math.floor(Math.min(GOLD_MAX_PCT, Math.max(1, pct)) - 1);
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
    uFlare: { value: 0 }, uStrength: { value: 0 }, uHole: { value: 1 }, uPR: { value: 1 }, uDeep: { value: 0 }, tFigH: { value: null }, uFigHMat: { value: new THREE.Matrix4() }, uFigHOn: { value: 0 }, uPxScale: { value: 1 }, uFixOn: { value: 0 }, uHipL: { value: new THREE.Vector3() }, uDirL: { value: new THREE.Vector3(0, -1, 0) }, uHipR: { value: new THREE.Vector3() }, uDirR: { value: new THREE.Vector3(0, -1, 0) }, uW: { value: new THREE.Vector4(1, 0, 0, 0) }, uSteps: { value: [new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0), new THREE.Vector4(0, 0, -99, 0)] }, uFocus: { value: new THREE.Vector3(0, 1, 13) }, uMood: { value: new THREE.Color(0x3a8bff) }, uFigMood: { value: new THREE.Color(0x3a8bff) }, uFog: { value: new THREE.Color(0x02040a) },
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
  /** Drawn while the page is shown and the canvas on screen; otherwise no frames at all. */
  private onScreen = true; private shown = true;
  private io?: IntersectionObserver;
  /** Frames are drawn at most 60 times a second: a 90-144 Hz screen would otherwise draw the
   *  same slow take two or more times over. */
  private lastDraw = 0;
  /** Sharpness: the device's pixels up to `prMax`, stepped down (never below `prMin`) only
   *  when frames keep running late while the script is idle, i.e. the GPU is the bottleneck. */
  private pr = 1; private prMax = 1; private prMin = 1;
  private late = { n: 0, slow: 0, cpu: 0, since: 0 };
  private prBase = 1;
  private figH?: { rt: THREE.WebGLRenderTarget; cam: THREE.OrthographicCamera; mat: THREE.MeshDepthMaterial };
  private _cc = new THREE.Color();
  /** The rally take: render the seated figure's underside from below (body only) for the
   *  floor's contact shadow. 512 px over 6.8 m: about 1.3 cm a texel. */
  private renderFigH() {
    if (!this.skin) return;
    if (!this.figH) {
      const rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
      const cam = new THREE.OrthographicCamera(-FIGH_R, FIGH_R, FIGH_R, -FIGH_R, 0, FIGH_FAR);
      cam.layers.set(3);
      this.skin.layers.enable(3);
      this.figH = { rt, cam, mat: new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking }) };
      this.u.tFigH.value = rt.texture;
    }
    const { rt, cam, mat } = this.figH, r = this.renderer, sc = this.scene;
    cam.position.set(0, FIGH_NEAR, RISE_Z); cam.up.set(0, 0, -1); cam.lookAt(0, 10, RISE_Z); cam.updateMatrixWorld(true);
    (this.u.uFigHMat.value as THREE.Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const prevT = r.getRenderTarget(), prevA = r.getClearAlpha(), bg = sc.background, ov = sc.overrideMaterial;
    r.getClearColor(this._cc);
    sc.background = null; sc.overrideMaterial = mat;
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(sc, cam);
    sc.background = bg; sc.overrideMaterial = ov;
    r.setRenderTarget(prevT); r.setClearColor(this._cc, prevA);
  }
  private syncPointScale() { (this.u.uPR.value as number) = this.pr; (this.u.uPxScale.value as number) = this.pr / this.prBase; }
  private static FOG_BASE = new THREE.Color(0x010206);
  private emitters: THREE.Object3D[] = [];
  private heart?: THREE.Sprite; private heartBone?: THREE.Object3D;
  private sky!: AbyssSky; private embers!: Embers;
  private gold!: GoldRain; private beam!: RedBeam; private beamL!: RedBeam; private beamM!: RedBeam; private cave!: Cave;
  private canopy!: LightCanopy;
  private snow!: MarineSnow;
  private _mid = new THREE.Vector3(); private _tR = new THREE.Vector3(); private _tL = new THREE.Vector3();
  /** The rally's size: +5 % and more, both arms rise and fire beams twice as thick and bright. */
  private risePct = 0;
  /** Up 1 % or more: the rally take (meditation, raised arm, red beam, gold rain) instead of the dive. */
  private riseMode = false;
  private goldMult = 1;
  private pelvisH = 1.02;
  private shaftVis = { value: 1 };
  private portalParts: THREE.Object3D[] = [];
  private keyLight!: THREE.PointLight; private figLight!: THREE.PointLight;
  private caveSun!: THREE.DirectionalLight; private caveFill!: THREE.HemisphereLight;
  private static _glow?: THREE.Texture;
  /** A soft radial glow (white centre, long falloff) for sprites. */
  static glowTex() {
    if (DeepDive._glow) return DeepDive._glow;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d")!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.12, "rgba(255,255,255,0.55)"); gr.addColorStop(0.4, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (DeepDive._glow = t);
  }

  constructor(private canvas: HTMLCanvasElement, private quality: "high" | "medium" = "high") {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false });
    // (sharper than before: the savings below pay for it; a slow GPU steps itself back)
    const dpr = window.devicePixelRatio || 1;
    this.prMax = Math.min(dpr, quality === "high" ? 2 : 1.6); this.prMin = Math.min(dpr, 1);
    this.pr = this.prMax;
    this.renderer.setPixelRatio(this.pr);
    // point sprites are sized in device pixels, tuned at the former ratio: keep their look
    this.prBase = Math.min(dpr, quality === "high" ? 1.5 : 1);
    this.syncPointScale();
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
    this.sky = new AbyssSky(this.scene, this.u, COMMON, NOISE);
    this.snow = new MarineSnow(this.scene, this.u, COMMON, quality === "high" ? 2400 : 1300);
    this.embers = new Embers(this.scene, this.u, COMMON, quality === "high" ? 900 : 500);
    this.gold = new GoldRain(this.scene, this.u, COMMON, quality === "high" ? 4200 : 2200, goldDensity(GOLD_MAX_PCT));
    this.gold.setDensity(this.goldMult);
    this.cave = new Cave(this.scene, this.u, COMMON, NOISE, quality);
    this.beam = new RedBeam(this.scene, this.u, COMMON, DeepDive.glowTex());
    this.beamL = new RedBeam(this.scene, this.u, COMMON, DeepDive.glowTex());
    this.beamM = new RedBeam(this.scene, this.u, COMMON, DeepDive.glowTex());
    this.beam.top = this.beamL.top = this.beamM.top = CANOPY;
    this.canopy = new LightCanopy(this.scene, this.u, COMMON, NOISE);
    // Light in the mood's colour: one from the portal, one carried by the figure, so the
    // chrome ribs and the hall's walls take shape round it instead of sinking into black.
    this.keyLight = new THREE.PointLight(0x3a8bff, 0, 60, 1.6); this.keyLight.position.set(0, 1.4, 0);
    this.figLight = new THREE.PointLight(0x3a8bff, 0, 26, 1.8);
    this.scene.add(this.keyLight, this.figLight);
    // The cavern's moonlight: a cool light slanting down from the chimney, so the crags and
    // formations model in light and shadow. (Always present, dark outside the rally take:
    // switching a light on and off would recompile every lit material.)
    this.caveSun = new THREE.DirectionalLight(0xbcd2ff, 0); this.caveSun.position.set(-18, 60, 14); this.caveSun.target.position.set(4, 0, -6);
    this.caveFill = new THREE.HemisphereLight(0x6d86b8, 0x0a0f1a, 0);
    this.scene.add(this.caveSun, this.caveSun.target, this.caveFill);
    this.buildMist();
    this.loadFigure();

    // A multisampled, half-float target: smooth edges on the thin rings and ribs (the
    // canvas's own antialiasing does not reach through the post chain), no banding.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
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
      uniforms: { tDiffuse: { value: null }, uFlare: this.u.uFlare, uMood: this.u.uMood, uTime: this.u.uTime, uDeep: this.u.uDeep, uRes: { value: new THREE.Vector2(1, 1) } },
      defines: { STREAK: quality === "high" ? 1 : 0 },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uFlare, uTime, uDeep; uniform vec3 uMood; uniform vec2 uRes; varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5; float r = length(c);
          // a whisper of chromatic aberration toward the edges
          vec2 off = c * r * 0.006;
          vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
          #if STREAK
          // an anamorphic lens: the brightest lights draw a faint horizontal streak
          vec3 st = vec3(0.0); float px = 1.0 / uRes.x;
          for (int i = 1; i <= 8; i++) { float d = float(i*i) * 3.0 * px, w = exp(-float(i)*0.45);
            st += (max(texture2D(tDiffuse, vUv + vec2(d, 0.0)).rgb - 1.4, 0.0) + max(texture2D(tDiffuse, vUv - vec2(d, 0.0)).rgb - 1.4, 0.0)) * w; }
          col += (st * 0.5 + dot(st, vec3(0.33)) * 0.15) * (uMood * 0.5 + vec3(0.35)) * 0.09;
          #endif
          // vignette round the subject (sat low in the frame), deep at the edges
          float rs = length((vUv - vec2(0.5, 0.4)) * vec2(1.0, 1.15));
          col *= mix(1.0, 0.18 - 0.1 * uDeep, smoothstep(0.2 - 0.06 * uDeep, 0.85 - 0.12 * uDeep, rs));
          // contrast: mid-tones settle, highlights keep their punch
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col *= mix(0.62, 1.0, smoothstep(0.05, 0.9, lum));
          // split tone: the shadows lean a touch cool and deep, the highlights a touch warm
          col = mix(col, col * vec3(0.92, 0.96, 1.1), smoothstep(0.3, 0.0, lum) * 0.5);
          col = mix(col, col * vec3(1.06, 1.02, 0.95), smoothstep(0.4, 1.4, lum) * 0.4);
          col = mix(col, vec3(1.0) * 0.6 + uMood * 0.8, clamp(uFlare, 0.0, 1.0)); // the loop's flare
          // fine film grain, which also dithers away banding in the dark gradients
          float g = fract(sin(dot(vUv*uRes + fract(uTime*7.13)*91.0, vec2(12.9898, 78.233)))*43758.5453) - 0.5;
          col += g * (0.0015 + 0.012*lum); // (linear light: tiny in the darks)
          gl_FragColor = vec4(max(col, 0.0), 1.0);
        }`,
    });
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    document.addEventListener("visibilitychange", this.onVis);
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver(es => { this.onScreen = es.some(e => e.isIntersecting); this.onVis(); });
      this.io.observe(canvas);
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The colour of the market: the index change on arrival, a chosen stock's afterwards. */
  setMood(changePct: number | null | undefined) {
    const rise = typeof changePct === "number" && Number.isFinite(changePct) && changePct >= 1;
    // (the rally take keeps the hall blue: only the figure and its beam turn red)
    moodColor(rise ? -1.2 : changePct, this.moodTarget);
    // (working in linear light: the stops are authored in sRGB)
    this.moodTarget.convertSRGBToLinear();
    // Equal brightness whatever the hue: yellow and orange carry far more luminance than
    // blue, and would wash the hall white through the bloom.
    const c = this.moodTarget, lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    c.multiplyScalar(Math.min(1.1, 0.3 / Math.max(0.05, lum)));
    this.strengthTarget = moodStrength(changePct);
    this.goldMult = rise ? goldDensity(changePct) : 1;
    this.risePct = rise ? changePct : 0;
    this.gold?.setDensity(this.goldMult);
    if (rise !== this.riseMode) {
      // a different take: start it from its beginning (it opens on a soft flare)
      this.riseMode = rise; this.t0 = performance.now(); this.camInit = false;
    }
  }

  /** Jump the take to `t` seconds (checks and screenshots). */
  seek(t: number) { this.t0 = performance.now() - t * 1000; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVis);
    this.resizeObs.disconnect(); this.io?.disconnect();
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose(); });
    this.floor?.dispose(); this.figH?.rt.dispose(); this.figH?.mat.dispose();
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

  private onVis = () => {
    const was = this.visible;
    this.visible = !document.hidden && this.onScreen;
    if (this.visible && !was && !this.disposed) { cancelAnimationFrame(this.raf); this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
  };

  private resize() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pr);
    this.composer.setSize(w, h);
    // the floor's reflection at about half the frame's own pixels, in its proportions (a fixed
    // square was stretched on wide screens and wasted on phones)
    this.floor?.getRenderTarget().setSize(Math.max(256, Math.round(w * this.pr * 0.55)), Math.max(256, Math.round(h * this.pr * 0.55)));
    this.bloom.setSize(w, h);
    ((this.finish.uniforms as Record<string, { value: unknown }>).uRes.value as THREE.Vector2).set(w, h);
    this.camera.aspect = w / h;
    // The subject sits low in the frame (~64 % down), clear of the board above it.
    // (lower still on short landscape screens, where the site header takes the top third)
    this.camera.setViewOffset(w, h, 0, -h * (w < h * 0.8 ? 0.09 : h < 560 ? 0.17 : 0.14), w, h); // (portrait phones: clear of the tab bar)
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
        uniform sampler2D tDiffuse; uniform float uPortalR, uHole; uniform vec4 uSteps[4]; varying vec4 vUv; varying vec3 vWorld;
        uniform sampler2D tFigH; uniform mat4 uFigHMat; uniform float uFigHOn;
        ${COMMON}${NOISE}
        // the seated figure's underside, seen from below: the height of its lowest point over
        // each spot of the floor (9: nothing there)
        float figH(vec2 xz){
          vec4 p = uFigHMat * vec4(xz.x, 0.0, xz.y, 1.0); vec2 st = p.xy * 0.5 + 0.5;
          if (st.x < 0.0 || st.y < 0.0 || st.x > 1.0 || st.y > 1.0) return 9.0;
          float v = texture2D(tFigH, st).r;
          return v < 1e-4 ? 9.0 : ${FIGH_NEAR.toFixed(2)} + (1.0 - v) * ${FIGH_FAR.toFixed(1)};
        }
        // How much of the floor's light the figure takes away at this spot: a crisp, dark line
        // where the body rests on the floor, a soft occlusion gathering round it (how much of the
        // sky the body hides, sampled on a spiral), and its shadow from a high light behind it, falling
        // forward toward the camera so it reads in the frontal view.
        float figShadow(vec2 xz){
          if (uFigHOn < 0.5 || abs(xz.x - uFocus.x) > ${FIGH_R.toFixed(1)} || abs(xz.y - uFocus.z) > ${FIGH_R.toFixed(1)}) return 0.0;
          float h0 = figH(xz);
          float contact = 1.0 - smoothstep(0.015, 0.16, h0);
          // (a per-pixel turn of the spiral and of the march: smooth, no stepped copies)
          float jit = fract(sin(dot(xz, vec2(12.9898, 78.233))) * 43758.5453);
          float ao = 0.0;
          for (int i = 0; i < 16; i++) {
            float fi = float(i), rad = 0.04 + 1.3 * sqrt((fi + 0.5) / 16.0), an = fi * 2.39996 + jit * 6.2831853;
            float h = figH(xz + vec2(cos(an), sin(an)) * rad);
            ao += 1.0 - smoothstep(rad * 0.35, rad * 1.5 + 0.08, h);
          }
          ao /= 16.0;
          float sun = 0.0;
          for (int k = 0; k < 14; k++) {
            float hk = (float(k) + jit) * 0.19;
            float h = figH(xz + vec2(-0.22, -0.42) * hk);
            // softer the higher the part that casts it (a wide light: penumbra grows with height)
            sun = max(sun, (1.0 - smoothstep(hk - 0.1 - hk * 0.25, hk + 0.04, h)) * (1.0 - hk * 0.22));
          }
          return clamp(max(contact, ao * 1.15) + sun * 0.55 * (1.0 - contact), 0.0, 1.0);
        }
        void main(){
          float r = length(vWorld.xz);
          if (uHole > 0.5 && r < uPortalR - 0.05) discard;
          float a = atan(vWorld.z, vWorld.x);
          // wet stone: broad ripples bend the reflection a little
          vec2 nn = vec2(n3(vec3(vWorld.xz*0.9, uTime*0.05)), n3(vec3(vWorld.xz*0.9+7.0, uTime*0.05))) - 0.5;
          // (round the seated figure the water lies still, so its reflection stays clear)
          float still = uFigHOn > 0.5 ? mix(0.06, 1.0, smoothstep(2.5, 16.0, length(vWorld.xz - uFocus.xz))) : 1.0;
          vec4 uv = vUv; uv.xy += nn * 0.035 * still * uv.w;
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
          float near = exp(-max(r - uPortalR, 0.0) * 0.45) * mix(0.25, 1.0, uHole);
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
          float sh = figShadow(vWorld.xz), lit = 1.0 - sh * 0.92;
          // the figure's own light pooled on the floor round it, which its shadow cuts into
          float fd = length(vWorld.xz - uFocus.xz);
          vec3 pool = uFigHOn > 0.5 ? uFigMood * (0.55 * exp(-fd / 1.8) + 0.12 * exp(-fd / 6.0)) * (0.8 + uEnergy * 0.6) : vec3(0.0);
          vec3 col = base * lit + refl * fres * (1.0 - sh * 0.55) + (glow + pool) * lit;
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
    this.portalParts = [rim, halo, lip];
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
      const u = i / seg, p = curve.getPointAt(u), r = lerp(r0, r1, Math.pow(u, 0.8)) * (1 + 0.035 * Math.sin(u * 40));
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

  /** Slender ribs of polished dark metal lit from within: two fine filaments of light run
   *  their length, the edges glow (they never read as black masses against the dark), a few
   *  lit cells, and a light pulse travels along each with the music. */
  private ribMaterial(phase: number, slots = 22) {
    const m = new THREE.MeshStandardMaterial({ color: 0x1a2232, metalness: 1, roughness: 0.16, envMapIntensity: 2.6 });
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
            // fine filaments, always alight, on both flanks
            float fil = (1.0 - smoothstep(0.0, 0.018, abs(v - 0.5))) + (1.0 - smoothstep(0.0, 0.018, abs(fract(v + 0.5) - 0.5)));
            // lit cells mostly dark until a pulse passes; all of it brightest near the figure
            float focus = 0.1 + 0.9*exp(-length(vRibW - uFocus) / 11.0);
            vec3 Vr = normalize(vViewPosition); float rimR = pow(1.0 - abs(dot(normal, Vr)), 4.0);
            float far = exp(-length(vRibW - uFocus) / 26.0);
            vec3 lum = uMood * 1.2 + vec3(0.06, 0.08, 0.1);
            // a glowing rim, so a rib reads as a line of light, never a dark mass
            totalEmissiveRadiance += lum * pow(1.0 - abs(dot(normal, Vr)), 2.0) * (0.22 + uEnergy*0.2 + pulse*0.4) * (0.4 + 0.6*far);
            totalEmissiveRadiance += lum * fil * (0.55 + uEnergy*0.5 + pulse*1.6) * (0.35 + 0.65*far);
            totalEmissiveRadiance += uMood * 0.05;
            totalEmissiveRadiance += uMood * rimR * (0.10 + uEnergy*0.12 + pulse*0.25) * (0.25 + 0.75*far);
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
      const main = new THREE.Mesh(this.tube(curve, 180, 16, 0.5, 0.16), this.ribMaterial(k * 1.3));
      this.chamber.add(main);
      // two branches peeling off each rib, like roots
      for (const s of [-1, 1]) {
        const b = new THREE.CatmullRomCurve3([at(22, 3, 0.1), at(20 + s * 1.5, 10, 0.1 + s * 0.35), at(17, 15, s * 0.55), at(13.5, 17, s * 0.75)], false, "centripetal");
        this.chamber.add(new THREE.Mesh(this.tube(b, 90, 10, 0.2, 0.06), this.ribMaterial(k * 1.3 + s, 12)));
      }
    }
    // a far wall of arches, each with a lit oval pod, ringing the hall
    const podMat = new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }`,
      // tall slits of light set in the wall: a hot core line, a soft gradient glow, a slow
      // flicker of light travelling up each, brighter toward the floor
      fragmentShader: /* glsl */`${COMMON} varying vec2 vUv; void main(){
        float x = abs(vUv.x - 0.5) * 2.0, y = vUv.y;
        float ends = smoothstep(0.0, 0.08, y) * smoothstep(1.0, 0.85, y);
        float core = exp(-x*x*90.0), glow = exp(-x*x*6.0) * 0.18;
        float run = pow(0.5 + 0.5*sin(y*9.0 - uTime*(0.8 + uBass*1.5) + gl_FragCoord.x*0.002), 6.0);
        float k = (core * (0.5 + run*1.2) + glow) * ends * (1.2 - y*0.6);
        gl_FragColor = vec4((uMood*1.2 + vec3(0.05))*k*(0.18+uEnergy*0.45), 1.0); }`,
    });
    const M = 64, pods = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 7.5), podMat, M * 2);
    const tmp = new THREE.Object3D();
    for (let i = 0; i < M * 2; i++) {
      const row = i < M ? 0 : 1, a = ((i % M) / M) * Math.PI * 2, r = 44 + row * 2;
      tmp.position.set(Math.cos(a + row * 0.049) * r, 3.9 + row * 10, Math.sin(a + row * 0.049) * r); tmp.lookAt(0, tmp.position.y, 0); tmp.scale.setScalar(1 - row * 0.25); tmp.updateMatrix();
      pods.setMatrixAt(i, tmp.matrix);
    }
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(46, 46, 60, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.9, roughness: 0.35, side: THREE.BackSide }));
    wall.position.y = 26;
    const band = new THREE.Mesh(new THREE.TorusGeometry(45.6, 0.08, 8, 360), new THREE.ShaderMaterial({
      uniforms: { ...this.u }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `${COMMON} varying vec2 vUv; void main(){ float a=vUv.x*6.2831853; float run=pow(0.5+0.5*sin(a*3.0 - uTime*0.4),4.0);
        gl_FragColor = vec4((uMood*1.4+vec3(0.08))*(0.35+run*0.9)*(0.6+uEnergy*0.6), 1.0); }`,
    }));
    band.rotation.x = Math.PI / 2; band.position.y = 0.15;
    this.chamber.add(pods, wall, band);
    this.scene.add(this.chamber);
  }

  /** The light falling through the ceiling's opening onto the portal. */
  private buildShaft() {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.2, PORTAL_R, 52, 64, 1, true), new THREE.ShaderMaterial({
      uniforms: { ...this.u, uShaft: this.shaftVis }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vW; varying float vY; void main(){ vN = normalize(normalMatrix*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vY=position.y; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`${COMMON}${NOISE} uniform float uShaft; varying vec3 vN; varying vec3 vW; varying float vY;
        void main(){ vec3 V = normalize(cameraPosition - vW); float face = pow(abs(dot(normalize(vN), V)), 2.0);
          float a = atan(vW.z, vW.x);
          float streak = 0.35 + pow(n3(vec3(a*9.0, vW.y*0.05 + uTime*0.35, 0.0)), 3.0) * 1.6;
          float fade = smoothstep(-26.0, -18.0, vY) * smoothstep(26.0, 14.0, vY);
          float k = face * streak * fade * (0.28 + uEnergy*0.45 + uBeat*0.25) * uShaft;
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
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.16, 14, 200), ringMat);
      ring.rotation.x = Math.PI / 2;
      const line = new THREE.Mesh(new THREE.TorusGeometry(R - 0.32, 0.03, 8, 240), glowMat);
      line.rotation.x = Math.PI / 2;
      seg.add(ring, line);
      // curved ribs between this ring and the next, sweeping in a spiral
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + i * 0.3;
        const at = (r: number, y: number, s: number) => new THREE.Vector3(Math.cos(a + s) * r, y, Math.sin(a + s) * r);
        const c = new THREE.CatmullRomCurve3([at(R, 0, 0), at(R + 2.2, -2.2, 0.18), at(R + 1.4, -4.6, 0.38), at(R, -6, 0.5)]);
        seg.add(new THREE.Mesh(this.tube(c, 48, 8, 0.075, 0.05), ringMat));
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
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uBase, uScroll, uTime, uPxScale; varying float vA;
        void main(){ float y = uBase + mod(aSeed.y - uScroll*0.25*(0.3+aSeed.w), 90.0) - 45.0;
          vec3 p = vec3(aSeed.x + sin(uTime*0.2 + aSeed.w*30.0)*0.6, y, aSeed.z + cos(uTime*0.17 + aSeed.w*20.0)*0.6);
          vec4 mv = viewMatrix*vec4(p,1.0); gl_PointSize = (0.8 + aSeed.w*2.2) * 45.0 * uPxScale / max(1.0,-mv.z); vA = smoothstep(45.0, 25.0, abs(y-uBase)) * (0.4+aSeed.w);
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
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vObj;\n" + THIGH_FIX_DECL).replace("#include <skinning_vertex>", "#include <skinning_vertex>\n" + THIGH_FIX).replace("#include <project_vertex>", "vObj = transformed;\n#include <project_vertex>");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 vObj;\n${COMMON}${NOISE}`)
          .replace("#include <opaque_fragment>", /* glsl */`
            {
              vec3 V = normalize(vViewPosition); float ndv = abs(dot(normal, V));
              float fres = pow(1.0 - ndv, 2.4);
              // currents of light flowing up through the body, veins brighter on the beat
              vec3 p = vObj * 5.0;
              float flow = fbm3(p*0.6 + vec3(0.0, -uTime*0.9, uTime*0.2));
              float vein = pow(1.0 - abs(n3(p*1.4 + vec3(uTime*0.25, -uTime*0.6, 0.0))*2.0 - 1.0), 7.0);
              // a fine second web of capillaries, and a slow scan of light sweeping up the body
              float cap = pow(1.0 - abs(n3(p*3.6 + vec3(0.0, -uTime*0.4, uTime*0.3))*2.0 - 1.0), 14.0);
              float scanY = fract(uTime*0.11) * 2.6 - 0.3;
              float scan = exp(-pow((vObj.y - scanY) * 14.0, 2.0)) * (0.6 + uBeat*0.8);
              // depth: the body's middle reads as a dense, darker glass; its edges burn
              float core = pow(ndv, 3.0);
              vec3 hot = mix(uFigMood, vec3(1.0), 0.3);            // highlights run toward white
              vec3 deep = uFigMood * vec3(0.55, 0.6, 0.75);         // the glass's depth, cooler
              vec3 col = deep * (0.35 + flow*0.9) * (0.6 + core*0.5)
                + uFigMood * vein * (1.6 + uEnergy*2.6 + uBeat*1.8)
                + hot * (cap * (0.35 + uHigh*0.9) + scan * 0.9)
                + hot * fres * (2.6 + uEnergy*1.6)
                + vec3(0.02 + fres*0.18 + vein*0.12);
              gl_FragColor = vec4(col, clamp(0.68 + fres*0.32 + scan*0.1, 0.0, 1.0));
            }
            #include <opaque_fragment>`.replace("#include <opaque_fragment>", ""));
      };
      // An aura: a second skin a few centimetres out, only its silhouette glows, so the
      // body sits in a soft halo of its own light. (Shares the skeleton: no extra skinning work.)
      const aura = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      aura.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + THIGH_FIX_DECL).replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += objectNormal * 0.035;").replace("#include <skinning_vertex>", "#include <skinning_vertex>\n" + THIGH_FIX);
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\n${COMMON}`)
          .replace("#include <opaque_fragment>", /* glsl */`
            { vec3 V = normalize(vViewPosition); float ndv = abs(dot(normal, V));
              float halo = pow(1.0 - ndv, 3.2) * smoothstep(0.0, 0.25, ndv + 0.05);
              gl_FragColor = vec4(uFigMood * halo * (0.45 + uEnergy*0.5 + uBeat*0.4), 1.0); }`);
      };
      const auras: [THREE.Object3D, THREE.Object3D][] = [];
      g.scene.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isMesh) { m.material = mat; m.frustumCulled = false; if (m.isSkinnedMesh) { const a = m.clone(); a.material = aura; a.renderOrder = 2; auras.push([m, a]); } } });
      for (const [src, a] of auras) (src.parent ?? g.scene).add(a);
      g.scene.scale.setScalar(0.93);
      this.body = g.scene;
      this.figure.add(g.scene);
      this.rig = new PoseRig(g.scene);
      { const hr = this.rig.bones.get("hand_r"), la = this.rig.bones.get("lowerarm_r");
        if (hr && la) { g.scene.updateMatrixWorld(true); const d = hr.getWorldPosition(new THREE.Vector3()).sub(la.getWorldPosition(new THREE.Vector3())).normalize();
          this.handDir = d.applyQuaternion(hr.getWorldQuaternion(new THREE.Quaternion()).invert()); } }
      { const hl = this.rig.bones.get("hand_l"), la = this.rig.bones.get("lowerarm_l");
        if (hl && la) { g.scene.updateMatrixWorld(true); const d = hl.getWorldPosition(new THREE.Vector3()).sub(la.getWorldPosition(new THREE.Vector3())).normalize();
          this.handDirL = d.applyQuaternion(hl.getWorldQuaternion(new THREE.Quaternion()).invert()); } }
      this.buildThighFix(g.scene);
      { const pv = this.rig.bones.get("pelvis"); if (pv) { this.figure.updateMatrixWorld(true); this.pelvisH = this.figure.worldToLocal(pv.getWorldPosition(new THREE.Vector3())).y; } }
      this.emitters = ["hand_l", "hand_r", "lowerarm_l", "lowerarm_r", "upperarm_l", "upperarm_r", "head", "spine_03", "spine_02", "pelvis", "calf_l", "calf_r", "foot_l", "foot_r"]
        .map(n => this.rig!.bones.get(n)).filter((b): b is THREE.Bone => !!b);
      // a heart of light in the chest
      const chest = this.rig.bones.get("spine_03");
      if (chest) {
        const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: DeepDive.glowTex(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
        heart.renderOrder = 3; heart.scale.setScalar(0.55);
        this.heart = heart; this.scene.add(heart); this.heartBone = chest;
      }
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
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uTime, uPxScale; varying float vA;
        void main(){ float a = aSeed.x + uTime*(0.6+aSeed.w); float y = aSeed.y + sin(uTime*1.3 + aSeed.w*9.0)*0.15;
          vec3 p = vec3(cos(a)*aSeed.z, y, sin(a)*aSeed.z);
          vec4 mv = modelViewMatrix*vec4(p,1.0); gl_PointSize = (0.6+aSeed.w*1.2)*40.0*uPxScale/max(0.5,-mv.z); vA = 0.4+aSeed.w*0.6; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `${COMMON} varying float vA; void main(){ float r=length(gl_PointCoord-0.5); float k=smoothstep(0.5,0.0,r)*vA*(0.6+uHigh*1.5+uBeat);
        gl_FragColor = vec4((uFigMood*1.6+vec3(0.2))*k, 1.0); }`,
    }));
    this.sparks.frustumCulled = false;
    this.figure.add(this.sparks);
    this.scene.add(this.figure);
  }

  // ------------------------------------------------------------------ animate
  private pose: Pose = {}; private root: RootMotion = { x: 0, y: 0, z: 0, yaw: 0 };
  private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3(); private camInit = false; private lastT = 0;
  private tmpA: Pose = {}; private tmpB: Pose = {}; private tmpC: Pose = {};
  private camRoll = 0;
  private _cp = new THREE.Vector3(); private _cl = new THREE.Vector3(); private _cf = new THREE.Vector3();
  /** The views of the fall, in cylinder coordinates round the diver (th from +z, y up,
   *  `ly` the look point's height): `q` 0..1 through the shot, `s` seconds into the fall.
   *  The body falls head down, so "above" is behind its feet and "below" is ahead of it. */
  private shot(i: number, q: number, s: number) {
    const k = ((i % 6) + 6) % 6, e = smooth(q);
    switch (k) {
      // 0. over it, looking down past the body into the depths it falls toward
      case 0: return { r: 2.3 - 0.5 * e, th: 0.3 + s * 0.05, y: 6.2 - 1.2 * e, ly: -9, f: 60, roll: 0 };
      // 1. side profile on a long lens, a slow track round
      case 1: return { r: 7.2, th: 1.4 + s * 0.045, y: 0.6 - 0.6 * e, ly: -0.3, f: 34, roll: 0.05 };
      // 2. ahead of it, looking back up: it comes at the lens, the world streaming away behind
      case 2: return { r: 3.0 + 0.6 * e, th: 2.6 + s * 0.08, y: -6.4 + 1.8 * e, ly: 1.0, f: 64, roll: -0.07 };
      // 3. a push in from wide to a close portrait
      case 3: return { r: 7.4 - 4.2 * e, th: 3.9 - s * 0.06, y: -1.4 + 1.0 * e, ly: -0.7, f: 58 - 14 * e, roll: 0.04 };
      // 4. a spiral crane: half a turn round it, rising from below to above
      case 4: return { r: 4.6, th: 4.9 + e * 2.6, y: lerp(-4.2, 4.2, e), ly: lerp(0.8, -2.4, e), f: 54, roll: 0.03 * Math.sin(e * 3.14) };
      // 5. close behind the feet, the whole body laid out down the frame to the glow below
      default: return { r: 1.5, th: 5.6 + s * 0.035, y: 3.4 - 0.4 * e, ly: -6, f: 68, roll: 0.06 * Math.sin(s * 0.2) };
    }
  }
  private static DIVE: Pose = {
    // a swan dive held loosely: arms opened wide from the A-pose and a little forward, elbows
    // softly bent, wrists straight in line with the forearms; back gently arched, toes pointed
    upperarm_l: [-12, 8, 34], upperarm_r: [-12, -8, -34], lowerarm_l: [-16, 0, 0], lowerarm_r: [-16, 0, 0],
    clavicle_l: [0, 0, 6], clavicle_r: [0, 0, -6], spine_01: [-4, 0, 0], spine_02: [-6, 0, 0], spine_03: [-5, 0, 0], neck: [-8, 0, 0], head: [-12, 0, 0],
    thigh_l: [3, 0, -2], thigh_r: [5, 0, 2], calf_l: [8, 0, 0], calf_r: [4, 0, 0], foot_l: [32, 0, 0], foot_r: [30, 0, 0],
  };
  // At the rim: the arms open a little from the sides, chest lifted, chin up toward the light.
  private static PREP: Pose = {
    upperarm_l: [-6, 4, 16], upperarm_r: [-6, -4, -16], lowerarm_l: [-12, 0, 0], lowerarm_r: [-12, 0, 0],
    clavicle_l: [0, 0, 4], clavicle_r: [0, 0, -4], spine_02: [-4, 0, 0], spine_03: [-5, 0, 0], neck: [-4, 0, 0], head: [-8, 0, 0],
  };
  // Gathering to spring: knees bent, hips back, arms swung behind.
  private static CROUCH: Pose = {
    spine_01: [12, 0, 0], spine_02: [8, 0, 0], spine_03: [4, 0, 0], head: [6, 0, 0],
    thigh_l: [-28, 0, -2], thigh_r: [-28, 0, 2], calf_l: [48, 0, 0], calf_r: [48, 0, 0], foot_l: [-20, 0, 0], foot_r: [-20, 0, 0],
    upperarm_l: [38, 0, 10], upperarm_r: [38, 0, -10], lowerarm_l: [-14, 0, 0], lowerarm_r: [-14, 0, 0],
  };
  // The fall's shapes. A wide star: arms high and open, legs parted.
  private static STAR: Pose = {
    upperarm_l: [-8, 6, 62], upperarm_r: [-8, -6, -62], lowerarm_l: [-10, 0, 0], lowerarm_r: [-10, 0, 0],
    clavicle_l: [0, 0, 10], clavicle_r: [0, 0, -10], spine_02: [-6, 0, 0], spine_03: [-6, 0, 0], neck: [-6, 0, 0], head: [-10, 0, 0],
    thigh_l: [2, 0, 14], thigh_r: [4, 0, -14], calf_l: [12, 0, 0], calf_r: [8, 0, 0], foot_l: [30, 0, 0], foot_r: [30, 0, 0],
  };
  // Streamlined: arms swept forward past the head toward the depths, body long.
  private static REACH: Pose = {
    upperarm_l: [-70, 0, 70], upperarm_r: [-70, 0, -70], lowerarm_l: [-8, 0, 0], lowerarm_r: [-8, 0, 0],
    clavicle_l: [0, 0, 12], clavicle_r: [0, 0, -12], spine_01: [-2, 0, 0], spine_02: [-3, 0, 0], neck: [-14, 0, 0], head: [-16, 0, 0],
    thigh_l: [2, 0, -1], thigh_r: [2, 0, 1], calf_l: [4, 0, 0], calf_r: [4, 0, 0], foot_l: [34, 0, 0], foot_r: [34, 0, 0],
  };
  // A loose half-curl: knees drawn up, arms soft round them.
  private static CURL: Pose = {
    spine_01: [12, 0, 0], spine_02: [10, 0, 0], spine_03: [6, 0, 0], neck: [6, 0, 0], head: [6, 0, 0],
    thigh_l: [-42, 0, 4], thigh_r: [-36, 0, -4], calf_l: [70, 0, 0], calf_r: [62, 0, 0], foot_l: [22, 0, 0], foot_r: [22, 0, 0],
    upperarm_l: [-38, 0, 22], upperarm_r: [-34, 0, -22], lowerarm_l: [-55, 0, 0], lowerarm_r: [-50, 0, 0],
  };

  private frame = (now: number) => {
    if (this.disposed || !this.visible) return;
    this.raf = requestAnimationFrame(this.frame);
    // at most 60 frames a second, evenly (a 120 Hz screen draws every other refresh, 90 Hz two in three)
    const STEP = 1000 / 60;
    if (this.lastDraw && now - this.lastDraw < STEP - 2) return;
    this.lastDraw = this.lastDraw && now - this.lastDraw < STEP * 2 ? this.lastDraw + STEP : now;
    const cpu0 = performance.now(), gap = this.last ? now - this.last : 0;
    // (a long stall — shaders compiling as a take first appears — holds the take rather than
    // skipping it: the meditation must not be lost to a compile)
    if (this.last && now - this.last > 250) this.t0 += now - this.last - 16;
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
    const fogC = (u.uFog.value as THREE.Color).copy(u.uMood.value as THREE.Color).multiplyScalar(0.035).add(DeepDive.FOG_BASE);
    (this.scene.fog as THREE.FogExp2).color.copy(fogC);
    // (the cavern is seen across 30-60 m: a thinner haze there, so its rock stays legible)
    (this.scene.fog as THREE.FogExp2).density = this.riseMode ? 0.0055 : 0.011 + 0.007 * (u.uDeep.value as number);
    (this.scene.background as THREE.Color).copy(fogC).multiplyScalar(0.7);
    (u.uFigHOn.value as number) = this.riseMode && this.skin ? 1 : 0;
    if (this.riseMode) { this.riseFrame(T, dt); this.renderFigH(); this.post(T % RISE_LOOP, RISE_LOOP, dt, false); this.pace(gap, performance.now() - cpu0); return; }
    this.gold.update(-1, 0); this.beam.update(this._fv, -1, 0, 0); this.beamL.update(this._fv, -1, 0, 0); this.beamM.update(this._fv, -1, 0, 0); this.canopy.update(this._fv, -1, 0); this.rain.visible = true; this.shaftVis.value = 1;
    this.chamber.visible = true; this.cave.update(false, 0, 0); this.figure.scale.setScalar(1);
    this.caveSun.intensity = 0; this.caveFill.intensity = 0;
    (u.uHole.value as number) = 1; for (const o of this.portalParts) o.visible = true;
    this.legFill(0); this.updateThighFix(false);
    (u.uFigMood.value as THREE.Color).copy(u.uMood.value as THREE.Color);

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
    // At the edge: it stands, breathes, opens its arms and lifts its chest toward the light,
    // then sinks into a crouch with the arms swung back, and springs out over the portal.
    const prepMix = smooth((t - (WALK1 + 1.2)) / 2.4) * (1 - smooth((t - (EDGE1 - 0.9)) / 0.6));
    const crouchMix = smooth((t - (EDGE1 - 1.1)) / 0.8) * (1 - smooth((t - (EDGE1 + 0.05)) / 0.45));
    figY -= crouchMix * 0.09;
    // the spring: a lift off the floor as the legs extend
    if (t >= EDGE1 && t < EDGE1 + 1.4) figY += Math.sin(Math.PI * (t - EDGE1) / 1.4) * 0.35;
    fig.position.set(0, figY, figZ);
    fig.rotation.set(0, Math.PI, 0);
    if (figTilt > 0) { fig.rotation.x = -figTilt; fig.position.y += Math.sin(Math.min(figTilt, Math.PI) / 2) * 1.0; }
    if (t >= FALL1) {
      // a weightless drift: the long axis sways slowly, the body turns about it
      const tf = t - FALL1, e = smooth(tf / 8);
      fig.rotation.x = -Math.PI + e * (0.2 * Math.sin(tf * 0.13) + 0.08 * Math.sin(tf * 0.31 + 1.1));
      fig.rotation.y = Math.PI + tf * 0.1 + e * 0.5 * Math.sin(tf * 0.05);
      fig.rotation.z = e * (0.16 * Math.sin(tf * 0.09 + 1.0) + 0.05 * Math.sin(tf * 0.27));
    }
    if (this.rig) {
      const r: RootMotion = { x: 0, y: 0, z: 0, yaw: 0 };
      if (this.walk) { this.walk.mocapSpeed = WALK_RATE; sample(this.walk, t - WALK0, this.tmpA, r); } else for (const k in this.tmpA) delete this.tmpA[k];
      if (this.idle) sample(this.idle, T, this.tmpB, r); else for (const k in this.tmpB) delete this.tmpB[k];
      // walk -> stand eased over a stride, stand -> dive over the fall's first seconds
      const standMix = t < WALK0 ? 1 : t < WALK1 - 1.0 ? 0 : smooth((t - (WALK1 - 1.0)) / 1.4);
      // In the fall the body moves through a slow cycle of shapes: the swan, a wide star,
      // arms streamlined toward the depths, a loose half-curl, back to the swan.
      let divePose = DeepDive.DIVE;
      if (t >= FALL1) {
        const cyc = [DeepDive.DIVE, DeepDive.STAR, DeepDive.REACH, DeepDive.CURL], HOLD = 19, BL = 7;
        const tf = t - FALL1, i = Math.floor(tf / HOLD), w = smooth(((tf % HOLD) - (HOLD - BL)) / BL);
        divePose = blend(this.tmpC, [{ pose: cyc[i % 4], w: 1 - w }, { pose: cyc[(i + 1) % 4], w }]);
      }
      blend(this.pose, [
        { pose: this.tmpA, w: (walking || t < WALK1 + 0.5 ? 1 - standMix : 0) * (1 - diveMix) + 1e-6 },
        { pose: this.tmpB, w: standMix * (1 - diveMix) * (1 - prepMix) * (1 - crouchMix) },
        { pose: DeepDive.PREP, w: prepMix * (1 - diveMix) * (1 - crouchMix) },
        { pose: DeepDive.CROUCH, w: crouchMix * (1 - diveMix) },
        { pose: divePose, w: diveMix }]);
      // drifting while it falls: arms float, legs part a little, slow and uneven
      if (diveMix > 0.01) {
        const add = (k: string, x: number, y: number, z: number) => { const o = this.pose[k] ?? (this.pose[k] = [0, 0, 0]); o[0] += x * diveMix; o[1] += y * diveMix; o[2] += z * diveMix; };
        // the captured walk's wrist bend must not carry into the dive
        for (const h of ["hand_l", "hand_r"]) { const o = this.pose[h]; if (o) { o[0] *= 1 - diveMix; o[1] *= 1 - diveMix; o[2] *= 1 - diveMix; } }
        const s1 = Math.sin(T * 0.55), s2 = Math.sin(T * 0.43 + 1.3), s3 = Math.sin(T * 0.31 + 2.1);
        add("upperarm_l", s1 * 6, 0, s2 * 9); add("upperarm_r", -s2 * 5, 0, -s1 * 9);
        add("lowerarm_l", s3 * 5, 0, 0); add("lowerarm_r", -s1 * 5, 0, 0);
        add("hand_l", 0, 0, s2 * 6); add("hand_r", 0, 0, -s3 * 6);
        add("thigh_l", s3 * 4, 0, -2 - s1 * 2); add("thigh_r", -s3 * 4, 0, 2 + s2 * 2);
        add("calf_l", Math.max(0, s2) * 6, 0, 0); add("calf_r", Math.max(0, s1) * 6, 0, 0);
        add("spine_02", s1 * 2, s2 * 2, 0); add("head", s3 * 3, s1 * 4, 0);
      }
      // breathing at the edge: the chest rises and falls
      if (prepMix > 0.01) { const br = Math.sin(T * 1.4) * prepMix; const o = this.pose.spine_03 ?? (this.pose.spine_03 = [0, 0, 0]); o[0] -= br * 2.5; }
      this.rig.apply(this.pose);
    }
    // footfalls: a sole reaching the floor fires a pulse there
    if (this.body && walking || (this.body && t < WALK1 + 1)) this.footsteps(T, fig);
    // the spring off the edge leaves a shock on the floor
    if (this.body && t >= EDGE1 && this.lastT < EDGE1 && t - this.lastT < 1) { const s = this.u.uSteps.value as THREE.Vector4[]; s[this.stepIdx++ % 4].set(0, zEdge - 0.2, T, 1.5); }

    (u.uFocus.value as THREE.Vector3).set(fig.position.x, fig.position.y + (figTilt > 1.5 ? -1 : 1), fig.position.z);
    // ---- camera
    const figPos = fig.position;
    const pos = this._cp.set(0, 0, 0), look = this._cl.set(0, 0, 0);
    let fov = 52, roll = 0;
    if (t < WALK1) {
      // behind and a little to the side, a slow arc round as it walks
      const k = (t - WALK0) / (WALK1 - WALK0);
      pos.set(lerp(1.6, 0.4, smooth(k)) + Math.sin(k * 2.4) * 0.5, lerp(2.4, 2.0, k), figZ + lerp(9.0, 6.2, smooth(k)));
      look.set(0, lerp(2.6, 1.8, k), figZ - 9);
      roll = -0.03 * Math.sin(k * 2.4);
    } else if (t < EDGE1) {
      // round to the side and up: the figure at the rim, the portal opening at its feet
      const k = smooth((t - WALK1) / (EDGE1 - WALK1));
      pos.set(lerp(0.4, 4.6, k), lerp(2.0, 3.2, k) + smooth((t - (EDGE1 - 1.6)) / 1.6) * 1.6, lerp(zEdge + 6.2, zEdge + 4.4, k));
      look.set(0, lerp(1.8, 0.7, k), lerp(zEdge - 9, zEdge - (cam.aspect < 0.8 ? 0.3 : 1.4), k));
      fov = lerp(52, 48, k);
      roll = 0.04 * k;
    } else if (t < FALL1 + 4) {
      // The leap: the camera cranes up overhead as the body arcs out over the opening, then
      // drops through the portal after it, finishing directly above it looking down into
      // the depths — where the first view of the fall begins.
      const k = smooth((t - EDGE1) / (FALL1 + 4 - EDGE1));
      const F = this._cf.set(0, figPos.y - 0.9, figPos.z);
      const bz = (a: number, c1: number, c2: number, d: number) => { const m = 1 - k; return m * m * m * a + 3 * m * m * k * c1 + 3 * m * k * k * c2 + k * k * k * d; };
      const s0 = this.shot(0, 0, 0);
      pos.set(bz(4.6, 3.6, 1.0, Math.sin(s0.th) * s0.r), bz(4.0, 8.5, 9.0, s0.y), bz(4.4, 3.0, 1.4, Math.cos(s0.th) * s0.r)).add(F);
      const under = smooth((-F.y - 0.2) / 1.8) * (1 - smooth((-pos.y - 10) / 6));
      const rr = Math.hypot(pos.x, pos.z), maxR = lerp(99, PORTAL_R - 1.0, under);
      if (rr > maxR) { pos.x *= maxR / rr; pos.z *= maxR / rr; }
      look.set(0, lerp(0.5, s0.ly, smooth((k - 0.35) / 0.65)), 0).add(F);
      fov = lerp(48, s0.f, k);
      roll = lerp(0.04, 0, k);
    } else {
      // Six ways of watching the fall, each held ~28 s with a slow move inside it, crossfaded
      // over 7 s in cylindrical coordinates round the diver so the camera swings round the
      // body and never cuts through it.
      const tf = t - (FALL1 + 4), F = this._cf.set(0, figPos.y - 0.9, figPos.z);
      const HOLD = 28, BLEND = 7, idx = Math.floor(tf / HOLD), within = tf - idx * HOLD;
      const A = this.shot(idx, within / HOLD, tf), B = this.shot(idx + 1, 0, tf), b = smooth((within - (HOLD - BLEND)) / BLEND);
      let dth = B.th - A.th; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      const th = A.th + dth * b, y = lerp(A.y, B.y, b);
      // (a crossfade between a view from above and one from below swings wide round the body)
      const r = lerp(A.r, B.r, b) + Math.sin(Math.PI * b) * Math.min(3, Math.abs(A.y - B.y) * 0.35);
      pos.set(Math.sin(th) * r, y, Math.cos(th) * r).add(F);
      look.set(0, lerp(A.ly, B.ly, b), 0).add(F);
      fov = lerp(A.f, B.f, b); roll = lerp(A.roll, B.roll, b);
    }
    // a living, hand-held camera: slow layered drift, never a shake
    const hh = smooth(t / 3) * (t >= FALL1 ? 1 : 0.5);
    pos.x += hh * (Math.sin(T * 0.37) * 0.14 + Math.sin(T * 0.91 + 1.3) * 0.04);
    pos.y += hh * (Math.sin(T * 0.29 + 0.7) * 0.10 + Math.sin(T * 0.83) * 0.03);
    pos.z += hh * (Math.sin(T * 0.33 + 2.1) * 0.14 + Math.sin(T * 0.77 + 0.4) * 0.04);
    look.x += hh * Math.sin(T * 0.23 + 0.5) * 0.08; look.y += hh * Math.sin(T * 0.19) * 0.06;
    roll += hh * Math.sin(T * 0.17 + 0.9) * 0.012;
    // eased camera: no jitter, even across the crossfades
    if (!this.camInit || Math.abs(t - this.lastT) > 1) { this.camPos.copy(pos); this.camLook.copy(look); this.camRoll = roll; this.camInit = true; }
    this.lastT = t;
    const kc = 1 - Math.exp(-dt * 3.0);
    this.camPos.lerp(pos, kc); this.camLook.lerp(look, kc); this.camRoll += (roll - this.camRoll) * kc;
    this.placeCam(dt);
    // (very wide, short frames — phones held sideways — draw in closer so the figure reads)
    fov *= cam.aspect > 1.9 ? 0.8 : 1;
    // the lens breathes with the kick drum, a hair
    fov -= (u.uBeat.value as number) * 0.6 * (t >= FALL1 ? 1 : 0.4);
    cam.fov += (fov - cam.fov) * kc; cam.updateProjectionMatrix();

    // ---- the figure's light: a heart in the chest, light thrown on the hall
    const mood = u.uMood.value as THREE.Color;
    if (this.heart && this.heartBone) {
      this.heartBone.getWorldPosition(this.heart.position);
      const pulse = 0.75 + 0.25 * Math.sin(T * 2.2) + (u.uBeat.value as number) * 0.5;
      this.heart.scale.setScalar(0.5 + pulse * 0.25);
      this.heart.material.color.copy(mood).multiplyScalar(1.6).addScalar(0.35).multiplyScalar(0.45 * pulse);
    }
    this.keyLight.color.copy(mood); this.keyLight.intensity = (90 + (u.uEnergy.value as number) * 120 + (u.uBeat.value as number) * 60) * (1 - smooth((t - EDGE1) / 6));
    this.figLight.color.copy(mood); this.figLight.position.copy(fig.position).add(this._fv.set(0, figTilt > 1.5 ? -0.8 : 1.2, 0));
    this.figLight.intensity = 26 + (u.uEnergy.value as number) * 40;

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
    // how deep: grows over the first four minutes of the fall (darker, the light above dwindling)
    (u.uDeep.value as number) = smooth(fallT / 240);
    // Nine worlds, ~60 s each: the ring tunnel always opens the fall, the rest come in an
    // order shuffled afresh on every pass of the take, never the same one twice running.
    const ERA = 60, EB = 14, ei = Math.floor(fallT / ERA), eb = smooth(((fallT % ERA) - (ERA - EB)) / EB);
    const order = this.worldOrder(Math.floor(T / LOOP));
    const ew: number[] = new Array(Worlds.COUNT).fill(0); ew[order[ei % order.length]] = 1 - eb; ew[order[(ei + 1) % order.length]] += eb;
    if (!diving) { ew.fill(0); ew[0] = 1; }
    // the ribbed rings open out and away when their world ends
    this.tunnelSegs.forEach(sg => sg.scale.setScalar(1 + (1 - ew[0]) * 1.6));
    this.tunnel.visible = ew[0] > 0.01;
    this.worlds.update(T, camY, this.tunnelScroll, smooth((camY + 4) / 6), ew);
    // the depths open round the camera once it is under the floor
    this.sky.update(cam.position, 1 - smooth((camY + 3) / 5), fallSpeed, this.tunnelScroll);
    this.snow.update(cam.position, fallSpeed, 1 - smooth((camY + 2) / 4), dt);
    // embers: drifting up off the shoulders as it walks, a comet's tail once it falls
    this.embers.update(dt, this.emitters, diving ? 80 + (u.uEnergy.value as number) * 60 : walking || t < EDGE1 ? 28 : 0,
      diving ? fallSpeed * 0.9 + 1.2 : 0.45, diving ? 0.9 : 0.25);

    this.post(t, LOOP, dt, true);
    this.pace(gap, performance.now() - cpu0);
  };

  /** Watch the frame pace over 2 s windows. When most frames come late (under ~50 fps) and
   *  the script's own share of the frame is small (the GPU is what is slow), take a quarter
   *  off the pixel ratio, down to `prMin`. Stalls (compiles, a busy tab) do not count. */
  private pace(gap: number, cpu: number) {
    const L = this.late, now = performance.now();
    if (!L.since) L.since = now;
    if (gap <= 0 || gap > 100) return;
    L.n++; L.cpu += cpu; if (gap > 20.5) L.slow++;
    if (now - L.since < 2000) return;
    const slow = L.n >= 30 && L.slow / L.n > 0.6, cpuBound = L.cpu / L.n > 9;
    // (the first seconds of a take compile its shaders: ignore them)
    if (slow && !cpuBound && now - this.t0 > 4000 && this.pr > this.prMin + 0.01) {
      this.pr = Math.max(this.prMin, this.pr - 0.25);
      this.renderer.setPixelRatio(this.pr); this.syncPointScale();
      this.resize();
    }
    L.n = 0; L.slow = 0; L.cpu = 0; L.since = now;
  }

  private _order: { pass: number; list: number[] } = { pass: -1, list: [] };
  /** The fall's worlds for this pass: 0 (the tunnel) first, then the others shuffled with a
   *  seed per pass (so a pass keeps its order and each pass differs). */
  private worldOrder(pass: number) {
    if (this._order.pass === pass) return this._order.list;
    let seed = (Math.imul(pass + 1, 2654435761) + 12345) >>> 0;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const rest = Array.from({ length: Worlds.COUNT - 1 }, (_, i) => i + 1);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this._order = { pass, list: [0, ...rest] };
    return this._order.list;
  }

  // ---- the viewer's own camera: orbit, zoom and pan on top of the take's camera
  private userT = { yaw: 0, pitch: 0, zoom: 1, px: 0, py: 0 };
  private userV = { yaw: 0, pitch: 0, zoom: 1, px: 0, py: 0 };
  private _sph = new THREE.Spherical(); private _off = new THREE.Vector3(); private _lk = new THREE.Vector3();
  private _rt = new THREE.Vector3(); private _upv = new THREE.Vector3();
  /** Turn round the subject: `dx` left/right, `dy` up/down (radians). */
  userOrbit(dx: number, dy: number) { const t = this.userT; t.yaw += dx; t.pitch = Math.max(-1.3, Math.min(1.3, t.pitch + dy)); }
  /** Closer (< 1) or further (> 1). */
  userZoom(f: number) { const t = this.userT; t.zoom = Math.max(0.3, Math.min(3.2, t.zoom * f)); }
  /** Slide the view: `dx`, `dy` in fractions of the subject's distance. */
  userPan(dx: number, dy: number) { const t = this.userT; t.px = Math.max(-1.5, Math.min(1.5, t.px + dx)); t.py = Math.max(-1.5, Math.min(1.5, t.py + dy)); }
  userReset() { Object.assign(this.userT, { yaw: 0, pitch: 0, zoom: 1, px: 0, py: 0 }); }
  /** Put the camera where the take wants it, then apply the viewer's orbit, zoom and pan
   *  (eased, so a drag glides). */
  private placeCam(dt: number) {
    const cam = this.camera, v = this.userV, t = this.userT, k = 1 - Math.exp(-dt * 8);
    v.yaw += (t.yaw - v.yaw) * k; v.pitch += (t.pitch - v.pitch) * k; v.zoom += (t.zoom - v.zoom) * k; v.px += (t.px - v.px) * k; v.py += (t.py - v.py) * k;
    const idle = Math.abs(v.yaw) + Math.abs(v.pitch) + Math.abs(v.zoom - 1) + Math.abs(v.px) + Math.abs(v.py) < 1e-4;
    if (idle) { cam.position.copy(this.camPos); cam.lookAt(this.camLook); cam.rotateZ(this.camRoll); return; }
    const off = this._off.subVectors(this.camPos, this.camLook), s = this._sph.setFromVector3(off);
    s.theta += v.yaw; s.phi = Math.max(0.06, Math.min(Math.PI - 0.06, s.phi - v.pitch)); s.radius *= v.zoom;
    off.setFromSpherical(s);
    // pan along the view's own right and up
    const right = this._rt.crossVectors(this._upv.set(0, 1, 0), off).normalize(), up = this._upv.crossVectors(off, right).normalize();
    const look = this._lk.copy(this.camLook).addScaledVector(right, v.px * s.radius).addScaledVector(up, v.py * s.radius);
    cam.position.copy(look).add(off); cam.lookAt(look); cam.rotateZ(this.camRoll * (1 - Math.min(1, Math.abs(v.pitch))));
  }

  /** The take's end: the loop flare, the pulse patterns, bloom and exposure, and the render. */
  private post(t: number, loop: number, dt: number, endFlare: boolean) {
    const u = this.u, T = u.uTime.value as number;
    // ---- the loop flare: grows over the last 10 s, flashes, then the walk fades back in
    // (the rally take loops seamlessly from meditation to meditation: only its opening fades in)
    const flare = Math.max(endFlare ? smooth((t - (loop - 9)) / 8) * 0.9 + (t > loop - 1.2 ? smooth((t - (loop - 1.2)) / 1.0) * 0.1 : 0) : 0, (endFlare || T < loop ? 1 : 0) * (1 - smooth(t / 2.2)));
    u.uFlare.value = flare;
    // pulse patterns take turns every 16 s, each fading into the next
    { const ph = T / 16, i = Math.floor(ph) % 4, b = smooth((ph % 1 - 0.7) / 0.3), w = [0, 0, 0, 0]; w[i] = 1 - b; w[(i + 1) % 4] += b; (u.uW.value as THREE.Vector4).set(w[0], w[1], w[2], w[3]); }
    this.bloom.strength = 0.9 + (u.uBeat.value as number) * 0.55 + (u.uEnergy.value as number) * 0.35 + flare * 1.2;
    this.renderer.toneMappingExposure = (0.88 + (u.uEnergy.value as number) * 0.12 + (u.uBeat.value as number) * 0.08) * (1 - 0.2 * (u.uDeep.value as number));
    this.composer.render(dt);
  }

  // ------------------------------------------------------------------ the rally take
  // Lotus, sitting in the air over the portal: thighs out and forward, shins crossed in
  // front, hands resting on the thighs, the head a little bowed. (Solved for this rig's rest
  // directions; joint conventions in pose.ts.)
  // the wrist bent back so the palm faces up (measured on this rig: see palmAt)
  static PALM_UP: [number, number, number] = [-30, -90, -30];
  private static LOTUS: Pose = {
    // full lotus: thighs out and forward along the floor, shins crossed in front, each foot
    // stretched along its shin onto the other thigh, sole to the sky (solved for this rig's
    // rest directions). The deep turn of the hips thins their skin: see legFill.
    // (knees drawn in toward the body and the ankles tucked up into the other groin)
    thigh_l: [34.8, 126.2, -81.2], thigh_r: [15.3, -120.5, 81.2], calf_l: [152, 0, 0], calf_r: [143, 0, 0],
    foot_l: [73, 115, -11], foot_r: [74, -104, 2],
    // hands resting on the thighs, elbows soft
    upperarm_l: [6, -22, -23], upperarm_r: [6, 22, 23], lowerarm_l: [-10, 0, 0], lowerarm_r: [-10, 0, 0],
    spine_01: [-2, 0, 0], spine_02: [-2, 0, 0], neck: [4, 0, 0], head: [12, 0, 0],
  };
  // ... the right arm raised straight up over the shoulder to the sky, the face lifted to it
  private static RAISE: Pose = {
    ...DeepDive.LOTUS,
    upperarm_r: [6, -78, -138], lowerarm_r: [90, 40, 0], clavicle_r: [0, 0, -12], hand_r: DeepDive.PALM_UP,
    spine_02: [-4, 0, 0], spine_03: [-5, 0, 0], neck: [-8, 0, 0], head: [-16, 0, 0],
  };
  // ... at +5 % and more, both arms raised to the sky, palms up
  private static RAISE2: Pose = {
    ...DeepDive.RAISE,
    upperarm_l: [6, 78, 138], lowerarm_l: [90, -40, 0], clavicle_l: [0, 0, 12], hand_l: [-30, 90, 30],
    head: [-20, 0, 0],
  };
  /** The rally take's views round the seated figure (th from its front, +z; y and ly from the chest). */
  /** The rally take's views: straight on, centred on the figure, wide (the whole cave), one
   *  lens; the camera only tilts up to follow the beam and settles back. th 0 = in front (+z). */
  private static RISE_SHOTS: { at: number; s: (q: number) => { r: number; th: number; y: number; ly: number; f: number; roll: number } }[] = [
    // the figure meditating in the middle of the cave
    { at: 0, s: () => ({ r: 26, th: 0, y: 3.4, ly: 1.4, f: 50, roll: 0 }) },
    // the arm goes up, the beam leaves the palm: the view tilts up with it
    { at: 6, s: q => ({ r: 26, th: 0, y: 3.4, ly: lerp(1.4, 5, smooth(q)), f: 50, roll: 0 }) },
    // held while the light spreads over the canopy and the gold and silver rain down
    { at: 14, s: () => ({ r: 26, th: 0, y: 3.4, ly: 5, f: 50, roll: 0 }) },
    // the arm comes down: back to the meditation
    { at: 50, s: q => ({ r: 26, th: 0, y: 3.4, ly: lerp(5, 1.4, smooth(q)), f: 50, roll: 0 }) },
  ];
  private _red = new THREE.Color(1.1, 0.075, 0.045);
  /** Seated, the skin round a deeply bent and turned hip thins (linear-blend skinning): fill
   *  it out by widening the thighs' cross-section (bone Y runs along the bone), and give the
   *  calves the inverse so the shins keep their shape. X, the knee's hinge axis, takes most
   *  of it (exact through the bend); Z a little (it shears slightly through the bent knee). */
  private riseLift?: number;
  private skin?: THREE.SkinnedMesh;
  /** Per vertex of the body: which thigh it shares with the pelvis (1 left, 2 right), its rest
   *  distance from that thigh's axis, and how far the fix applies (most where the weights are
   *  split evenly between the two). Measured on the rest pose, in the mesh's own space. */
  private buildThighFix(root: THREE.Object3D) {
    let mesh: THREE.SkinnedMesh | undefined;
    root.traverse(o => { const m = o as THREE.SkinnedMesh; if (!mesh && m.isSkinnedMesh && (m.material as THREE.Material).blending !== THREE.AdditiveBlending) mesh = m; });
    if (!mesh || !this.rig) return;
    this.skin = mesh;
    root.updateMatrixWorld(true); mesh.skeleton.update();
    const g = mesh.geometry, n = g.attributes.position.count, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const names = mesh.skeleton.bones.map(b => b.name);
    const axis = (side: string) => {
      const a = mesh!.worldToLocal(this.rig!.bones.get(`thigh_${side}`)!.getWorldPosition(new THREE.Vector3()));
      const b = mesh!.worldToLocal(this.rig!.bones.get(`calf_${side}`)!.getWorldPosition(new THREE.Vector3()));
      return { a, d: b.sub(a).normalize() };
    };
    const ax = { l: axis("l"), r: axis("r") };
    const fix = new Float32Array(n * 3), v = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      let wl = 0, wr = 0;
      for (let k = 0; k < 4; k++) { const nm = names[si.getComponent(i, k)], w = sw.getComponent(i, k); if (nm === "thigh_l") wl += w; else if (nm === "thigh_r") wr += w; }
      const wt = Math.max(wl, wr);
      if (wt < 0.03 || wt > 0.985) continue;
      const side = wl >= wr ? ax.l : ax.r;
      mesh.getVertexPosition(i, v);
      t.copy(v).sub(side.a); const along = t.dot(side.d); t.addScaledVector(side.d, -along);
      fix[i * 3] = wl >= wr ? 1 : 2; fix[i * 3 + 1] = t.length(); fix[i * 3 + 2] = Math.min(1, 4 * wt * (1 - wt) * 1.3);
    }
    g.setAttribute("aFix", new THREE.BufferAttribute(fix, 3));
  }
  /** The thighs' current axes, in the mesh's space, for the fix in the vertex shader. */
  private updateThighFix(on: boolean) {
    (this.u.uFixOn.value as number) = on ? 1 : 0;
    if (!on || !this.skin || !this.rig) return;
    for (const [side, hu, du] of [["l", "uHipL", "uDirL"], ["r", "uHipR", "uDirR"]] as const) {
      const a = this.skin.worldToLocal(this.rig.bones.get(`thigh_${side}`)!.getWorldPosition(this._v2.set(0, 0, 0)));
      (this.u[hu].value as THREE.Vector3).copy(a);
      const b = this.skin.worldToLocal(this.rig.bones.get(`calf_${side}`)!.getWorldPosition(this._fv2.set(0, 0, 0)));
      (this.u[du].value as THREE.Vector3).copy(b).sub(a).normalize();
    }
  }
  private _fv2 = new THREE.Vector3();
  private legFill(k: number) {
    if (!this.rig) return;
    const sx = 1 + 0.36 * k, sz = 1 + 0.18 * k;
    for (const side of ["l", "r"]) {
      this.rig.bones.get(`thigh_${side}`)?.scale.set(sx, 1, sz);
      this.rig.bones.get(`calf_${side}`)?.scale.set(1 / sx, 1, 1 / sz);
    }
  }
  private handDir?: THREE.Vector3; private handDirL?: THREE.Vector3; private _q = new THREE.Quaternion(); private _fvL = new THREE.Vector3();
  /** The middle of the palm: from the wrist, along the hand, a little off its back. */
  private palmAt(hand: THREE.Object3D, out: THREE.Vector3, dir = this.handDir) {
    hand.getWorldPosition(out);
    if (dir) out.addScaledVector(this._v2.copy(dir).applyQuaternion(hand.getWorldQuaternion(this._q)), 0.075);
    out.y += 0.02;
    return out;
  }
  private _v2 = new THREE.Vector3();

  private riseFrame(T: number, dt: number) {
    const t = T % RISE_LOOP, u = this.u, fig = this.figure, cam = this.camera;
    const MED1 = 5.5, RAISE1 = 7.3, BEAM0 = 7.1, BEAM_END = 50, LOWER0 = 51.5, LOWER1 = 54.5;
    const raise = smooth((t - MED1) / (RAISE1 - MED1)) * (1 - smooth((t - LOWER0) / (LOWER1 - LOWER0)));
    // seated on the cave floor (the sit bones ~14 cm under the hip joints), just beyond the pool
    // (twice life size and more: a colossal figure, read from across the cavern)
    const S = 2.8, pelvisY = 0.14 * S;
    const strong = this.risePct >= 5;
    fig.scale.setScalar(S);
    fig.position.set(0, pelvisY - this.pelvisH * S + (this.riseLift ?? 0), RISE_Z);
    fig.rotation.set(0, 0, 0);
    if (this.rig) {
      blend(this.pose, [{ pose: DeepDive.LOTUS, w: 1 - raise + 1e-6 }, { pose: strong ? DeepDive.RAISE2 : DeepDive.RAISE, w: raise }]);
      // slow breathing, deeper in meditation; the raised arm reaches a little higher on the beat
      const br = Math.sin(T * 1.1) * (1 - raise * 0.5);
      const add = (k: string, x: number, y: number, z: number) => { const o = this.pose[k] ?? (this.pose[k] = [0, 0, 0]); o[0] += x; o[1] += y; o[2] += z; };
      add("spine_03", -br * 2.2, 0, 0); add("spine_02", -br * 1.2, 0, 0); add("head", br * 1.5, Math.sin(T * 0.21) * 2 * (1 - raise), 0);
      add("clavicle_r", 0, 0, -raise * (u.uBeat.value as number) * 3);
      if (strong) add("clavicle_l", 0, 0, raise * (u.uBeat.value as number) * 3);
      this.rig.apply(this.pose);
      this.legFill(1);
      fig.updateMatrixWorld(true); this.updateThighFix(true);
      // Sit it ON the floor: measure the posed skin's lowest point once and lift the body so
      // it rests there (without this the buttocks and shins sank under the floor and vanished).
      if (this.riseLift === undefined && this.body) {
        let mesh: THREE.SkinnedMesh | undefined;
        this.body.traverse(o => { const m = o as THREE.SkinnedMesh; if (!mesh && m.isSkinnedMesh) mesh = m; });
        if (mesh) {
          fig.updateMatrixWorld(true); mesh.skeleton.update();
          const v = this._v2, n = mesh.geometry.attributes.position.count; let min = Infinity;
          for (let i = 0; i < n; i += 2) { mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld); if (v.y < min) min = v.y; }
          this.riseLift = Number.isFinite(min) ? 0.01 - min : 0;
          fig.position.y += this.riseLift;
        }
      }
    }
    const chest = this._cf.set(0, pelvisY + 0.45 * S + (this.riseLift ?? 0), RISE_Z);
    (u.uFocus.value as THREE.Vector3).copy(chest);

    // ---- the beam and the rain
    const hand = this.rig?.bones.get("hand_r");
    if (hand) { fig.updateMatrixWorld(true); this.palmAt(hand, this._fv); }
    const handL = this.rig?.bones.get("hand_l");
    if (handL) this.palmAt(handL, this._fvL, this.handDirL);
    const beamAge = t - BEAM0, beamVis = (t >= BEAM0 ? 1 : 0) * (1 - smooth((t - BEAM_END) / 1.6));
    // the figure flushes red as it fires, and cools back to the hall's blue when the beam ends
    const figRed = smooth((t - (BEAM0 - 0.7)) / 1.0) * (1 - smooth((t - BEAM_END) / 2.5));
    (u.uFigMood.value as THREE.Color).copy(u.uMood.value as THREE.Color).lerp(this._red, figRed);
    // (+5 % and more: two beams, each twice as thick and twice as bright; after ~5 s they bend
    // in to meet above the head and go on as one beam, twice as thick again)
    const beat = u.uBeat.value as number;
    // (the glow round them held back, so the cores read and the hall is not washed out)
    this.beam.setPower(strong ? 1.3 : 1, strong ? 1.3 : 1, strong ? 0.55 : 1); this.beamL.setPower(1.3, 1.3, 0.55); this.beamM.setPower(2, 1.4, 0.5);
    const MERGE0 = 5, mk = strong ? smooth((beamAge - MERGE0) / 1.2) : 0;
    if (mk > 0) {
      const mid = this._mid.addVectors(this._fv, this._fvL).multiplyScalar(0.5);
      // (they meet just in front of the wrists and leave as one from there)
      mid.y += 0.35;
      // each side beam's end swings from the vault in to the meeting point
      this._tR.set(this._fv.x, CEILING + 26, this._fv.z).lerp(mid, mk); this._tL.set(this._fvL.x, CEILING + 26, this._fvL.z).lerp(mid, mk);
      this.beam.update(this._fv, beamAge, beamVis, beat, this._tR);
      this.beamL.update(this._fvL, beamAge, beamVis, beat, this._tL);
      this.beamM.update(mid, beamAge - MERGE0 - 0.6, beamVis * mk, beat);
    } else {
      this.beam.update(this._fv, beamAge, beamVis, beat);
      this.beamL.update(this._fvL, strong ? beamAge : -1, beamVis, beat);
      this.beamM.update(this._fv, -1, 0, 0);
    }
    // (the red beam takes the place of the pale light shaft while it burns)
    this.shaftVis.value = 1 - 0.85 * smooth((t - BEAM0) / 1.5) * (1 - smooth((t - BEAM_END) / 3));
    if (t >= BEAM0 && this.lastT < BEAM0 && t - this.lastT < 1) { const s = u.uSteps.value as THREE.Vector4[]; s[this.stepIdx++ % 4].set(0, RISE_Z, T, 2.2); }
    // the light meets the canopy ~0.55 s after leaving the hand, spreads, and the drops it
    // beads there fall as gold and silver rain
    { const strikeAt = strong && mk > 0.5 ? this._mid : strong ? this._v2.addVectors(this._fv, this._fvL).multiplyScalar(0.5) : this._fv;
      this.canopy.update(strikeAt, beamAge - 0.55, beamVis); }
    this.gold.update(t - (BEAM0 + 0.55), 1 - smooth((t - 53) / 6), dt);

    // ---- camera
    const sh = DeepDive.RISE_SHOTS, BL = 3;
    let i = sh.length - 1; while (i > 0 && sh[i].at > t) i--;
    const end = i + 1 < sh.length ? sh[i + 1].at : RISE_LOOP, nextS = i + 1 < sh.length ? sh[i + 1] : sh[0];
    const A = sh[i].s((t - sh[i].at) / (end - sh[i].at)), B = nextS.s(0), b = smooth((t - (end - BL)) / BL);
    let dth = B.th - A.th; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    const th = A.th + dth * b, r = lerp(A.r, B.r, b) + Math.sin(Math.PI * b) * Math.min(3, Math.abs(A.y - B.y) * 0.3);
    const pos = this._cp.set(Math.sin(th) * r, lerp(A.y, B.y, b), Math.cos(th) * r).add(chest);
    const look = this._cl.set(0, lerp(A.ly, B.ly, b), 0).add(chest);
    let fov = lerp(A.f, B.f, b), roll = lerp(A.roll, B.roll, b);
    pos.y = Math.max(0.35, pos.y);

    pos.y += Math.sin(T * 0.29 + 0.7) * 0.08;
    pos.z += Math.sin(T * 0.33 + 2.1) * 0.12;
    look.y += Math.sin(T * 0.19) * 0.03;

    if (!this.camInit || Math.abs(t - this.lastT) > 1 && Math.abs(t - this.lastT) < RISE_LOOP - 1) { this.camPos.copy(pos); this.camLook.copy(look); this.camRoll = roll; this.camInit = true; }
    this.lastT = t;
    const kc = 1 - Math.exp(-dt * 2.6);
    this.camPos.lerp(pos, kc); this.camLook.lerp(look, kc); this.camRoll += (roll - this.camRoll) * kc;
    this.placeCam(dt);
    fov *= cam.aspect > 1.9 ? 0.8 : 1;
    fov -= (u.uBeat.value as number) * 0.5;
    cam.fov += (fov - cam.fov) * kc; cam.updateProjectionMatrix();

    // ---- light
    const mood = u.uMood.value as THREE.Color;
    if (this.heart && this.heartBone) {
      this.heartBone.getWorldPosition(this.heart.position);
      const pulse = 0.75 + 0.25 * Math.sin(T * 1.1) + (u.uBeat.value as number) * 0.4;
      this.heart.scale.setScalar(0.55 + pulse * 0.3);
      this.heart.material.color.copy(u.uFigMood.value as THREE.Color).multiplyScalar(1.6).addScalar(0.35).multiplyScalar(0.5 * pulse);
    }
    this.keyLight.color.copy(mood); this.keyLight.intensity = 90 + (u.uEnergy.value as number) * 120 + (u.uBeat.value as number) * 60;
    this.figLight.color.copy(mood).lerp(this._red, beamVis * 0.8);
    this.figLight.position.copy(beamVis > 0.01 ? (strong ? this._v2.copy(this._fv).add(this._fvL).multiplyScalar(0.5) : this._fv) : chest);
    this.figLight.intensity = 26 + (u.uEnergy.value as number) * 40 + beamVis * 60;

    // ---- the hall only: no tunnel, no depths
    for (const s of this.tunnelSegs) s.visible = false;
    this.tunnel.visible = false;
    // no pool: the floor is whole, the figure sits in the middle of it
    if (this.abyss) this.abyss.visible = false;
    (u.uHole.value as number) = 0; for (const o of this.portalParts) o.visible = false;
    // (the gold takes the place of the hall's coloured rain)
    this.rain.visible = false;
    this.worlds.update(T, cam.position.y, 0, 0, [1, 0, 0, 0, 0, 0, 0, 0, 0]);
    this.chamber.visible = false; this.cave.update(true, beamVis, T);
    this.caveSun.intensity = 1.1; this.caveFill.intensity = 0.22;
    this.sky.update(cam.position, 0, 0, 0); this.snow.update(cam.position, 0, 0, dt); (u.uDeep.value as number) = 0;
    this.embers.update(dt, this.emitters, 16 + beamVis * 20, 0.35 + beamVis * 0.4, 0.2);
  }
}

