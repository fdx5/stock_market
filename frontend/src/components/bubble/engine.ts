import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { LABEL_H, LABEL_W, LabelData, drawLabel, logoPalette, monogramCanvas, transparentLogo } from "./assets";
import { FLOOR_FRAG, FLOOR_VERT, HALO_FRAG, HALO_VERT, SKY_FRAG, SKY_VERT, SPHERE_FRAG, SPHERE_VERT, STAR_FRAG, STAR_VERT } from "./shaders";

/* The 증시버블 observatory — one engine, one loop.
 *
 * The old page ran three requestAnimationFrame loops (physics, WebGL, a 2D spark
 * canvas), rendered each sphere with a transmission material (a second scene render
 * per frame) through full-resolution bloom and SMAA, and moved twenty DOM buttons —
 * with backdrop blur, masks and blend modes — every frame. Here:
 *  - physics, picking, labels and rendering share one loop, and stop when the tab is
 *    hidden or the stage is off screen;
 *  - each sphere is one custom shader pass; labels are sprites drawn once per quote;
 *  - no DOM is touched per frame except one hover card, and only while hovering;
 *  - quality adapts: a GPU tier is picked at start, then the render scale steps down
 *    (or bloom switches off) when frames run long, and back up when there is room. */

export interface BubbleDatum {
  key: string;
  code: string;
  rank: number;
  name: string;
  sector: string;
  cap: number;
  changePct: number;
  price: string;
  capText: string | null;
  logoUrl: string;
}

export interface EngineEvents {
  onHover: (index: number | null) => void;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onQuality: (label: string) => void;
  onFrame?: () => void;
}

type Tier = "high" | "lite";

interface Orb {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  halo: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  label: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTex: THREE.CanvasTexture;
  logoTex: THREE.Texture | null;
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: number;
  targetR: number;
  deform: number;
  wobble: number;
  impact: THREE.Vector3;
  pulse: number;
  hover: number;
  dim: number;
  dimTarget: number;
  seed: number;
  glow: THREE.Color;
  glowTarget: THREE.Color;
  glowAmt: number;
  glowAmtTarget: number;
  datum: BubbleDatum;
}

const UP = new THREE.Color(1.0, 0.24, 0.3);
const DOWN = new THREE.Color(0.2, 0.5, 1.0);
const FLAT = new THREE.Color(0.58, 0.64, 0.74);

function glowFor(pct: number): [THREE.Color, number] {
  if (pct > 0.04) return [UP, Math.min(1, 0.18 + pct / 5)];
  if (pct < -0.04) return [DOWN, Math.min(1, 0.18 - pct / 5)];
  return [FLAT, 0.08];
}

/** Captions below the top ten drop to name and move, so a crowded view stays legible. */
function labelData(d: BubbleDatum): LabelData {
  return { rank: d.rank, name: d.name, price: d.price, changePct: d.changePct, cap: d.capText, compact: d.rank > 10 };
}

export class BubbleEngine {
  private stage: HTMLElement;
  private canvas: HTMLCanvasElement;
  private events: EngineEvents;
  private tier: Tier;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private useBloom: boolean;
  private dpr: number;
  private dprMax: number;
  private dprMin: number;
  private orbs: Orb[] = [];
  private sphereGeo: THREE.SphereGeometry;
  private haloGeo = new THREE.PlaneGeometry(1, 1);
  private sky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private links: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private linkPairs: [number, number][] = [];
  private raf = 0;
  private last = performance.now();
  private start = performance.now();
  private frames = 0;
  private slowFrames = 0;
  private qualityCheckAt = 0;
  private goodChecks = 0;
  private running = true;
  private onScreen = true;
  private hover: number | null = null;
  private pointer = new THREE.Vector2();
  private pointerDirty = false;
  private pointerInside = false;
  private down: { x: number; y: number; t: number } | null = null;
  private lastClick: { i: number; t: number } | null = null;
  private selectTimer: number | null = null;
  private focusIndex: number | null = null;
  private resetting = 0;
  private autoRotate = true;
  private idleSince = performance.now();
  private raycaster = new THREE.Raycaster();
  private resizeObs: ResizeObserver;
  private visObs: IntersectionObserver;
  private disposed = false;
  private aspect = 1.6;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private homePos: THREE.Vector3;
  private homeTarget: THREE.Vector3;
  private mood = new THREE.Color(0.2, 0.5, 1.0);
  private moodTarget = new THREE.Color(0.2, 0.5, 1.0);

