import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { MonitorEdge } from "../adminApi";
import type { MonitorLayout, PlacedNode } from "./layout";

/** The WebGL half of the monitor: the brain itself.
 *
 * Kept out of React entirely. Everything here runs on the animation frame and mutates
 * typed arrays in place; putting any of it in component state would mean a React render
 * per frame, sixty times a second, for a scene React has no opinions about. The
 * component owns *what* fires (it polls the backend); this owns *how* that looks.
 *
 * The visual grammar, so the code below reads as intentional rather than decorative:
 *
 * - a **node** is a solid core inside a soft halo. Its halo breathes slowly at rest and
 *   flares when the node fires, then decays — a refractory period, roughly.
 * - an **edge** is a curved synapse that sags toward the origin. Curves rather than
 *   straight lines because a hundred straight lines through a sphere's middle read as a
 *   ball of wire; curves let the eye follow one.
 * - a **signal** is a comet: a bright head with a short tail, travelling the curve. When
 *   it lands it fires the target and, if the target has somewhere to send it, cascades —
 *   which is what turns a single page view into a visible chain through the endpoints
 *   and out to the upstream feeds.
 *
 * Everything additive, everything through a bloom pass. The glow is doing most of the
 * work of making it look like light rather than like circles.
 */

/* ────────────────────────────── tuning constants ────────────────────────────── */

/* Bloom is what sells this as light rather than as circles, and it is also the easiest
   thing to overdo — the first pass at these numbers turned the dense middle shell into
   one white cloud with the structure lost inside it. Strength is now modest and the
   threshold high enough that only cores and signal heads bleed, leaving the synapses
   and the quieter nodes to hold their shape. */
const BLOOM_STRENGTH = 0.62;
const BLOOM_RADIUS = 0.72;
const BLOOM_THRESHOLD = 0.24;

const MAX_SIGNALS = 320;
/** Points drawn per comet — one head plus this many tail samples behind it. */
const TAIL_POINTS = 6;

/** Seconds for a signal to cross one edge. Slow enough to follow by eye; a real request
 * is milliseconds, and animating honestly would be a flicker nobody could read. */
const SIGNAL_SECONDS = 0.85;

/** How fast a fired node returns to rest. */
const FIRE_DECAY_PER_SECOND = 1.7;
/** How fast a lit edge cools back to its resting colour. */
const EDGE_COOL_PER_SECOND = 1.25;

const SEGMENTS_PER_EDGE = 14;

const HALO_SCALE = 7.5;
/** Endpoints outnumber everything else four to one, so their resting glow has to be the
 * faintest or the middle shell becomes an opaque cloud. Depots are dim for the opposite
 * reason: a hundred dependency edges converge on the cache and the DB, and at full
 * strength those two nodes bloom into featureless white suns. */
const HALO_ALPHA: Record<"page" | "api" | "depot", number> = { page: 0.7, api: 0.3, depot: 0.46 };

/** Direction the camera sits in at rest; its distance is computed from the graph's own
 * radius (see frameGraph) rather than guessed, so the whole brain is in shot on any
 * viewport and after any change to the layout's shell radii. */
const CAMERA_DIRECTION = new THREE.Vector3(0.16, 0.34, 1).normalize();

export interface HoverInfo {
  node: PlacedNode;
  /** Screen-space position of the node, for placing the HTML tooltip. */
  x: number;
  y: number;
}

interface Signal {
  active: boolean;
  from: THREE.Vector3;
  ctrl: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  speed: number;
  color: THREE.Color;
  size: number;
  targetId: string;
  edgeIndex: number;
  /** How many more hops this signal may cascade once it lands. Zero means it stops. */
  hops: number;
}

/* ───────────────────────────────── shaders ───────────────────────────────────
   One material serves node halos and signal comets: soft round additive sprites with
   per-point size and colour. PointsMaterial only carries a single size for the whole
   cloud, which would make a flaring node indistinguishable from a resting one. */

