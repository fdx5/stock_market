import {
  ACESFilmicToneMapping, CanvasTexture, Color, DirectionalLight, EquirectangularReflectionMapping, Group, HemisphereLight,
  Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Texture, Vector2, WebGPUCoordinateSystem,
  type BufferGeometry, type Material, type Object3D,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
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

const HALL = STORAGE_ASSETS + "/trading-hall-v2.glb";
const ENV = STORAGE_ASSETS + "/lighting-v1.hdr";
const EYE = 1.66, RADIUS = .29;
const RAD = Math.PI / 180;
const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "ShiftLeft", "ShiftRight"]);
const ALL_OBSTACLES = [...FLOOR.obstacles, ...FLOOR.posts.map(({ x, z }) => ({ x, z, w: 4.44, d: 4.6 }))];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function walkable(x: number, z: number) {
  if (Math.abs(x) > FLOOR.room.width / 2 - FLOOR.room.sideInset || Math.abs(z) > FLOOR.room.depth / 2 - .53) return false;
  return !ALL_OBSTACLES.some(item => Math.abs(x - item.x) < item.w / 2 + RADIUS && Math.abs(z - item.z) < item.d / 2 + RADIUS);
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

function addContactShadows(scene: Scene) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const shade = ctx.createRadialGradient(64, 64, 18, 64, 64, 63);
  shade.addColorStop(0, "#000b");
  shade.addColorStop(.53, "#03030975");
  shade.addColorStop(1, "#0000");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 128, 128);
  const map = new CanvasTexture(canvas);
  const mat = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
  const geometry = new PlaneGeometry(1, 1);
  const pads = new Group();
  for (const { x, z } of FLOOR.posts) {
    const mesh = new Mesh(geometry, mat);
    mesh.position.set(x, .022, z);
    mesh.scale.set(5.8, 4.4, 1);
    mesh.rotation.x = -Math.PI / 2;
    pads.add(mesh);
  }
  for (const x of [-10.15, 10.15]) {
    const mesh = new Mesh(geometry, mat);
    mesh.position.set(x, .019, 7.6);
    mesh.scale.set(4.3, 3.6, 1);
    mesh.rotation.x = -Math.PI / 2;
    pads.add(mesh);
  }
  scene.add(pads);
  return () => { geometry.dispose(); mat.dispose(); map.dispose(); };
}

type Events = {
  renderer: (mode: "webgpu" | "webgl2") => void;
  position: (x: number, z: number, yaw: number) => void;
  select: (panel: string) => void;
  error: () => void;
};

