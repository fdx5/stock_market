import {
  Color, EquirectangularReflectionMapping, HemisphereLight, Mesh, MeshStandardMaterial, NeutralToneMapping, PerspectiveCamera,
  Raycaster, SRGBColorSpace, Scene, Texture, TextureLoader, Vector2, WebGPUCoordinateSystem,
  type BufferGeometry, type Material, type Object3D,
} from "three";
import { RenderPipeline, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import bake from "./bake.json";
import { FLOOR, MARKETS, STORAGE_ASSETS, type FloorSnapshot, type Language } from "./market";
import { createScreens } from "./screens";

type Pose = { x: number; z: number; yaw: number; pitch: number };
type Captions = Record<string, number[]>;
export type FloorDriver = {
  move: (x: number, forward: number) => void;
  jump: (pose: Pose) => void;
  stop: () => void;
  update: (snapshot: FloorSnapshot, series: Captions, language: Language) => void;
  dispose: () => void;
};

const HALL = STORAGE_ASSETS + "/trading-hall-v3.glb";
const ENV = STORAGE_ASSETS + "/hall-env-v3.hdr";   // Cycles panorama of this hall
const EYE = 1.68, RADIUS = .32;
const RAD = Math.PI / 180;
const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "ShiftLeft", "ShiftRight"]);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function walkable(x: number, z: number) {
  const walk = FLOOR.walk;
  if (Math.abs(x) > walk.x || z < walk.zMin || z > walk.zMax) return false;
  if (FLOOR.obstacles.some(o => Math.abs(x - o.x) < o.w / 2 + RADIUS && Math.abs(z - o.z) < o.d / 2 + RADIUS)) return false;
  return !FLOOR.circles.some(c => Math.hypot(x - c.x, z - c.z) < c.r + RADIUS);
}

function releaseModel(root: Object3D) {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse(child => {
    if (!(child instanceof Mesh)) return;
    geometries.add(child.geometry);
    for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const texture of textures) {
    const data = texture.source?.data;
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap) data.close();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function groupOf(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node.name === "shell" || node.name === "fixtures" || node.name === "emit") return node.name;
  }
  return "props";
}

/** Texture quality for screen canvases: full on capable devices, lighter on small-memory phones. */
function screenQuality() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const coarse = matchMedia("(pointer: coarse)").matches;
  return memory <= 4 ? .62 : coarse ? .8 : 1;
}

type Events = {
  renderer: (mode: "webgpu" | "webgl2") => void;
  position: (x: number, z: number, yaw: number) => void;
  select: (panel: string) => void;
  progress?: (fraction: number) => void;
  error: () => void;
};

async function fetchWithProgress(url: string, signal: AbortSignal, progress?: (f: number) => void) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error("Trading hall model unavailable");
  const total = Number(response.headers.get("content-length")) || 13e6;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    progress?.(Math.min(.99, received / total));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out.buffer;
}