const POINT_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uPixelRatio;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Perspective size attenuation: a node twice as far reads half as wide, which is
    // what gives the cloud its depth without any fog.
    gl_PointSize = aSize * uPixelRatio * (320.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    // Squared falloff reads as a light source; a linear one reads as a disc with a
    // blurred edge.
    float a = pow(max(0.0, 1.0 - r), 2.6) * vAlpha;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

function makePointsMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: pixelRatio } },
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    transparent: true,
  });
}

/* ───────────────────────────────── the scene ───────────────────────────────── */

export class MonitorScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  /** Everything that belongs to the brain, so the whole assembly can drift as one. */
  private world = new THREE.Group();
  private clock = new THREE.Clock();
  private frame = 0;
  private container: HTMLElement;
  private labelLayer: HTMLElement;

  private layout: MonitorLayout | null = null;
  private nodes: PlacedNode[] = [];
  private nodeIndex = new Map<string, number>();

  private halos: THREE.Points | null = null;
  private cores: THREE.InstancedMesh | null = null;
  private picker: THREE.InstancedMesh | null = null;
  private lines: THREE.LineSegments | null = null;
  private signalPoints: THREE.Points | null = null;
  private starfield: THREE.Points | null = null;

  private haloSize: Float32Array = new Float32Array(0);
  private haloAlpha: Float32Array = new Float32Array(0);
  private haloColor: Float32Array = new Float32Array(0);
  private lineColor: Float32Array = new Float32Array(0);

  /** Per-node excitation, 0 at rest and 1 the instant it fires. */
  private fire: Float32Array = new Float32Array(0);
  /** Per-edge excitation, same idea, driving the synapse's brightness. */
  private edgeHeat: Float32Array = new Float32Array(0);

  private signals: Signal[] = [];
  private signalPos: Float32Array = new Float32Array(0);
  private signalCol: Float32Array = new Float32Array(0);
  private signalSize: Float32Array = new Float32Array(0);
  private signalAlpha: Float32Array = new Float32Array(0);

  private edgeCurves: { curve: THREE.QuadraticBezierCurve3; source: string; target: string }[] = [];
  private edgeIndexByPair = new Map<string, number>();

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);
  private pointerInside = false;
  private hovered: PlacedNode | null = null;
  private selectedId: string | null = null;

  private labels = new Map<string, HTMLElement>();
  private tmpMatrix = new THREE.Matrix4();
  private tmpVec = new THREE.Vector3();
  private tmpColor = new THREE.Color();
  private keys = new Set<string>();
  /** Distance at which labels start fading. Derived from the framing distance rather
   * than fixed, so zooming out to see the whole brain doesn't blank every label. */
  private labelFade = 200;
  private running = false;
  private disposed = false;

  onHover: ((info: HoverInfo | null) => void) | null = null;
  onSelect: ((node: PlacedNode | null) => void) | null = null;

  constructor(container: HTMLElement, labelLayer: HTMLElement) {
    this.container = container;
    this.labelLayer = labelLayer;

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x04060d, 1);
    // ACES keeps the additive pile-up in the dense middle shell from clipping to flat
    // white — without it, a busy moment turns the core of the brain into a blob.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.5, 4000);
    this.camera.position.copy(CAMERA_DIRECTION).multiplyScalar(420);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.7;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 900;
    // Screen-space panning keeps drag-to-pan feeling like moving a picture rather than
    // sliding along the ground plane, which is disorienting inside a spherical layout.
    this.controls.screenSpacePanning = true;

    this.scene.add(this.world);
    this.scene.fog = new THREE.FogExp2(0x04060d, 0.0022);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildStarfield();
    this.bindEvents();
  }

  /* ──────────────────────────────── background ──────────────────────────────── */

  private buildStarfield(): void {
    // Not decoration for its own sake: with nothing behind it, a graph you can orbit
    // gives no sense of having moved. The stars are the parallax reference.
    const count = 1400;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Shell well outside the graph, so stars never intrude between the camera and a
      // node the operator is trying to read.
      const r = 700 + Math.random() * 900;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const tint = 0.55 + Math.random() * 0.45;
      colors[i * 3] = tint * 0.7;
      colors[i * 3 + 1] = tint * 0.82;
      colors[i * 3 + 2] = tint;
      sizes[i] = 1.1 + Math.random() * 2.4;
      alphas[i] = 0.18 + Math.random() * 0.4;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    this.starfield = new THREE.Points(geometry, makePointsMaterial(this.renderer.getPixelRatio()));
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);
  }

  /* ───────────────────────────────── graph build ───────────────────────────────── */

  setGraph(layout: MonitorLayout): void {
    this.clearGraph();
    this.layout = layout;
    this.nodes = layout.nodes;
    this.nodeIndex = new Map(layout.nodes.map((n, i) => [n.id, i]));

    const count = this.nodes.length;
    this.fire = new Float32Array(count);

    const positions = new Float32Array(count * 3);
    this.haloColor = new Float32Array(count * 3);
    this.haloSize = new Float32Array(count);
    this.haloAlpha = new Float32Array(count);

    this.nodes.forEach((node, i) => {
      positions[i * 3] = node.x;
      positions[i * 3 + 1] = node.y;
      positions[i * 3 + 2] = node.z;
      this.tmpColor.setHex(node.color);
      this.haloColor[i * 3] = this.tmpColor.r;
      this.haloColor[i * 3 + 1] = this.tmpColor.g;
      this.haloColor[i * 3 + 2] = this.tmpColor.b;
      this.haloSize[i] = node.size * HALO_SCALE;
      this.haloAlpha[i] = HALO_ALPHA[node.kind];
    });

    const haloGeometry = new THREE.BufferGeometry();
    haloGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    haloGeometry.setAttribute("aColor", new THREE.BufferAttribute(this.haloColor, 3));
    haloGeometry.setAttribute("aSize", new THREE.BufferAttribute(this.haloSize, 1));
    haloGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.haloAlpha, 1));
    this.halos = new THREE.Points(haloGeometry, makePointsMaterial(this.renderer.getPixelRatio()));
    this.halos.frustumCulled = false;
    this.world.add(this.halos);

    // Solid cores. Additive like everything else, so a node sitting behind another adds
    // its light rather than punching a hole in it.
    const coreGeometry = new THREE.IcosahedronGeometry(1, 2);
    const coreMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    this.cores = new THREE.InstancedMesh(coreGeometry, coreMaterial, count);
    this.cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cores.frustumCulled = false;
    this.world.add(this.cores);

    // A second, larger, invisible copy purely to be raycast against. Picking the visible
    // cores directly means aiming at a 1.4-unit sphere from 200 units away, which in
    // practice means never hitting anything. colorWrite=false rather than visible=false:
    // an invisible object is skipped by the raycaster entirely.
    const pickMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.picker = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), pickMaterial, count);
    this.picker.frustumCulled = false;
    this.world.add(this.picker);

    this.nodes.forEach((node, i) => {
      this.tmpColor.setHex(node.color);
      this.cores!.setColorAt(i, this.tmpColor);
    });
    if (this.cores.instanceColor) this.cores.instanceColor.needsUpdate = true;
    this.updateNodeMatrices();

    this.buildEdges(layout);
    this.buildSignalPool();
    this.buildLabels();
    this.frameGraph();
  }

  private buildEdges(layout: MonitorLayout): void {
    const edges = layout.edges;
    this.edgeCurves = [];
    this.edgeIndexByPair.clear();
    this.edgeHeat = new Float32Array(edges.length);

    const vertsPerEdge = SEGMENTS_PER_EDGE * 2;
    const positions = new Float32Array(edges.length * vertsPerEdge * 3);
    this.lineColor = new Float32Array(edges.length * vertsPerEdge * 3);

    edges.forEach((edge, e) => {
      const a = layout.byId.get(edge.source)!;
      const b = layout.byId.get(edge.target)!;
      const from = new THREE.Vector3(a.x, a.y, a.z);
      const to = new THREE.Vector3(b.x, b.y, b.z);

      // Sag the control point toward the origin so the synapse bows inward. A straight
      // chord between two shells reads as a spoke; this reads as a fibre.
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const pull = edge.kind === "call" ? 0.26 : 0.16;
      const ctrl = mid.multiplyScalar(1 - pull);

      const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to);
      this.edgeCurves.push({ curve, source: edge.source, target: edge.target });
      this.edgeIndexByPair.set(`${edge.source} ${edge.target}`, e);

      const points = curve.getPoints(SEGMENTS_PER_EDGE);
      for (let s = 0; s < SEGMENTS_PER_EDGE; s++) {
        const base = (e * vertsPerEdge + s * 2) * 3;
        positions[base] = points[s].x;
        positions[base + 1] = points[s].y;
        positions[base + 2] = points[s].z;
        positions[base + 3] = points[s + 1].x;
        positions[base + 4] = points[s + 1].y;
        positions[base + 5] = points[s + 1].z;
      }
      this.writeEdgeColor(e, edge, 0);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.lineColor, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.55,
    });
    this.lines = new THREE.LineSegments(geometry, material);
    this.lines.frustumCulled = false;
    this.world.add(this.lines);
  }

  /** Paints one edge's whole run of vertices. `heat` 0 is resting, 1 is just-fired.
   * Resting synapses are dim on purpose — the structure should be readable but must not
   * compete with the signals, which are the thing actually worth watching. */
  private writeEdgeColor(index: number, edge: MonitorEdge, heat: number): void {
    if (!this.layout) return;
    const source = this.layout.byId.get(edge.source);
    if (!source) return;
    this.tmpColor.setHex(source.color);
    const base = edge.kind === "call" ? 0.07 : 0.035;
    const level = base + heat * 0.9;
    const r = this.tmpColor.r * level;
    const g = this.tmpColor.g * level;
    const b = this.tmpColor.b * level;
    const vertsPerEdge = SEGMENTS_PER_EDGE * 2;
    const start = index * vertsPerEdge * 3;
    for (let v = 0; v < vertsPerEdge; v++) {
      this.lineColor[start + v * 3] = r;
      this.lineColor[start + v * 3 + 1] = g;
      this.lineColor[start + v * 3 + 2] = b;
    }
  }

  private buildSignalPool(): void {
    const points = MAX_SIGNALS * TAIL_POINTS;
    this.signals = Array.from({ length: MAX_SIGNALS }, () => ({
      active: false,
      from: new THREE.Vector3(),
      ctrl: new THREE.Vector3(),
      to: new THREE.Vector3(),
      t: 0,
      speed: 1,
      color: new THREE.Color(),
      size: 1,
      targetId: "",
      edgeIndex: -1,
      hops: 0,
    }));
    this.signalPos = new Float32Array(points * 3);
    this.signalCol = new Float32Array(points * 3);
    this.signalSize = new Float32Array(points);
    this.signalAlpha = new Float32Array(points);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.signalPos, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.signalCol, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.signalSize, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.signalAlpha, 1));
    this.signalPoints = new THREE.Points(geometry, makePointsMaterial(this.renderer.getPixelRatio()));
    this.signalPoints.frustumCulled = false;
    this.world.add(this.signalPoints);
  }

  /** HTML labels rather than sprite textures: sharper at any zoom, styleable in CSS,
   * and 113 canvas textures avoided. Only the two outer layers get a permanent label —
   * labelling all 85 endpoints at once would bury the picture in text, so those surface
   * on hover instead. */
  private buildLabels(): void {
    this.labelLayer.innerHTML = "";
    this.labels.clear();
    for (const node of this.nodes) {
      if (node.kind === "api") continue;
      const el = document.createElement("div");
      el.className = `mon-label mon-label--${node.kind}`;
      el.textContent = node.label;
      el.style.color = `#${node.color.toString(16).padStart(6, "0")}`;
      this.labelLayer.appendChild(el);
      this.labels.set(node.id, el);
    }
  }

  /* ─────────────────────────────── live signalling ─────────────────────────────── */

  /** Lights a node without any travel — used when an event names a node directly (a
   * visitor landing on a page) rather than describing a hop. */
  fireNode(id: string, strength = 1): void {
    const index = this.nodeIndex.get(id);
    if (index === undefined) return;
    this.fire[index] = Math.min(1.6, this.fire[index] + strength);
  }

  /** Sends a comet along the edge between two nodes, if such an edge exists.
   * `hops` lets the signal keep going when it lands — one page view becoming a visible
   * cascade out through the endpoints to the upstream feeds. */
  sendSignal(sourceId: string, targetId: string, hops = 0): boolean {
    if (!this.layout) return false;
    const from = this.layout.byId.get(sourceId);
    const to = this.layout.byId.get(targetId);
    if (!from || !to) return false;

    const slot = this.signals.find((s) => !s.active);
    if (!slot) return false; // Pool exhausted: drop it. A dropped comet in a storm is invisible.

    const edgeIndex = this.edgeIndexByPair.get(`${sourceId} ${targetId}`) ?? -1;
    slot.active = true;
    slot.t = 0;
    slot.speed = 1 / SIGNAL_SECONDS;
    slot.from.set(from.x, from.y, from.z);
    slot.to.set(to.x, to.y, to.z);
    if (edgeIndex >= 0) {
      slot.ctrl.copy(this.edgeCurves[edgeIndex].curve.v1);
    } else {
      slot.ctrl.copy(slot.from).add(slot.to).multiplyScalar(0.5 * 0.8);
    }
    slot.color.setHex(to.color);
    slot.size = to.kind === "api" ? 3.4 : 4.6;
    slot.targetId = targetId;
    slot.edgeIndex = edgeIndex;
    slot.hops = hops;
    this.fireNode(sourceId, 0.55);
    return true;
  }

  /** Fires a node and pushes a comet down every edge leaving it, up to `fanout`. This is
   * what a page view looks like: the page lights, then its endpoints light in turn. */
  pulseFrom(id: string, fanout: number, hops: number): void {
    this.fireNode(id, 1);
    const edges = this.layout?.outgoing.get(id);
    if (!edges || edges.length === 0) return;
    // Random slice rather than the first N: a page with a dozen endpoints would
    // otherwise always animate the same three, and the rest would look dead.
    const picked = edges.length <= fanout ? edges : shuffled(edges).slice(0, fanout);
    for (const edge of picked) this.sendSignal(id, edge.target, hops);
  }

  private advanceSignals(dt: number): void {
    let cursor = 0;
    for (const signal of this.signals) {
      if (!signal.active) continue;
      signal.t += dt * signal.speed;

      if (signal.edgeIndex >= 0) {
        this.edgeHeat[signal.edgeIndex] = 1;
      }

      if (signal.t >= 1) {
        signal.active = false;
        this.fireNode(signal.targetId, 1);
        if (signal.hops > 0) {
          const next = this.layout?.outgoing.get(signal.targetId);
          if (next && next.length > 0) {
            const edge = next[Math.floor(Math.random() * next.length)];
            this.sendSignal(signal.targetId, edge.target, signal.hops - 1);
          }
        }
        continue;
      }

      // The head, plus a short tail sampled behind it along the same curve. Cheaper and
      // steadier than a real trail buffer, and at these speeds indistinguishable.
      for (let k = 0; k < TAIL_POINTS; k++) {
        const t = Math.max(0, signal.t - k * 0.035);
        quadraticAt(signal.from, signal.ctrl, signal.to, t, this.tmpVec);
        const o = cursor * 3;
        this.signalPos[o] = this.tmpVec.x;
        this.signalPos[o + 1] = this.tmpVec.y;
        this.signalPos[o + 2] = this.tmpVec.z;
        this.signalCol[o] = signal.color.r;
        this.signalCol[o + 1] = signal.color.g;
        this.signalCol[o + 2] = signal.color.b;
        const decay = 1 - k / TAIL_POINTS;
        this.signalSize[cursor] = signal.size * (0.35 + decay * 0.65);
        // Fade the comet in and out at the ends so it emerges from the source node and
        // is absorbed by the target rather than appearing and vanishing mid-air.
        const ends = Math.min(1, Math.sin(Math.PI * Math.min(1, signal.t)) * 2.4);
        this.signalAlpha[cursor] = decay * decay * ends;
        cursor++;
      }
    }

    // Everything past the live head is parked at alpha 0 rather than moved off-screen:
    // the shader discards it, and this avoids reallocating the buffer every frame.
    for (let i = cursor; i < this.signalAlpha.length; i++) this.signalAlpha[i] = 0;

    const geometry = this.signalPoints!.geometry;
    (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  /* ────────────────────────────── per-frame update ────────────────────────────── */

  private updateNodeMatrices(): void {
    if (!this.cores || !this.picker) return;
    const time = this.clock.getElapsedTime();
    this.nodes.forEach((node, i) => {
      // Resting shimmer, phase-offset per node so the cloud breathes rather than
      // pulsing in unison — unison reads as a screensaver.
      const breathe = 1 + Math.sin(time * 1.1 + i * 0.7) * 0.06;
      const excited = 1 + this.fire[i] * 1.25;
      const scale = node.size * breathe * excited;
      this.tmpMatrix.makeScale(scale, scale, scale);
      this.tmpMatrix.setPosition(node.x, node.y, node.z);
      this.cores!.setMatrixAt(i, this.tmpMatrix);

      const pick = node.size * 4.2;
      this.tmpMatrix.makeScale(pick, pick, pick);
      this.tmpMatrix.setPosition(node.x, node.y, node.z);
      this.picker!.setMatrixAt(i, this.tmpMatrix);

      const selected = this.selectedId === node.id;
      const hover = this.hovered?.id === node.id;
      const emphasis = selected ? 1.5 : hover ? 1.28 : 1;
      this.haloSize[i] = node.size * HALO_SCALE * (1 + this.fire[i] * 1.5) * emphasis * breathe;
      this.haloAlpha[i] =
        HALO_ALPHA[node.kind] * (1 + this.fire[i] * 1.4) * (selected || hover ? 1.4 : 1);
    });
    this.cores.instanceMatrix.needsUpdate = true;
    this.picker.instanceMatrix.needsUpdate = true;
    if (this.halos) {
      const geometry = this.halos.geometry;
      (geometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private updateEdges(dt: number): void {
    if (!this.lines || !this.layout) return;
    let dirty = false;
    for (let e = 0; e < this.edgeHeat.length; e++) {
      const heat = this.edgeHeat[e];
      if (heat <= 0) continue;
      const next = Math.max(0, heat - dt * EDGE_COOL_PER_SECOND);
      this.edgeHeat[e] = next;
      this.writeEdgeColor(e, this.layout.edges[e], next);
      dirty = true;
    }
    if (dirty) (this.lines.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Places the permanent labels, and — the part that matters — hides the ones that
   * would overlap.
   *
   * Nine lobes' worth of page names projected onto one screen collide constantly, and
   * three overlapping strings are less readable than one. So labels are placed nearest
   * first and each is tested against the boxes already taken; a loser is dropped for
   * this frame and gets its turn when the camera moves. An excited node always wins its
   * box, because the whole point of a label during a signal burst is to say what just
   * fired.
   */
  private updateLabels(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const candidates: { el: HTMLElement; x: number; y: number; fade: number; excite: number; w: number }[] = [];

    for (const [id, el] of this.labels) {
      const index = this.nodeIndex.get(id);
      if (index === undefined) continue;
      const node = this.nodes[index];
      this.tmpVec.set(node.x, node.y, node.z);
      this.world.localToWorld(this.tmpVec);
      const distance = this.tmpVec.distanceTo(this.camera.position);
      this.tmpVec.project(this.camera);
      // z outside [-1,1] means the node is behind the camera; projecting that gives a
      // mirrored on-screen position, so the label has to be hidden rather than placed.
      if (this.tmpVec.z > 1 || this.tmpVec.z < -1) {
        el.style.opacity = "0";
        continue;
      }
      const x = (this.tmpVec.x * 0.5 + 0.5) * width;
      const y = (-this.tmpVec.y * 0.5 + 0.5) * height - 16;
      // Fade with distance so the far side of the sphere doesn't overprint the near one.
      const fade = Math.max(0, Math.min(1, 1 - (distance - this.labelFade) / (this.labelFade * 1.6)));
      if (fade <= 0.02) {
        el.style.opacity = "0";
        continue;
      }
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      // offsetWidth would force a layout read per label per frame; the text is fixed at
      // build time, so an estimate from its length is both stable and free.
      const w = el.textContent!.length * 7 + 10;
      candidates.push({ el, x, y, fade, excite: this.fire[index] ?? 0, w });
    }

    candidates.sort((a, b) => b.excite - a.excite || b.fade - a.fade);
    for (const c of candidates) {
      const box = { x: c.x - c.w / 2, y: c.y - 7, w: c.w, h: 14 };
      const clash = placed.some(
        (p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y
      );
      if (clash && c.excite < 0.25) {
        c.el.style.opacity = "0";
        continue;
      }
      placed.push(box);
      c.el.style.opacity = String(Math.min(1, c.fade * 0.78 + c.excite * 0.9));
    }
  }

  private updateHover(): void {
    if (!this.picker || !this.pointerInside) {
      if (this.hovered) {
        this.hovered = null;
        this.onHover?.(null);
      }
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.picker, false);
    const instanceId = hits.length > 0 ? hits[0].instanceId : undefined;
    const node = instanceId === undefined ? null : this.nodes[instanceId] ?? null;
    if (node?.id === this.hovered?.id) return;
    this.hovered = node;
    this.renderer.domElement.style.cursor = node ? "pointer" : "grab";
    if (!node) {
      this.onHover?.(null);
      return;
    }
    this.tmpVec.set(node.x, node.y, node.z);
    this.world.localToWorld(this.tmpVec);
    this.tmpVec.project(this.camera);
    this.onHover?.({
      node,
      x: (this.tmpVec.x * 0.5 + 0.5) * this.container.clientWidth,
      y: (-this.tmpVec.y * 0.5 + 0.5) * this.container.clientHeight,
    });
  }

  /** Arrow keys orbit, shift+arrows pan, +/- zoom — the keyboard equivalent of the
   * mouse verbs, applied per frame so a held key glides instead of stepping. */
  private applyKeys(dt: number): void {
    if (this.keys.size === 0) return;
    const shift = this.keys.has("shift");
    const orbit = 1.15 * dt;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    let moved = false;

    const pan = (dx: number, dy: number) => {
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      const scale = spherical.radius * 0.6 * dt;
      const delta = right.multiplyScalar(dx * scale).add(up.multiplyScalar(dy * scale));
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      moved = true;
    };

    if (this.keys.has("arrowleft")) shift ? pan(-1, 0) : ((spherical.theta -= orbit), (moved = true));
    if (this.keys.has("arrowright")) shift ? pan(1, 0) : ((spherical.theta += orbit), (moved = true));
    if (this.keys.has("arrowup")) shift ? pan(0, 1) : ((spherical.phi -= orbit), (moved = true));
    if (this.keys.has("arrowdown")) shift ? pan(0, -1) : ((spherical.phi += orbit), (moved = true));
    if (this.keys.has("+") || this.keys.has("=")) {
      spherical.radius = Math.max(this.controls.minDistance, spherical.radius * (1 - dt * 1.3));
      moved = true;
    }
    if (this.keys.has("-") || this.keys.has("_")) {
      spherical.radius = Math.min(this.controls.maxDistance, spherical.radius * (1 + dt * 1.3));
      moved = true;
    }
    if (!moved) return;
    // Clamped off the poles: at exactly 0 or PI the up vector is undefined and the view
    // snaps through itself.
    spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    this.camera.lookAt(this.controls.target);
  }

  private tick = (): void => {
    if (!this.running || this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, this.clock.getDelta());

    this.applyKeys(dt);
    this.controls.update();

    // A slow yaw so the structure keeps offering new angles when nobody is driving. It
    // stops the moment the operator takes hold, or the view would fight the drag.
    if (!this.pointerInside && this.keys.size === 0) this.world.rotation.y += dt * 0.018;

    for (let i = 0; i < this.fire.length; i++) {
      if (this.fire[i] > 0) this.fire[i] = Math.max(0, this.fire[i] - dt * FIRE_DECAY_PER_SECOND);
    }

    this.advanceSignals(dt);
    this.updateEdges(dt);
    this.updateNodeMatrices();
    this.updateHover();
    this.updateLabels();
    this.composer.render();
  };

  /* ──────────────────────────────── lifecycle ──────────────────────────────── */

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerInside = true;
  };

  private onPointerLeave = (): void => {
    this.pointerInside = false;
  };

  private onClick = (): void => {
    // Click-to-select only when the pointer is genuinely over a node: OrbitControls
    // fires a click at the end of every drag, and clearing the selection because the
    // operator rotated the view would be maddening.
    if (!this.hovered) {
      this.selectedId = null;
      this.onSelect?.(null);
      return;
    }
    this.selectedId = this.hovered.id;
    this.onSelect?.(this.hovered);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const key = event.key.toLowerCase();
    if (key.startsWith("arrow")) event.preventDefault();
    this.keys.add(key);
    if (event.shiftKey) this.keys.add("shift");
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
    if (!event.shiftKey) this.keys.delete("shift");
  };

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("click", this.onClick);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  focusNode(id: string): void {
    const node = this.layout?.byId.get(id);
    if (!node) return;
    this.selectedId = id;
    this.tmpVec.set(node.x, node.y, node.z);
    this.world.localToWorld(this.tmpVec);
    this.controls.target.copy(this.tmpVec);
    const direction = this.camera.position.clone().sub(this.tmpVec).normalize();
    this.camera.position.copy(this.tmpVec).add(direction.multiplyScalar(52));
  }

  resetView(): void {
    this.selectedId = null;
    this.controls.target.set(0, 0, 0);
    this.world.rotation.set(0, 0, 0);
    this.frameGraph();
  }

  /** Pulls the camera back to exactly contain the graph's bounding sphere, accounting
   * for the *narrower* of the two fields of view — on a wide viewport the vertical one
   * binds, and fitting to the horizontal would crop the top and bottom off. */
  private frameGraph(): void {
    let radius = 1;
    for (const node of this.nodes) radius = Math.max(radius, Math.hypot(node.x, node.y, node.z));
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fov = Math.min(vFov, hFov);
    // 1.18 leaves a margin so labels sitting above their nodes stay on screen too.
    const distance = (radius * 1.18) / Math.sin(fov / 2);
    this.labelFade = distance * 0.95;
    this.camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance);
    this.camera.lookAt(0, 0, 0);
    this.controls.maxDistance = distance * 3;
  }

  resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private clearGraph(): void {
    for (const object of [this.halos, this.cores, this.picker, this.lines, this.signalPoints]) {
      if (!object) continue;
      this.world.remove(object);
      object.geometry.dispose();
      const material = object.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
    this.halos = this.cores = this.picker = null as never;
    this.lines = null;
    this.signalPoints = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("click", this.onClick);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.clearGraph();
    if (this.starfield) {
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
    }
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.labelLayer.innerHTML = "";
  }
}

/* ──────────────────────────────── small helpers ──────────────────────────────── */

function quadraticAt(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  t: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const inv = 1 - t;
  out.x = inv * inv * a.x + 2 * inv * t * b.x + t * t * c.x;
  out.y = inv * inv * a.y + 2 * inv * t * b.y + t * t * c.y;
  out.z = inv * inv * a.z + 2 * inv * t * b.z + t * t * c.z;
  return out;
}

function shuffled<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