export async function createFloor(host: HTMLDivElement, canvas: HTMLCanvasElement, signal: AbortSignal, events: Events): Promise<FloorDriver> {
  if (signal.aborted) throw signal.reason;
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.11;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const scene = new Scene();
  scene.background = new Color("#11101b");
  const camera = new PerspectiveCamera(65, 1, .06, 55);
  const sky = new HemisphereLight("#d9e0ff", "#493341", .74);
  const key = new DirectionalLight("#fff0df", 1.32);
  key.position.set(-5, 10, 6);
  const fill = new DirectionalLight("#a9bdff", .81);
  fill.position.set(7, 6, -8);
  scene.add(sky, key, fill);
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
    const binary = fetch(HALL, { signal }).then(response => {
      if (!response.ok) throw new Error("Trading hall model unavailable");
      return response.arrayBuffer();
    });
    await Promise.all([renderer.init(), binary]);
    if (signal.aborted) { dispose(); throw signal.reason; }
    const model = (await loader.parseAsync(await binary, STORAGE_ASSETS + "/")).scene;
    releases.push(() => releaseModel(model));
    if (signal.aborted) { dispose(); throw signal.reason; }
    scene.add(model);
    void new HDRLoader().loadAsync(ENV).then(texture => {
      if (disposed || signal.aborted) { texture.dispose(); return; }
      texture.mapping = EquirectangularReflectionMapping;
      scene.environment = environment = texture;
      scene.environmentIntensity = .52;
      scene.environmentRotation.y = -.23;
    }).catch(() => {});
    const shadows = addContactShadows(scene);
    if (shadows) releases.push(shadows);
    const screens = createScreens();
    scene.add(screens.group);
    releases.push(screens.dispose);

    const keys = new Set<string>();
    const state = { ...FLOOR.spawn };
    state.yaw *= RAD;
    let pitch = state.pitch;
    let touchX = 0, touchForward = 0, velX = 0, velZ = 0;
    let drag: { pointer: number; x: number; y: number; travel: number } | undefined;
    let last = 0, lastPosition = 0, lastHover = -Infinity, pushedPose = false, aspect = 1, dpr = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const measure = new URLSearchParams(location.search).has("exchangeMetrics");
    const frames: number[] = [];
    const pointer = new Vector2(), ray = new Raycaster();
    const backend = renderer.coordinateSystem === WebGPUCoordinateSystem ? "webgpu" : "webgl2";
    const pause = () => { keys.clear(); touchX = touchForward = velX = velZ = 0; };
    const isField = (event: KeyboardEvent) => event.target instanceof HTMLElement &&
      !!event.target.closest("input,button,select,textarea,a,[contenteditable],[role=dialog]");

    function resize() {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      dpr = window.devicePixelRatio || 1;
      aspect = camera.aspect = width / height;
      // Keep horizontal perspective usable on portrait screens without zooming the render resolution.
      camera.fov = aspect < 1 ? Math.min(98, Math.max(74, 2 * Math.atan(Math.tan(32 * RAD) / aspect) / RAD)) : 63;
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
      ray.far = 29;
      const hit = ray.intersectObjects(screens.targets, false)[0];
      if (!hit) return null;
      ray.far = hit.distance - .008;
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
        if (event.pointerType === "mouse" && !drag && event.timeStamp - lastHover >= 80) {
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
      pitch = clamp(pitch - dy * .0045, -.74, .88);
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

    function repaint(now: number) {
      if (!last) last = now;
      const elapsed = now - last, step = Math.min(elapsed / 1000, .033);
      last = now;
      if (measure && elapsed > 0) {
        frames.push(elapsed);
        if (frames.length > 2400) frames.splice(0, 600);
      }
      if (dpr !== (window.devicePixelRatio || 1)) resize();
      const axisX = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")) + touchX;
      const axisZ = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown")) + touchForward;
      const scale = ((keys.has("ShiftLeft") || keys.has("ShiftRight")) ? 4.5 : 2.75) / Math.max(1, Math.hypot(axisX, axisZ));
      const cos = Math.cos(state.yaw), sin = Math.sin(state.yaw);
      const blend = 1 - Math.exp(-step * 13);
      velX += ((axisX * cos - axisZ * sin) * scale - velX) * blend;
      velZ += ((-axisX * sin - axisZ * cos) * scale - velZ) * blend;
      const nx = state.x + velX * step, nz = state.z + velZ * step;
      if (walkable(nx, state.z)) state.x = nx;
      if (walkable(state.x, nz)) state.z = nz;
      const stride = reduced.matches ? 0 : clamp(Math.hypot(velX, velZ) / 2.75, 0, 1) * Math.sin(now * .009) * .022;
      camera.position.set(state.x, EYE + stride, state.z);
      camera.rotation.set(pitch, state.yaw, 0, "YXZ");
      screens.tick(now, reduced.matches);
      renderer.render(scene, camera);
      if (!pushedPose || now - lastPosition > 130) {
        pushedPose = true; lastPosition = now;
        events.position(state.x, state.z, state.yaw);
        if (measure && frames.length) {
          canvas.dataset.frameMs = frames.slice(-300).map(delta => delta.toFixed(2)).join(",");
          canvas.dataset.drawCalls = String(renderer.info.render.drawCalls);
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
    const accent = new DirectionalLight(MARKETS.kospi.color, .37);
    accent.position.set(0, 3.5, -10);
    scene.add(accent);
    events.renderer(backend);
    visibility();
    return {
      move(x, forward) { touchX = clamp(x, -1, 1); touchForward = clamp(forward, -1, 1); },
      jump(pose) {
        if (!walkable(pose.x, pose.z)) return;
        pause();
        state.x = pose.x; state.z = pose.z; state.yaw = pose.yaw * RAD; pitch = pose.pitch;
        canvas.focus({ preventScroll: true });
      },
      stop: pause,
      update(snapshot, series, language) {
        accent.color.set(MARKETS[snapshot.market].color);
        screens.update(snapshot, series, language);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