export async function createFloor(host: HTMLDivElement, canvas: HTMLCanvasElement, signal: AbortSignal, events: Events): Promise<FloorDriver> {
  if (signal.aborted) throw signal.reason;
  const params = new URLSearchParams(location.search);
  // Phones: dense pixels already hide edges, so skip MSAA there and start without bloom.
  const touch = matchMedia("(pointer: coarse)").matches;
  const dense = (window.devicePixelRatio || 1) >= 2;
  const renderer = new WebGPURenderer({ canvas, antialias: !(touch && dense), alpha: false, powerPreference: "high-performance" });
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = .92;   // comfortable for long viewing
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const scene = new Scene();
  scene.background = new Color("#120f0b");
  const camera = new PerspectiveCamera(62, 1, .08, 90);
  const sky = new HemisphereLight("#fff2dd", "#3a2a1c", .55);
  scene.add(sky);
  const releases: (() => void)[] = [];
  let disposed = false, frame = 0;
  let environment: Texture | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    for (const release of releases) release();
    environment?.dispose();
    renderer.dispose();
  };
  try {
    const textures = new TextureLoader();
    const lightmap = (file: string) => textures.loadAsync(STORAGE_ASSETS + "/" + file).then(tex => {
      tex.flipY = false;
      tex.channel = 1;
      tex.colorSpace = SRGBColorSpace;
      return tex;
    });
    const screens = createScreens(screenQuality());
    const [, binary, shellMap, fixtureMap] = await Promise.all([
      renderer.init(), fetchWithProgress(HALL, signal, events.progress),
      lightmap(bake.shell.file), lightmap(bake.fixtures.file), screens.ready(),
    ]);
    if (signal.aborted) { dispose(); throw signal.reason; }
    const model = (await loader.parseAsync(binary, STORAGE_ASSETS + "/")).scene;
    releases.push(() => { releaseModel(model); shellMap.dispose(); fixtureMap.dispose(); });
    if (signal.aborted) { dispose(); throw signal.reason; }

    // Baked global illumination: each lightmapped group gets its own material copies.
    const cloned = new Map<string, MeshStandardMaterial>();
    const propMaterials = new Set<MeshStandardMaterial>();
    model.traverse(child => {
      if (!(child instanceof Mesh)) return;
      const group = groupOf(child);
      child.matrixAutoUpdate = false;
      child.updateMatrix();
      const source = child.material as MeshStandardMaterial;
      if ((group === "shell" || group === "fixtures") && child.geometry.getAttribute("uv1")) {
        const key = group + ":" + source.uuid;
        let m = cloned.get(key);
        if (!m) {
          m = source.clone();
          m.lightMap = group === "shell" ? shellMap : fixtureMap;
          m.lightMapIntensity = (group === "shell" ? bake.shell.scale : bake.fixtures.scale) * Math.PI;
          m.envMapIntensity = m.metalness > .5 ? 1.0 : .55;
          cloned.set(key, m);
        }
        child.material = m;
      } else if (group === "emit") {
        // Daylight glazing reads as soft sky, not a glare source; lamps a touch dimmer for long sessions.
        if (source.name === "Daylight glazing") source.emissiveIntensity *= .6;
        else if (source.emissiveIntensity > 1) source.emissiveIntensity *= .8;
        if (source.transparent || source.name === "Balustrade glass") {
          source.transparent = true; source.opacity = .16; source.depthWrite = false;
        }
      } else {
        propMaterials.add(source);   // bronze bull, chandeliers, furniture: lit by the hall panorama
      }
    });
    scene.add(model);
    scene.add(screens.group);
    releases.push(screens.dispose);
    void new HDRLoader().loadAsync(ENV).then(texture => {
      if (disposed || signal.aborted) { texture.dispose(); return; }
      texture.mapping = EquirectangularReflectionMapping;
      scene.environment = environment = texture;
      for (const m of propMaterials) { m.envMap = texture; m.envMapIntensity = 1.7; m.needsUpdate = true; }
      // The panorama is the lit hall itself; lightmaps already carry diffuse light, so keep it modest.
      scene.environmentIntensity = .5;
    }).catch(() => {});

    // Bloom only on genuinely bright pixels: lamps, daylight, the brightest figures.
    let pipeline: RenderPipeline | undefined;
    if (params.get("bloom") === "1" || (params.get("bloom") !== "0" && !touch)) {
      pipeline = new RenderPipeline(renderer);
      const scenePass = pass(scene, camera);
      const color = scenePass.getTextureNode("output");
      pipeline.outputNode = color.add(bloom(color, .22, .4, .9));
      releases.push(() => pipeline?.dispose());
    }

    const keys = new Set<string>();
    const state = { ...FLOOR.spawn };
    state.yaw *= RAD;
    let pitch = state.pitch;
    let lookYaw = state.yaw, lookPitch = pitch;   // rendered view eases toward the dragged target
    let touchX = 0, touchForward = 0, velX = 0, velZ = 0;
    let drag: { pointer: number; x: number; y: number; travel: number } | undefined;
    let last = 0, lastPosition = 0, lastHover = -Infinity, pushedPose = false, aspect = 1, dpr = 0;
    let slowSince = 0, tier = 0, started = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const measure = params.has("exchangeMetrics");
    const frames: number[] = [];
    const recent: number[] = [];
    const pointer = new Vector2(), ray = new Raycaster();
    const backend = renderer.coordinateSystem === WebGPUCoordinateSystem ? "webgpu" : "webgl2";
    const pause = () => { keys.clear(); touchX = touchForward = velX = velZ = 0; };
    const isField = (event: KeyboardEvent) => event.target instanceof HTMLElement &&
      !!event.target.closest("input,button,select,textarea,a,[contenteditable],[role=dialog]");
    const maxRatio = () => Math.min(window.devicePixelRatio || 1, tier >= 2 ? 1.25 : tier >= 1 ? 1.6 : touch ? 2 : 2.5);

    function resize() {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      dpr = maxRatio();
      aspect = camera.aspect = width / height;
      camera.fov = aspect < 1 ? Math.min(96, Math.max(72, 2 * Math.atan(Math.tan(31 * RAD) / aspect) / RAD)) : 62;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    releases.push(() => observer.disconnect());
    resize();

    function pick(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      ray.far = 45;
      const hit = ray.intersectObjects(screens.targets, false)[0];
      if (!hit) return null;
      ray.far = hit.distance - .02;
      return ray.intersectObject(model, true).length ? null : hit.object.userData.panel as string;
    }

    function down(event: PointerEvent) {
      if (event.button !== 0 || drag) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 };
    }
    function move(event: PointerEvent) {
      if (!drag || drag.pointer !== event.pointerId) {
        if (event.pointerType === "mouse" && !drag && event.timeStamp - lastHover >= 90) {
          lastHover = event.timeStamp;
          canvas.style.cursor = pick(event.clientX, event.clientY) ? "pointer" : "grab";
        }
        return;
      }
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.x = event.clientX; drag.y = event.clientY;
      drag.travel += Math.abs(dx) + Math.abs(dy);
      if (drag.travel < 5) return;
      state.yaw -= dx * .0045;
      pitch = clamp(pitch - dy * .0045, -.8, 1.15);
      canvas.style.cursor = "grabbing";
    }
    function up(event: PointerEvent) {
      if (!drag || drag.pointer !== event.pointerId) return;
      const choose = event.type === "pointerup" && drag.travel < 8;
      drag = undefined;
      canvas.style.cursor = "grab";
      if (!choose) return;
      const panel = pick(event.clientX, event.clientY);
      if (panel) { pause(); events.select(panel); }
    }
    function keydown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || isField(event) || document.querySelector(".ng-dialog")) return;
      if (event.code === "Enter" && event.target === canvas) {
        const rect = canvas.getBoundingClientRect();
        const panel = pick(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (panel) { event.preventDefault(); pause(); events.select(panel); }
      }
      if (KEYS.has(event.code)) { event.preventDefault(); keys.add(event.code); }
    }
    const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };

    function govern(elapsed: number, now: number) {
      // Hold 60 fps: shed bloom first, then cap the pixel ratio; resolution goes only when needed.
      // Ignore the first seconds: pipeline compiles and the first paint of every display are one-off.
      if (!started) started = now;
      if (now - started < 6000) return;
      recent.push(elapsed);
      if (recent.length > 90) recent.shift();
      if (recent.length < 90 || tier >= 3) return;
      const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
      if (avg > 18.2) {
        if (!slowSince) slowSince = now;
        if (now - slowSince > 2500) {
          tier++;
          slowSince = 0;
          recent.length = 0;
          if (tier === 1 && pipeline) { pipeline.dispose(); pipeline = undefined; tier = 1; } else resize();
          canvas.dataset.qualityTier = String(tier);
        }
      } else slowSince = 0;
    }

    function repaint(now: number) {
      if (!last) last = now;
      const elapsed = now - last, step = Math.min(elapsed / 1000, .033);
      last = now;
      if (elapsed > 0 && elapsed < 250) govern(elapsed, now);
      if (measure && elapsed > 0) {
        frames.push(elapsed);
        if (frames.length > 2400) frames.splice(0, 600);
      }
      if (dpr !== maxRatio()) resize();
      const axisX = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")) + touchX;
      const axisZ = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown")) + touchForward;
      const scale = ((keys.has("ShiftLeft") || keys.has("ShiftRight")) ? 5.2 : 3.0) / Math.max(1, Math.hypot(axisX, axisZ));
      const cos = Math.cos(state.yaw), sin = Math.sin(state.yaw);
      const blend = 1 - Math.exp(-step * 8);   // gentle acceleration and glide
      velX += ((axisX * cos - axisZ * sin) * scale - velX) * blend;
      velZ += ((-axisX * sin - axisZ * cos) * scale - velZ) * blend;
      const nx = state.x + velX * step, nz = state.z + velZ * step;
      if (walkable(nx, state.z)) state.x = nx;
      if (walkable(state.x, nz)) state.z = nz;
      const stride = reduced.matches ? 0 : clamp(Math.hypot(velX, velZ) / 3, 0, 1) * Math.sin(now * .0085) * .02;
      camera.position.set(state.x, EYE + stride, state.z);
      const ease = 1 - Math.exp(-step * 22);
      lookYaw += (state.yaw - lookYaw) * ease;
      lookPitch += (pitch - lookPitch) * ease;
      camera.rotation.set(lookPitch, lookYaw, 0, "YXZ");
      screens.tick(now, reduced.matches);
      if (pipeline) pipeline.render(); else renderer.render(scene, camera);
      if (!pushedPose || now - lastPosition > 130) {
        pushedPose = true; lastPosition = now;
        events.position(state.x, state.z, state.yaw);
        if (measure && frames.length) {
          canvas.dataset.frameMs = frames.slice(-300).map(delta => delta.toFixed(2)).join(",");
          canvas.dataset.drawCalls = String(renderer.info.render.drawCalls);
          canvas.dataset.triangles = String(renderer.info.render.triangles);
          canvas.dataset.pose = [state.x, state.z, state.yaw].map(v => v.toFixed(2)).join(",");
          canvas.dataset.paintMs = JSON.stringify(screens.paintMs);
        }
      }
      if (dpr && aspect) frame = requestAnimationFrame(repaint);
    }
    const visibility = () => {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; last = 0; pause(); }
      else if (!disposed && !frame) frame = requestAnimationFrame(repaint);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", visibility);
    releases.push(() => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", visibility);
    });
    renderer.onDeviceLost = () => { dispose(); if (!signal.aborted) events.error(); };
    // Compile every pipeline up front so the first walk-around never hitches.
    await renderer.compileAsync(scene, camera);
    if (signal.aborted) { dispose(); throw signal.reason; }
    events.renderer(backend);
    visibility();
    return {
      move(x, forward) { touchX = clamp(x, -1, 1); touchForward = clamp(forward, -1, 1); },
      jump(pose) {
        if (!walkable(pose.x, pose.z)) return;
        pause();
        state.x = pose.x; state.z = pose.z; state.yaw = lookYaw = pose.yaw * RAD; pitch = lookPitch = pose.pitch;
        canvas.focus({ preventScroll: true });
      },
      stop: pause,
      update(snapshot, series, language) {
        sky.color.set("#fff2dd").lerp(new Color(MARKETS[snapshot.market].color), .08);
        screens.update(snapshot, series, language);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