  constructor(stage: HTMLElement, canvas: HTMLCanvasElement, events: EngineEvents) {
    this.stage = stage;
    this.canvas = canvas;
    this.events = events;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = stage.clientWidth <= 760;
    this.tier = coarse || narrow ? "lite" : "high";
    const deviceDpr = window.devicePixelRatio || 1;
    this.dprMax = Math.min(deviceDpr, this.tier === "high" ? 1.6 : 1.35);
    // Never below a scale that turns the glass to mush: on a phone the floor stays
    // near 1:1, on a laptop the scaler has more room to trade sharpness for frames.
    this.dprMin = this.tier === "lite" ? Math.min(this.dprMax, Math.max(1, this.dprMax * 0.75)) : Math.max(0.75, this.dprMax * 0.6);
    this.dpr = this.dprMax;
    this.useBloom = this.tier === "high";

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.tier === "lite", alpha: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(38, 1, 10, 9000);
    // On a wide screen the view is aimed a little left of the cluster, so it sits
    // right of centre, clear of the pulse panel; on a phone it sits above the strip.
    this.homeTarget = narrow ? new THREE.Vector3(0, -170, 0) : new THREE.Vector3(-170, -20, 0);
    this.homePos = narrow ? new THREE.Vector3(0, 40, 2050) : new THREE.Vector3(-170, 520, 1500);
    this.camera.position.copy(this.homePos).multiplyScalar(2.3).add(new THREE.Vector3(narrow ? 0 : -900, 500, 0));

    this.controls = new OrbitControls(this.camera, stage);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 420;
    this.controls.maxDistance = 3000;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.autoRotateSpeed = 0.32;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    this.controls.target.copy(this.homeTarget);
    this.controls.addEventListener("start", this.onControlStart);
    this.controls.addEventListener("end", this.onControlEnd);

    this.sphereGeo = new THREE.SphereGeometry(1, this.tier === "high" ? 64 : 40, this.tier === "high" ? 48 : 30);

    // sky
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uMood: { value: this.mood } },
        depthWrite: false,
        depthTest: false,
      })
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    this.scene.add(this.sky);

    // stars
    const count = this.tier === "high" ? 1500 : 560;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const rad = 1500 + Math.random() * 2800;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * s * rad;
      pos[i * 3 + 1] = u * rad * 0.6;
      pos[i * 3 + 2] = Math.sin(th) * s * rad;
      size[i] = 1.2 + Math.pow(Math.random(), 3) * 5.5;
      seed[i] = Math.random();
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: { uTime: { value: 0 }, uPx: { value: this.dpr } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // floor
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600),
      new THREE.ShaderMaterial({
        vertexShader: FLOOR_VERT,
        fragmentShader: FLOOR_FRAG,
        uniforms: { uTime: { value: 0 }, uMood: { value: this.mood } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -470;
    this.scene.add(this.floor);

    // sector constellation lines
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(60 * 6), 3));
    linkGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(60 * 6), 3));
    linkGeo.setDrawRange(0, 0);
    this.links = new THREE.LineSegments(
      linkGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.links.frustumCulled = false;
    this.scene.add(this.links);

    this.buildPipeline();

    this.resizeObs = new ResizeObserver(this.resize);
    this.resizeObs.observe(stage);
    this.resize();
    this.visObs = new IntersectionObserver((entries) => {
      this.onScreen = entries.some((e) => e.isIntersecting);
    });
    this.visObs.observe(stage);
    document.addEventListener("visibilitychange", this.onVisibility);
    stage.addEventListener("pointermove", this.onPointerMove);
    stage.addEventListener("pointerdown", this.onPointerDown);
    stage.addEventListener("pointerup", this.onPointerUp);
    stage.addEventListener("pointerleave", this.onPointerLeave);
    this.raf = requestAnimationFrame(this.loop);
    this.reportQuality();
  }

  /* ── pipeline ─────────────────────────────────────────────────────────── */

  private buildPipeline() {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (!this.useBloom) return;
    const w = Math.max(1, this.stage.clientWidth), h = Math.max(1, this.stage.clientHeight);
    const target = new THREE.WebGLRenderTarget(w * this.dpr, h * this.dpr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.dpr);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom at half resolution: only the speculars and the move-coloured rims are
    // bright enough to cross the threshold, so it reads as light, not haze.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.5, 0.5, 0.94);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(w, h);
    this.bloom.setSize((w * this.dpr) / 2, (h * this.dpr) / 2);
  }

  private resize = () => {
    const w = Math.max(1, this.stage.clientWidth), h = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.aspect = w / h;
    // A narrow screen pulls the camera back so the whole cluster fits the width.
    this.camera.fov = w / h < 0.8 ? 52 : 38;
    this.camera.updateProjectionMatrix();
    this.sky.material.uniforms.uRes.value.set(w, h);
    if (this.composer && this.bloom) {
      this.composer.setSize(w, h);
      this.bloom.setSize((w * this.dpr) / 2, (h * this.dpr) / 2);
    }
  };

  private setDpr(next: number) {
    this.dpr = Math.round(next * 100) / 100;
    this.renderer.setPixelRatio(this.dpr);
    this.stars.material.uniforms.uPx.value = this.dpr;
    if (this.composer) this.composer.setPixelRatio(this.dpr);
    this.resize();
    this.reportQuality();
  }

  private reportQuality() {
    this.events.onQuality(`${this.useBloom ? "HD" : this.tier === "high" ? "HD lite" : "Mobile"} · ${this.dpr.toFixed(2)}x`);
  }

  /* ── data ─────────────────────────────────────────────────────────────── */

  setData(data: BubbleDatum[], rebuild: boolean) {
    if (rebuild || data.length !== this.orbs.length || data.some((d, i) => this.orbs[i]?.datum.key !== d.key)) {
      this.clearOrbs();
      this.buildOrbs(data);
      // A new market starts from the full view, wherever the last one was left.
      if (this.introDone && this.resetting === 0) this.resetCamera();
    } else {
      data.forEach((d, i) => {
        const o = this.orbs[i];
        const moved = o.datum.price !== d.price || o.datum.changePct !== d.changePct;
        if (moved) {
          o.pulse = 1;
          drawLabel(o.labelCanvas, labelData(d));
          o.labelTex.needsUpdate = true;
        }
        o.datum = d;
        const [g, a] = glowFor(d.changePct);
        o.glowTarget.copy(g);
        o.glowAmtTarget = a;
      });
      this.sizeOrbs();
    }
    const avg = data.length ? data.reduce((s, d) => s + d.changePct, 0) / data.length : 0;
    this.moodTarget.copy(avg > 0.05 ? new THREE.Color(0.9, 0.3, 0.35) : avg < -0.05 ? new THREE.Color(0.22, 0.46, 1.0) : new THREE.Color(0.4, 0.5, 0.7));
  }

  private sizeOrbs() {
    const caps = this.orbs.map((o) => o.datum.cap);
    const capMax = Math.max(1, ...caps);
    const scale = this.tier === "lite" ? 0.9 : 1;
    this.orbs.forEach((o) => {
      o.targetR = (44 + 112 * Math.sqrt(Math.max(0, o.datum.cap) / capMax)) * scale;
    });
    // A market whose top twenty are close in size (NASDAQ) would otherwise fill the
    // room with near-maximum spheres; cap the total glass so every market breathes.
    const area = this.orbs.reduce((sum, o) => sum + o.targetR * o.targetR, 0);
    const budget = this.orbs.length * 88 * 88 * scale * scale;
    if (area > budget) {
      const f = Math.sqrt(budget / area);
      this.orbs.forEach((o) => (o.targetR *= f));
    }
  }

  private introDone = false;

  private buildOrbs(data: BubbleDatum[]) {
    // The opening shot, once, when the first spheres exist: the camera starts far
    // out in the dark and glides in as they grow.
    if (!this.introDone && data.length) {
      this.introDone = true;
      this.resetting = 150;
    }
    data.forEach((d, i) => {
      const [g, a] = glowFor(d.changePct);
      const mat = new THREE.ShaderMaterial({
        vertexShader: SPHERE_VERT,
        fragmentShader: SPHERE_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: Math.random() * 10 },
          uImpact: { value: new THREE.Vector3(1, 0, 0) },
          uDeform: { value: 0 },
          uWobble: { value: 0 },
          uHover: { value: 0 },
          uLogo: { value: null },
          uHasLogo: { value: 0 },
          uTint: { value: new THREE.Color("#8fa9c4") },
          uGlow: { value: g.clone() },
          uGlowAmt: { value: a },
          uPulse: { value: 0 },
          uDim: { value: 0 },
        },
      });
      const mesh = new THREE.Mesh(this.sphereGeo, mat);
      const halo = new THREE.Mesh(
        this.haloGeo,
        new THREE.ShaderMaterial({
          vertexShader: HALO_VERT,
          fragmentShader: HALO_FRAG,
          uniforms: { uGlow: { value: g.clone() }, uAmt: { value: 0 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      halo.renderOrder = -1;
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = LABEL_W;
      labelCanvas.height = LABEL_H;
      drawLabel(labelCanvas, labelData(d));
      const labelTex = new THREE.CanvasTexture(labelCanvas);
      labelTex.colorSpace = THREE.SRGBColorSpace;
      labelTex.anisotropy = 4;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false }));
      label.center.set(0.5, 1);
      label.renderOrder = 2;
      this.scene.add(halo, mesh, label);

      // A spiral disc for the first frame, largest names nearest the middle.
      const ang = i * 2.39996;
      const rad = 120 + Math.sqrt(i) * 230;
      const o: Orb = {
        mesh,
        halo,
        label,
        labelCanvas,
        labelTex,
        logoTex: null,
        p: new THREE.Vector3(Math.cos(ang) * rad, (Math.random() - 0.5) * 160, Math.sin(ang) * rad),
        v: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 2),
        r: 1,
        targetR: 60,
        deform: 0,
        wobble: 0,
        impact: new THREE.Vector3(1, 0, 0),
        pulse: 0.6,
        hover: 0,
        dim: 0,
        dimTarget: 0,
        seed: Math.random() * 10,
        glow: g.clone(),
        glowTarget: g.clone(),
        glowAmt: 0,
        glowAmtTarget: a,
        datum: d,
      };
      this.orbs.push(o);

      logoPalette(d.logoUrl, d.key).then((tint) => {
        if (this.disposed || !this.orbs.includes(o)) return;
        mat.uniforms.uTint.value.set(tint[0]).lerp(new THREE.Color(tint[1]), 0.3);
      });
      transparentLogo(d.logoUrl).then((src) => {
        if (this.disposed || !this.orbs.includes(o)) return;
        const apply = (tex: THREE.Texture) => {
          if (this.disposed || !this.orbs.includes(o)) return tex.dispose();
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          o.logoTex = tex;
          mat.uniforms.uLogo.value = tex;
          mat.uniforms.uHasLogo.value = 1;
        };
        if (!src) return apply(new THREE.CanvasTexture(monogramCanvas(d.name.slice(0, 2), "#1d2a3a")));
        new THREE.TextureLoader().load(src, apply, undefined, () => apply(new THREE.CanvasTexture(monogramCanvas(d.name.slice(0, 2), "#1d2a3a"))));
      });
    });
    this.sizeOrbs();
    this.orbs.forEach((o) => (o.r = o.targetR * 0.2));
    // Captions drawn before the web font arrived are redrawn once it has.
    document.fonts?.ready.then(() => {
      if (this.disposed) return;
      for (const o of this.orbs) {
        drawLabel(o.labelCanvas, labelData(o.datum));
        o.labelTex.needsUpdate = true;
      }
    });
    // Sector constellations: each sector's names chained in rank order.
    this.linkPairs = [];
    const bySector = new Map<string, number[]>();
    data.forEach((d, i) => bySector.set(d.sector, [...(bySector.get(d.sector) ?? []), i]));
    for (const ids of bySector.values()) for (let k = 1; k < ids.length; k++) this.linkPairs.push([ids[k - 1], ids[k]]);
    this.links.geometry.setDrawRange(0, this.linkPairs.length * 2);
  }

  private clearOrbs() {
    for (const o of this.orbs) {
      this.scene.remove(o.mesh, o.halo, o.label);
      o.mesh.material.dispose();
      o.halo.material.dispose();
      (o.label.material as THREE.SpriteMaterial).dispose();
      o.labelTex.dispose();
      o.logoTex?.dispose();
    }
    this.orbs = [];
    this.hover = null;
    this.focusIndex = null;
  }

  /* ── view controls ────────────────────────────────────────────────────── */

  setSectorFocus(sector: string | null) {
    this.orbs.forEach((o) => (o.dimTarget = sector && o.datum.sector !== sector ? 1 : 0));
  }

  focus(index: number | null) {
    this.focusIndex = index;
    this.resetting = 0;
    if (index !== null) this.idleSince = performance.now();
  }

  resetCamera() {
    this.focusIndex = null;
    this.resetting = 90;
  }

  setAutoRotate(on: boolean) {
    this.autoRotate = on;
  }

  /** Where a sphere's top edge is on screen, for the hover card. */
  screenAnchor(index: number): { x: number; y: number; r: number } | null {
    const o = this.orbs[index];
    if (!o) return null;
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    this.tmp.copy(o.p).project(this.camera);
    if (this.tmp.z > 1) return null;
    const x = (this.tmp.x * 0.5 + 0.5) * w;
    const y = (-this.tmp.y * 0.5 + 0.5) * h;
    this.tmp2.copy(o.p).addScaledVector(this.camera.up, o.r).project(this.camera);
    const top = (-this.tmp2.y * 0.5 + 0.5) * h;
    return { x, y, r: Math.abs(y - top) };
  }

  /* ── input ────────────────────────────────────────────────────────────── */

  private onControlStart = () => {
    this.focusIndex = null;
    this.resetting = 0;
    this.idleSince = Infinity;
  };
  private onControlEnd = () => {
    this.idleSince = performance.now();
  };
  private setPointer(e: PointerEvent) {
    const rect = this.stage.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }
  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.setPointer(e);
    this.pointerDirty = true;
    this.pointerInside = true;
  };
  private onPointerLeave = () => {
    this.pointerInside = false;
    this.pointerDirty = true;
  };
  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7 || performance.now() - d.t > 500) return;
    this.setPointer(e);
    const hit = this.pick();
    if (hit === null) return;
    const now = performance.now();
    if (this.lastClick && this.lastClick.i === hit && now - this.lastClick.t < 340) {
      if (this.selectTimer !== null) window.clearTimeout(this.selectTimer);
      this.selectTimer = null;
      this.lastClick = null;
      this.events.onOpen(hit);
      return;
    }
    this.lastClick = { i: hit, t: now };
    if (this.selectTimer !== null) window.clearTimeout(this.selectTimer);
    this.selectTimer = window.setTimeout(() => {
      this.selectTimer = null;
      this.focus(hit);
      this.events.onSelect(hit);
    }, 260);
  };
  private pick(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.orbs.map((o) => o.mesh),
      false
    );
    if (!hits.length) return null;
    const i = this.orbs.findIndex((o) => o.mesh === hits[0].object);
    return i >= 0 ? i : null;
  }
  private onVisibility = () => {
    this.running = !document.hidden;
    this.last = performance.now();
  };

  /* ── the loop ─────────────────────────────────────────────────────────── */

  private step(dt: number, t: number) {
    const orbs = this.orbs;
    const rMax = Math.max(1, ...orbs.map((o) => o.targetR));
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      o.r += (o.targetR - o.r) * Math.min(1, 0.06 * dt);
      // The cloud takes the screen's shape: a wide disc on a landscape screen, a
      // tall column on an upright phone. Larger names are pulled harder, so they
      // settle toward the middle.
      const k = 0.00032 + 0.00052 * (o.r / rMax);
      const ky = k * (this.aspect > 1 ? 2.4 : 0.55);
      const kz = k * (this.aspect > 1 ? 0.75 : 1.6);
      o.v.x += (-o.p.x * k - o.p.z * 0.00024) * dt;
      o.v.z += (-o.p.z * kz + o.p.x * 0.00024) * dt;
      o.v.y += -o.p.y * ky * dt;
      o.v.x += Math.sin(t * 0.00037 + o.seed * 9) * 0.0045 * dt;
      o.v.z += Math.cos(t * 0.00029 + o.seed * 7) * 0.0045 * dt;
      o.v.y += Math.sin(t * 0.00041 + o.seed * 5) * 0.0028 * dt;
      const damp = Math.pow(i === this.hover ? 0.9 : 0.982, dt);
      o.v.multiplyScalar(damp);
      const sp = o.v.length();
      if (sp > 6) o.v.multiplyScalar(6 / sp);
      o.p.addScaledVector(o.v, dt);
    }
    for (let i = 0; i < orbs.length; i++) {
      const a = orbs[i];
      for (let j = i + 1; j < orbs.length; j++) {
        const b = orbs[j];
        this.tmp.subVectors(b.p, a.p);
        const dist = this.tmp.length() || 0.001;
        const min = a.r + b.r + 10;
        const room = (a.r + b.r) * 1.7 + 40;
        if (dist >= room) continue;
        const n = this.tmp.divideScalar(dist);
        const ia = 1 / (a.r * a.r), ib = 1 / (b.r * b.r), is = ia + ib;
        // Personal space: a soft push well before contact keeps the cloud evenly
        // spread, so spheres and their captions do not pile up in the middle.
        const push = (room - dist) * 0.0016 * dt;
        a.v.addScaledVector(n, (-push * ia) / is);
        b.v.addScaledVector(n, (push * ib) / is);
        if (dist >= min) continue;
        const overlap = min - dist;
        a.p.addScaledVector(n, (-overlap * ia) / is);
        b.p.addScaledVector(n, (overlap * ib) / is);
        const vn = (b.v.x - a.v.x) * n.x + (b.v.y - a.v.y) * n.y + (b.v.z - a.v.z) * n.z;
        if (vn < 0) {
          const jImp = (-(1 + 0.4) * vn) / is;
          a.v.addScaledVector(n, -jImp * ia);
          b.v.addScaledVector(n, jImp * ib);
          const hit = -vn;
          if (hit > 0.18) {
            const sa = Math.min(0.26, hit * 0.09 * Math.sqrt(b.r / a.r));
            const sb = Math.min(0.26, hit * 0.09 * Math.sqrt(a.r / b.r));
            if (sa > a.deform) {
              a.deform = sa;
              a.impact.copy(n);
            }
            if (sb > b.deform) {
              b.deform = sb;
              b.impact.copy(n).negate();
            }
            a.wobble = Math.max(a.wobble, Math.min(1, hit * 0.4));
            b.wobble = Math.max(b.wobble, Math.min(1, hit * 0.4));
          }
        }
      }
    }
    for (const o of orbs) {
      o.deform *= Math.pow(0.9, dt);
      o.wobble *= Math.pow(0.95, dt);
      o.pulse *= Math.pow(0.965, dt);
      o.dim += (o.dimTarget - o.dim) * Math.min(1, 0.1 * dt);
      o.glow.lerp(o.glowTarget, Math.min(1, 0.08 * dt));
      o.glowAmt += (o.glowAmtTarget - o.glowAmt) * Math.min(1, 0.05 * dt);
    }
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.running || !this.onScreen) {
      this.last = now;
      return;
    }
    const raw = now - this.last;
    this.last = now;
    const dt = Math.min(3, raw / 16.667);
    const t = now - this.start;

    // physics in up to two substeps, so a long frame does not tunnel spheres
    if (dt > 1.6) {
      this.step(dt / 2, t);
      this.step(dt / 2, t);
    } else this.step(dt, t);

    // picking, only when the pointer moved
    if (this.pointerDirty) {
      this.pointerDirty = false;
      const hit = this.pointerInside ? this.pick() : null;
      if (hit !== this.hover) {
        this.hover = hit;
        this.stage.style.cursor = hit === null ? "" : "pointer";
        this.events.onHover(hit);
      }
    }

    // camera
    const idle = now - this.idleSince > 5000;
    this.controls.autoRotate = this.autoRotate && idle && this.focusIndex === null && this.hover === null;
    if (this.focusIndex !== null && this.orbs[this.focusIndex]) {
      const o = this.orbs[this.focusIndex];
      this.controls.target.lerp(o.p, 0.06);
      const dir = this.tmp.subVectors(this.camera.position, this.controls.target).normalize();
      const want = this.tmp2.copy(o.p).addScaledVector(dir, o.r * 6.5 + 420);
      this.camera.position.lerp(want, 0.045);
    } else if (this.resetting > 0) {
      this.resetting -= 1;
      this.controls.target.lerp(this.homeTarget, 0.08);
      this.camera.position.lerp(this.homePos, this.resetting > 100 ? 0.03 : 0.06);
    }
    this.controls.update();

    // down vector on screen, for hanging labels under spheres at any orbit angle
    const downV = this.tmp2.set(0, -1, 0).applyQuaternion(this.camera.quaternion);
    const time = t / 1000;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      const u = o.mesh.material.uniforms;
      o.hover += ((i === this.hover ? 1 : 0) - o.hover) * Math.min(1, 0.18 * dt);
      o.mesh.position.copy(o.p);
      o.mesh.scale.setScalar(o.r);
      u.uTime.value = time;
      u.uDeform.value = o.deform;
      u.uWobble.value = o.wobble;
      u.uImpact.value.copy(o.impact);
      u.uHover.value = o.hover;
      u.uPulse.value = o.pulse;
      u.uDim.value = o.dim;
      u.uGlow.value.copy(o.glow);
      u.uGlowAmt.value = o.glowAmt;
      o.halo.position.copy(o.p);
      o.halo.scale.setScalar(o.r * 3.3);
      o.halo.material.uniforms.uGlow.value.copy(o.glow);
      o.halo.material.uniforms.uAmt.value = (o.glowAmt * 0.32 + o.pulse * 0.45 + o.hover * 0.22) * (1 - o.dim);
      const lw = (o.datum.rank > 10 ? Math.max(150, Math.min(230, o.r * 2.3)) : Math.max(200, Math.min(320, o.r * 2.2))) * (1 + o.hover * 0.12);
      o.label.position.copy(o.p).addScaledVector(downV, o.r * (1.06 + o.hover * 0.07));
      o.label.scale.set(lw, (lw * LABEL_H) / LABEL_W, 1);
      (o.label.material as THREE.SpriteMaterial).opacity = 1 - o.dim * 0.85;
    }

    // constellation lines
    const lp = this.links.geometry.getAttribute("position") as THREE.BufferAttribute;
    const lc = this.links.geometry.getAttribute("color") as THREE.BufferAttribute;
    this.linkPairs.forEach(([a, b], k) => {
      const A = this.orbs[a], B = this.orbs[b];
      if (!A || !B) return;
      lp.setXYZ(k * 2, A.p.x, A.p.y, A.p.z);
      lp.setXYZ(k * 2 + 1, B.p.x, B.p.y, B.p.z);
      const fade = (1 - Math.max(A.dim, B.dim) * 0.9) * (0.35 + Math.max(A.hover, B.hover) * 0.65);
      lc.setXYZ(k * 2, 0.35 * fade, 0.62 * fade, 1.0 * fade);
      lc.setXYZ(k * 2 + 1, 0.35 * fade, 0.62 * fade, 1.0 * fade);
    });
    lp.needsUpdate = true;
    lc.needsUpdate = true;

    this.mood.lerp(this.moodTarget, 0.02);
    this.sky.material.uniforms.uTime.value = time;
    this.stars.material.uniforms.uTime.value = time;
    this.floor.material.uniforms.uTime.value = time;
    this.stars.rotation.y = time * 0.004;

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.events.onFrame?.();

    // Adaptive quality, judged on the share of slow frames in each window rather
    // than an average, so one hitch (a panel opening, a tab switch) is not taken
    // for a slow machine.
    if (raw < 250) {
      this.frames += 1;
      if (raw > 21) this.slowFrames += 1;
    }
    if (now > this.qualityCheckAt && now - this.start > 1500) {
      this.qualityCheckAt = now + 1000;
      const slowShare = this.frames ? this.slowFrames / this.frames : 0;
      const enough = this.frames >= 20;
      this.frames = 0;
      this.slowFrames = 0;
      if (!enough) return;
      if (slowShare > 0.35) {
        this.goodChecks = 0;
        if (this.dpr > this.dprMin + 0.01) this.setDpr(Math.max(this.dprMin, this.dpr - 0.15));
        else if (this.useBloom) {
          this.useBloom = false;
          this.buildPipeline();
          this.reportQuality();
        }
      } else if (slowShare < 0.03) {
        this.goodChecks += 1;
        if (this.goodChecks >= 4 && this.dpr < this.dprMax - 0.01) {
          this.goodChecks = 0;
          this.setDpr(Math.min(this.dprMax, this.dpr + 0.1));
        }
      } else this.goodChecks = 0;
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.selectTimer !== null) window.clearTimeout(this.selectTimer);
    this.resizeObs.disconnect();
    this.visObs.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stage.removeEventListener("pointermove", this.onPointerMove);
    this.stage.removeEventListener("pointerdown", this.onPointerDown);
    this.stage.removeEventListener("pointerup", this.onPointerUp);
    this.stage.removeEventListener("pointerleave", this.onPointerLeave);
    this.stage.style.cursor = "";
    this.controls.removeEventListener("start", this.onControlStart);
    this.controls.removeEventListener("end", this.onControlEnd);
    this.controls.dispose();
    this.clearOrbs();
    this.sphereGeo.dispose();
    this.haloGeo.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.links.geometry.dispose();
    this.links.material.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
