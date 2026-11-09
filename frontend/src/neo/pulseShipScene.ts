import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { OceanView, PulseHorizonController } from "./pulseHorizonRenderer";
import type { Mood } from "./pulseHorizonShaders";

export interface ShipCargo { code: string; name: string; label: string; change: number | null; logo: string; color: string }
export interface ShipState { mood: Mood; hullName: string; hullSub: string; hullLogo: string; cargo: ShipCargo[]; focus: boolean }

const WATERLINE = -1.2;
/** On the physical ocean one ship unit is 8.75 m: a 210 m hull, small enough to leave sea around it. */
const METRES = 8.75;
const HALF_LENGTH = 12 * METRES, HALF_BEAM = 2.4 * METRES;
const MOOD_LIGHT: Record<Mood, { rim: number; neon: number; sky: number }> = {
  down: { rim: 0x4f9dff, neon: 0x5ab4ff, sky: 0x29407a },
  calm: { rim: 0xb47dff, neon: 0xc08cff, sky: 0x3d2a63 },
  up: { rim: 0xff8a3a, neon: 0xffa23c, sky: 0x5e2a1c },
};
const images = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(src: string) {
  if (!images.has(src)) images.set(src, new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  }));
  return images.get(src)!;
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** A placard for one container side, built to read at ~80x35 px: a big logo, the name in
 * one or two heavy lines, and the move as a thick colour band rather than small digits. */
function nameLines(label: string) {
  if (label.length <= 5 || /^[A-Z0-9.\- ]+$/.test(label)) return [label];
  const cut = Math.ceil(label.length / 2);
  return [label.slice(0, cut), label.slice(cut)];
}
async function paintPlacard(canvas: HTMLCanvasElement, cargo: ShipCargo) {
  const g = canvas.getContext("2d")!, w = canvas.width, h = canvas.height;
  const tone = cargo.change == null || cargo.change === 0 ? "#8a8296" : cargo.change > 0 ? "#ff2d55" : "#2f86ff";
  // A thick frame in the move's colour around a pure white board: reads against any box colour, at dusk, from afar.
  const frame = Math.round(h * .075);
  g.fillStyle = tone; g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff"; roundRect(g, frame, frame, w - frame * 2, h - frame * 2, h * .05); g.fill();
  const size = h - frame * 2 - 20, x = frame + 12, y = frame + 10;
  const image = await loadImage(cargo.logo);
  g.save(); roundRect(g, x, y, size, size, size * .18); g.clip();
  if (image) g.drawImage(image, x, y, size, size);
  else { g.fillStyle = tone; g.fillRect(x, y, size, size); g.fillStyle = "#fff"; g.font = `900 ${size * .46}px Pretendard, "Malgun Gothic", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(cargo.name.slice(0, 2), x + size / 2, y + size / 2); }
  g.restore();
  const lines = nameLines(cargo.label), textX = x + size + 20, room = w - textX - frame - 12, inner = h - frame * 2 - 8;
  let font = Math.min(inner / lines.length * .9, 210);
  g.textAlign = "left"; g.textBaseline = "middle"; g.fillStyle = "#000000";
  const widest = () => Math.max(...lines.map(line => g.measureText(line).width));
  do { g.font = `900 ${font}px Pretendard, "Malgun Gothic", sans-serif`; font -= 3; } while (widest() > room && font > 36);
  const lineHeight = inner / lines.length;
  lines.forEach((line, index) => g.fillText(line, textX, frame + 4 + lineHeight * (index + .54)));
}

/** The hull-side name: the company's logo badge, then luminous letters, on a transparent board. */
async function paintHullName(canvas: HTMLCanvasElement, name: string, sub: string, neon: string, logo: string) {
  const image = await loadImage(logo);
  const g = canvas.getContext("2d")!, w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  const badge = h * .9, bx = w * .02, by = (h - badge) / 2;
  g.save(); g.shadowColor = neon; g.shadowBlur = h * .18;
  roundRect(g, bx, by, badge, badge, badge * .24); g.fillStyle = "#fff"; g.fill(); g.restore();
  g.save(); roundRect(g, bx, by, badge, badge, badge * .24); g.clip();
  if (image) g.drawImage(image, bx + badge * .1, by + badge * .1, badge * .8, badge * .8);
  else { g.fillStyle = "#1a1224"; g.font = `800 ${badge * .45}px Pretendard, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(name.slice(0, 2), bx + badge / 2, by + badge / 2); }
  g.restore();
  g.textBaseline = "middle"; g.textAlign = "left";
  const textX = bx + badge + h * .28;
  let font = h * .78;
  do { g.font = `800 ${font}px Pretendard, "Malgun Gothic", sans-serif`; font -= 4; } while (g.measureText(name).width > w * .7 - textX && font > 30);
  g.shadowColor = neon; g.shadowBlur = h * .14; g.fillStyle = "#f6f2ff"; g.fillText(name, textX, h * .54);
  g.shadowBlur = 0;
  g.font = `600 ${h * .2}px "IBM Plex Mono", monospace`; g.textAlign = "right"; g.fillStyle = neon;
  g.fillText(sub, w * .985, h * .78);
}

export type ShipHit = { kind: "cargo"; index: number } | { kind: "ship" } | null;
export interface ShipSceneHandle { dispose(): void; update(state: ShipState): void; hit(clientX: number, clientY: number): ShipHit }

/** Loads the Blender ship and sails it on the pulse sea, riding the same heartbeat waves. */
export function installShipScene(canvas: HTMLCanvasElement, controller: { current: PulseHorizonController | null }, still: boolean, onReady: () => void, onError: (error: unknown) => void): ShipSceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  let environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  scene.environment = environment;
  scene.environmentIntensity = .55;
  // On the ocean the hull reflects the same dusk sky the sea does: a gradient dome rebuilt as the mood glides.
  const skyUniforms = { u_zenith: { value: new THREE.Color() }, u_haze: { value: new THREE.Color() }, u_sun: { value: new THREE.Vector3(0, .1, -1) } };
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: skyUniforms,
    vertexShader: `varying vec3 v_d; void main(){ v_d = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 u_zenith; uniform vec3 u_haze; uniform vec3 u_sun; varying vec3 v_d;
      void main(){ vec3 d = normalize(v_d); float e = d.y;
        vec3 c = mix(u_haze, u_zenith, smoothstep(0., .35, e));
        c = mix(c, u_haze * .35, smoothstep(0., -.25, e));
        float s = max(dot(d, normalize(u_sun)), 0.);
        c += u_haze * (pow(s, 6.) * 1.5 + pow(s, 80.) * 6.);
        gl_FragColor = vec4(c, 1.); }`,
  }));
  const skyScene = new THREE.Scene(); skyScene.add(skyDome);
  let skyKey = "", skyAt = -9;
  function refreshSky(view: OceanView) {
    const key = view.haze.map(v => v.toFixed(2)).join();
    if (key === skyKey || time - skyAt < .5) return;
    skyKey = key; skyAt = time;
    skyUniforms.u_haze.value.setRGB(view.haze[0], view.haze[1], view.haze[2], THREE.SRGBColorSpace);
    skyUniforms.u_zenith.value.copy(skyUniforms.u_haze.value).multiplyScalar(.08);
    skyUniforms.u_sun.value.set(view.sun[0], Math.max(view.sun[1], .06), -view.sun[2]);
    const next = pmrem.fromScene(skyScene, 0, .1, 100).texture;
    environment.dispose(); environment = next; scene.environment = next; scene.environmentIntensity = 1.1;
  }
  const camera = new THREE.PerspectiveCamera(18, 1, 1, 400);
  const hemi = new THREE.HemisphereLight(0x3d2a63, 0x05030a, .9);
  const key = new THREE.DirectionalLight(0xfff1e2, 2.4); key.position.set(-18, 26, 30);
  // Sun shadows on the ocean: containers shade each other and the deck. Redrawn every frame only while near.
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const shadowSize = matchMedia("(pointer: coarse)").matches ? 1024 : 2048;
  key.shadow.mapSize.set(shadowSize, shadowSize); key.shadow.bias = -.0004; key.shadow.normalBias = .4;
  let shadowFrame = 0;
  const rim = new THREE.DirectionalLight(0xb47dff, 2.2); rim.position.set(14, 10, -30);
  const fill = new THREE.DirectionalLight(0xb47dff, .45); fill.position.set(10, -4, 24);
  scene.add(hemi, key, rim, fill);
  const water = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATERLINE);       // keep above the sea
  const mirrorClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), WATERLINE); // reflection lives below it
  const rig = new THREE.Group(), ship = new THREE.Group(), reflection = new THREE.Group();
  // voyage: course and heading across the sea; rig: the hull's own heave, pitch and roll on top of it
  const voyage = new THREE.Group();
  rig.add(ship); voyage.add(rig); scene.add(voyage, reflection);

  const placards: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; key: string }[] = [];
  const boxMaterials: THREE.MeshStandardMaterial[] = [];
  const neonMaterials: THREE.MeshStandardMaterial[] = [];
  let hullCanvas: HTMLCanvasElement | null = null, hullTexture: THREE.CanvasTexture | null = null, hullKey = "";
  let radar: THREE.Object3D | null = null, mastLight: THREE.MeshStandardMaterial | null = null;
  let disposed = false, frame = 0, last = 0, time = 0, ready = false, lastWake = 0;
  let pending: ShipState | null = null, mood: Mood = "calm";
  let width = 0, height = 0, ratio = 0, unitsShown = 1, sailing = false, phone = false;
  const motion = { heave: 0, heaveV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0 };
  let seaMean = 0;
  // Ocean voyage: 0..1 along a course from broadside near the viewer to hull-down at the right horizon.
  // ?shipAt=<metres> starts the voyage part-way (visual checks)
  let along = Number(new URLSearchParams(location.search).get("shipAt")) || 0, waterY = WATERLINE, oceanMode = false;
  const fog = new THREE.Fog(0x1a1024, 0, 9000);

  // wake + waterline glow: soft additive ellipses on the sea plane
  const glowCanvas = document.createElement("canvas"); glowCanvas.width = glowCanvas.height = 128;
  { const g = glowCanvas.getContext("2d")!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64); grad.addColorStop(0, "#fff"); grad.addColorStop(.35, "#ffffff66"); grad.addColorStop(1, "#fff0"); g.fillStyle = grad; g.fillRect(0, 0, 128, 128); }
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  // Light-only blending: adds colour but never raises the canvas alpha, so the pulse sea stays visible beneath.
  const lightOnly = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;
  const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xb47dff, transparent: true, opacity: .55, depthWrite: false, ...lightOnly, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(30, 7.5), glowMaterial); foam.rotation.x = -Math.PI / 2; foam.position.y = WATERLINE + .01;
  // Stern wake: propeller wash, the Kelvin V with its feathered crests, and the bow wave.
  const wakeUniforms = { u_time: { value: 0 }, u_color: { value: new THREE.Color(0xb47dff) }, u_opacity: { value: 1 }, u_speed: { value: 1 } };
  const wakeMaterial = new THREE.ShaderMaterial({
    uniforms: wakeUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...lightOnly, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    vertexShader: `varying vec2 v_p; void main(){ v_p = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `
      uniform float u_time; uniform vec3 u_color; uniform float u_opacity; uniform float u_speed;
      varying vec2 v_p;
      float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.07 + 3.1; a *= .5; } return s; }
      void main(){
        // plane local: x runs aft from the stern (d >= 0 behind it), y across the ship
        float d = 22. - v_p.x, y = v_p.y, t = u_time * u_speed;
        vec3 col = vec3(0.);
        if (d > 0.) {
          // propeller wash: churning white water, widening and thinning astern
          float width = .55 + d * .085;
          float churn = fbm(vec2(d * 1.15 + t * 2.4, y * 3.2 / width)) * .8 + fbm(vec2(d * 3.1 + t * 3.5, y * 7.)) * .45;
          float wash = exp(-y * y / (width * width)) * exp(-d / 13.) * smoothstep(0., .5, d);
          float foam = wash * smoothstep(.42, .95, churn) * 1.6 + wash * .35;
          // Kelvin V: two divergent arms at 19.5 degrees, each a ridge of short crests
          float arm = abs(y) - d * .354, armWidth = .1 + d * .016;
          float arms = exp(-arm * arm / (armWidth * armWidth)) * exp(-d / 17.) * (.55 + .45 * sin(d * 3.4 - t * 3.2 + abs(y) * 2.));
          // transverse crests feathering inside the V, moving with the ship
          float inside = smoothstep(.02, -.35, arm) * smoothstep(0., 1.2, d);
          float crest = pow(.5 + .5 * sin(d * 2.3 + y * y * .55 - t * 2.6), 7.) * inside * exp(-d / 11.) * .55;
          float sparkle = step(.93, n(vec2(d * 6. + t * 4., y * 9.))) * wash * .8;
          col += vec3(1.) * (foam + sparkle) * .9 + u_color * (arms * .95 + crest + wash * .25);
          col += vec3(1.) * arms * .25;
        } else {
          // bow wave: white water folding back along both sides from the stem
          float b = 24.4 + d;                 // 0 at the bow tip, growing aft (d < 0 ahead of the stern)
          float side = abs(y) - (2.35 - exp(-max(b, 0.) * .9) * 2.35);
          float bow = exp(-side * side / .03) * smoothstep(-.2, .4, -b + 4.) * smoothstep(-.6, .3, b);
          bow *= .6 + .4 * fbm(vec2(b * 2. - t * 2., y * 4.));
          col += (vec3(1.) * .85 + u_color * .5) * bow * exp(-max(b, 0.) / 3.);
        }
        float edge = smoothstep(9., 7., abs(y)) * smoothstep(42., 36., d);
        gl_FragColor = vec4(col * u_opacity * edge, 1.);
      }`,
  });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(94, 18, 1, 1), wakeMaterial);
  // plane x = +22 sits on the stern (ship x = -12); its forward end reaches past the bow
  wake.rotation.x = -Math.PI / 2; wake.position.set(-34, WATERLINE + .02, 0);
  voyage.add(foam, wake);

  const loader = new GLTFLoader();
  loader.load("/3d/pulse-ship.glb", gltf => {
    if (disposed) return;
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    // Static parts are merged per material: ~280 nodes become a few dozen draws.
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const keep: THREE.Object3D[] = [];
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = mesh.name || mesh.parent?.name || "";
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (/^(LogoPlate|LogoBox|Radar|HullName|Light|Neon)/.test(name) || /^(Neon|FunnelBand)/.test(material.name)) { keep.push(mesh); return; }
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      for (const key of Object.keys(geometry.attributes)) if (!["position", "normal", "uv"].includes(key)) geometry.deleteAttribute(key);
      if (!geometry.attributes.uv) geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
      const list = groups.get(material) ?? []; list.push(geometry.index ? geometry.toNonIndexed() : geometry); groups.set(material, list);
    });
    for (const [material, list] of groups) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      material.clippingPlanes = [water];
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = mesh.receiveShadow = true;
      for (const map of [(material as THREE.MeshStandardMaterial).map, (material as THREE.MeshStandardMaterial).normalMap]) if (map) map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      ship.add(mesh);
    }
    for (const mesh of keep as THREE.Mesh[]) {
      mesh.updateMatrixWorld(true);
      const name = mesh.name || mesh.parent?.name || "";
      const clone: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = new THREE.Mesh(mesh.geometry, (mesh.material as THREE.Material).clone());
      clone.applyMatrix4(mesh.matrixWorld);
      clone.name = name;
      const material = clone.material as THREE.MeshStandardMaterial;
      material.clippingPlanes = [water];
      if (name.startsWith("LogoPlate")) {
        const placard = document.createElement("canvas"); placard.width = 1024; placard.height = 400;
        // glTF UVs start top-left: canvas textures must not be flipped again.
        const texture = new THREE.CanvasTexture(placard); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy()); texture.flipY = false;
        texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
        placards[Number(name.slice(-2))] = { canvas: placard, texture, key: "" };
        // Self-lit: placards stay crisp and bright whatever the sea colour or tone mapping does.
        clone.material = new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff, toneMapped: false, clippingPlanes: [water], polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      } else if (name.startsWith("LogoBox")) boxMaterials.push(material);
      else if (name === "HullName") {
        hullCanvas = document.createElement("canvas"); hullCanvas.width = 2048; hullCanvas.height = 124;
        hullTexture = new THREE.CanvasTexture(hullCanvas); hullTexture.colorSpace = THREE.SRGBColorSpace; hullTexture.anisotropy = 8; hullTexture.flipY = false;
        clone.material = new THREE.MeshBasicMaterial({ map: hullTexture, transparent: true, depthWrite: false, toneMapped: false, clippingPlanes: [water], polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        clone.renderOrder = 2;
      } else if (name === "Radar") radar = clone;
      else if (name === "LightMast") mastLight = material;
      if (/^Neon|FunnelBand/.test(material.name) || name.startsWith("Neon")) neonMaterials.push(material);
      ship.add(clone);
    }
    // centre the hull on the origin so the rig pivots about midships at the waterline
    const box = new THREE.Box3().setFromObject(ship), centre = box.getCenter(new THREE.Vector3());
    ship.position.x -= centre.x;
    // A faint mirrored hull on the sea: the same meshes, flipped under the waterline.
    ship.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = (mesh.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
      material.transparent = true; material.opacity = .1; material.depthWrite = false; material.clippingPlanes = [mirrorClip];
      const copy = new THREE.Mesh(mesh.geometry, material);
      copy.matrixAutoUpdate = false;
      copy.userData.source = mesh;
      reflection.add(copy);
    });
    ready = true;
    if (pending) apply(pending);
    onReady();
    sync();
  }, undefined, error => { if (!disposed) onError(error); });

  async function apply(state: ShipState) {
    pending = state; mood = state.mood;
    if (!ready) return;
    const light = MOOD_LIGHT[mood];
    for (const material of neonMaterials) { material.emissive.setHex(light.neon); }
    const neonCss = `#${light.neon.toString(16).padStart(6, "0")}`;
    const nextHull = `${state.hullName}|${state.hullSub}|${neonCss}|${state.hullLogo}`;
    if (hullCanvas && hullTexture && hullKey !== nextHull) {
      hullKey = nextHull;
      const canvasRef = hullCanvas, textureRef = hullTexture;
      void paintHullName(canvasRef, state.hullName, state.hullSub, neonCss, state.hullLogo).then(() => { if (hullKey === nextHull) { textureRef.needsUpdate = true; if (still) render(); } });
    }
    boxMaterials.forEach((material, index) => {
      const cargo = state.cargo[index % Math.max(1, state.cargo.length)];
      if (cargo) material.color.set(cargo.color).multiplyScalar(material.map ? .62 : .32);
    });
    await Promise.all(placards.map(async (placard, index) => {
      const cargo = state.cargo[index % Math.max(1, state.cargo.length)];
      if (!placard || !cargo) return;
      const key = `${cargo.code}|${cargo.change}|${cargo.label}`;
      if (placard.key === key) return;
      placard.key = key;
      await paintPlacard(placard.canvas, cargo);
      if (placard.key === key) placard.texture.needsUpdate = true;
    }));
    if (still) render();
  }

  function layout() {
    const box = canvas.getBoundingClientRect();
    if (box.width === width && box.height === height && ratio === devicePixelRatio) return;
    width = box.width; height = box.height; ratio = devicePixelRatio || 1;
    renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    // Desktop: the whole ship fits. Phones: a container stays >= ~64 px wide, so the ship sails across.
    // The ship sails across, so it is sized for legible containers rather than to fit the width.
    // Phones: containers ~58 px wide (still legible), so the hull spans ~2.5 screens instead of 3+.
    const fitHeight = height * .94 / 7.1, legible = 58 / 1.45;
    const pixelsPerUnit = Math.max(width < 760 ? legible : 0, Math.min(fitHeight, width * 1.1 / 26));
    phone = width < 760;
    sailing = 26 * pixelsPerUnit > width * .98;
    unitsShown = height / pixelsPerUnit;
    const distance = unitsShown / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const lookY = 1.85, tilt = THREE.MathUtils.degToRad(7.5);
    camera.position.set(0, lookY + Math.sin(tilt) * distance, Math.cos(tilt) * distance);
    camera.lookAt(0, lookY, 0);
    camera.updateProjectionMatrix();
  }

  function render() {
    layout();
    renderer.render(scene, camera);
  }

  function frameStep(now: number) {
    frame = 0;
    if (disposed || document.hidden) return;
    const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now; time += dt;
    const light = MOOD_LIGHT[mood];
    const view = controller.current?.view?.();
    if (view) { oceanStep(view, dt, light); return; }
    if (oceanMode) leaveOcean();
    rim.color.lerp(new THREE.Color(light.rim), 1 - Math.exp(-dt * 1.5));
    fill.color.copy(rim.color);
    hemi.color.lerp(new THREE.Color(light.sky), 1 - Math.exp(-dt * 1.5));
    glowMaterial.color.copy(rim.color);
    wakeUniforms.u_color.value.copy(rim.color); wakeUniforms.u_time.value = time;
    layout();
    // Sailing course: in from the lower left close to the camera, away toward the upper right.
    // Slow while near so the placards can be read, quicker as the hull shrinks toward the horizon.
    // A phone's band is narrow: a slower, flatter passage keeps the hull on screen longer.
    const passage = phone ? 58 : sailing ? 52 : 46;
    const u = ((time + passage * .22) % passage) / passage, progress = Math.pow(u, 1.55);
    const halfWidth = (z: number) => (camera.position.z - z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    // Fully off the left edge up close, fully off the right edge when far: it never sinks or pops.
    const nearZ = 3, farZ = phone ? -6 : -15, startX = -(halfWidth(nearZ) + 12), endX = halfWidth(farZ) + 15;
    const hullDown = 0;
    voyage.position.set(THREE.MathUtils.lerp(startX, endX, progress), -hullDown, THREE.MathUtils.lerp(nearZ, farZ, progress));
    voyage.rotation.y = Math.atan2(nearZ - farZ, endX - startX);
    // foam and wake stay on the sea surface and fade as the hull goes down
    foam.position.y = wake.position.y = WATERLINE + .01 + hullDown;
    const surface = 1 - hullDown / 7.5;
    glowMaterial.opacity = .55 * surface;
    voyage.updateMatrixWorld(true);
    // Where the hull sits on screen, for sampling the sea and dropping wakes.
    const toScreen = (local: THREE.Vector3) => {
      const ndc = local.applyMatrix4(voyage.matrixWorld).project(camera), box = canvas.getBoundingClientRect();
      return (box.left + (ndc.x + 1) / 2 * box.width) / Math.max(1, innerWidth);
    };
    const screenX = toScreen(new THREE.Vector3(0, WATERLINE, 0));
    const sternX = toScreen(new THREE.Vector3(-12, WATERLINE, 0));
    // Bow and stern sit about a ship's length apart on screen; sample the sea there.
    const halfSpan = Math.abs(toScreen(new THREE.Vector3(11, WATERLINE, 0)) - toScreen(new THREE.Vector3(-11, WATERLINE, 0))) / 2;
    const swell = controller.current?.sampleSwell(screenX, Math.max(.04, halfSpan)) ?? { height: 0, slope: 0, cross: 0 };
    // Ride the sea relative to its own running mean, so long-term level changes never lift the hull away.
    seaMean += (swell.height - seaMean) * (1 - Math.exp(-dt * .25));
    const ocean = Math.sin(time * .62) * .05 + Math.sin(time * .41 + 1.7) * .035;
    const targetHeave = THREE.MathUtils.clamp(ocean + (swell.height - seaMean) * 2.2, -.34, .38);
    const targetPitch = THREE.MathUtils.clamp(Math.sin(time * .52 + .6) * .008 + swell.slope * .085, -.045, .045);
    const targetRoll = THREE.MathUtils.clamp(Math.sin(time * .37) * .016 + swell.cross * .22, -.055, .055);
    for (const [value, velocity, target, stiffness, damping] of [["heave", "heaveV", targetHeave, 7, 3.2], ["pitch", "pitchV", targetPitch, 9, 3.6], ["roll", "rollV", targetRoll, 6, 2.6]] as const) {
      motion[velocity] += ((target - motion[value]) * stiffness - motion[velocity] * damping) * dt;
      motion[value] += motion[velocity] * dt;
    }
    rig.position.set(0, motion.heave, 0);
    rig.rotation.set(motion.roll, 0, motion.pitch);
    foam.scale.set(1 + Math.abs(swell.height - seaMean) * 1.2, 1, 1);
    wakeUniforms.u_opacity.value = .85 * surface;
    voyage.updateMatrixWorld(true);
    for (const copy of reflection.children as THREE.Mesh[]) {
      // mirror across the fixed waterline plane
      const source = copy.userData.source as THREE.Mesh;
      copy.matrix.makeTranslation(0, 2 * waterY, 0).multiply(new THREE.Matrix4().makeScale(1, -1, 1)).multiply(source.matrixWorld);
    }
    if (radar) radar.rotation.y += dt * 1.4;
    if (mastLight) mastLight.emissiveIntensity = Math.sin(time * 3.2) > .55 ? 22 : 3;
    if (time - lastWake > 2.8 && screenX > -.05 && screenX < 1.05) { lastWake = time; controller.current?.emit(Math.min(1, Math.max(0, sternX)), .26 * (1 - progress * .6), false); }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(frameStep);
  }
  /**
   * A real ship's track: broadside to the right until mid-screen, a steady turn,
   * then straight away toward the right horizon. Returns position (m, relative to the eye) and heading.
   */
  function course(metres: number, view: OceanView) {
    const aspect = view.aspect, F = view.F;
    const d0 = Math.max(220, 300 * F / (aspect * 2 * 1.15)), dEnd = 9000; // framing kept from the 300 m hull
    // the turn is sized to the view so it happens mid-screen instead of sweeping off the right edge
    const halfView = d0 * aspect / F, R = halfView * 1.55;
    const x0 = -(1 + HALF_LENGTH * F / (d0 * aspect)) * aspect * d0 / F - 30, xTurn = -halfView * .6;
    const xEnd = .72 * aspect * dEnd / F;
    // the exit heading must point at the horizon mark from wherever the turn ends
    let theta = 1;
    for (let i = 0; i < 6; i++) theta = Math.atan2(dEnd - (d0 + R * (1 - Math.cos(theta))), xEnd - (xTurn + R * Math.sin(theta)));
    const l1 = xTurn - x0, l2 = R * theta;
    const exit = { x: xTurn + R * Math.sin(theta), z: d0 + R * (1 - Math.cos(theta)) };
    const l3 = Math.hypot(xEnd - exit.x, dEnd - exit.z), total = l1 + l2 + l3;
    const s = Math.max(0, Math.min(total, metres));
    if (s <= l1) return { x: x0 + s, z: d0, heading: 0, d0, total };
    if (s <= l1 + l2) { const phi = (s - l1) / R; return { x: xTurn + R * Math.sin(phi), z: d0 + R * (1 - Math.cos(phi)), heading: phi, d0, total }; }
    const t = s - l1 - l2;
    return { x: exit.x + Math.cos(theta) * t, z: exit.z + Math.sin(theta) * t, heading: theta, d0, total };
  }
  function leaveOcean() {
    oceanMode = false; waterY = WATERLINE; water.constant = -WATERLINE; mirrorClip.constant = WATERLINE;
    voyage.scale.setScalar(1); scene.fog = null; reflection.visible = true; wake.visible = true; foam.visible = true; controller.current?.setShip?.(null); camera.near = 1; camera.far = 400; width = 0; layout();
  }
  function oceanStep(view: OceanView, dt: number, light: typeof MOOD_LIGHT[Mood]) {
    if (!oceanMode) {
      oceanMode = true; waterY = 0; water.constant = 0; mirrorClip.constant = 0;
      voyage.scale.setScalar(METRES); scene.fog = fog;
      // a rough sea breaks any mirror image; the ocean shader carries the glints instead
      reflection.visible = false; wake.visible = false; foam.visible = false;
    }
    layout();
    // the overlay camera is the sea camera: same eye, focal length and off-axis horizon
    camera.position.set(view.x, view.y, -view.z); camera.rotation.set(0, 0, 0);
    camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(1 / view.F)); camera.aspect = width / Math.max(1, height);
    camera.near = 4; camera.far = 30000; camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[9] = -view.horizon;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld(true);
    fog.color.setRGB(view.haze[0], view.haze[1], view.haze[2], THREE.SRGBColorSpace);
    refreshSky(view);
    rim.color.lerp(new THREE.Color(light.rim), 1 - Math.exp(-dt * 1.5));
    hemi.color.lerp(new THREE.Color(light.sky), 1 - Math.exp(-dt * 1.5));
    // the low sun, raised a little so its light reaches the deck; the shadow box follows the hull
    if (key.target !== voyage) { key.target = voyage; key.castShadow = true; }
    key.position.copy(voyage.position).add(new THREE.Vector3(view.sun[0], .42, -view.sun[2]).normalize().multiplyScalar(400));
    const box = HALF_LENGTH * 1.25;
    Object.assign(key.shadow.camera, { left: -box, right: box, top: box, bottom: -box, near: 50, far: 900 });
    key.shadow.camera.updateProjectionMatrix();
    rim.position.set(view.sun[0] * 40, 12, -view.sun[2] * 40);
    // the camera side is in the sun's shadow: deck floodlights and sky fill keep its paint readable
    fill.position.set(-20, 18, 60); fill.color.set(0xd2cee6); fill.intensity = 1.5;
    hemi.intensity = .7;
    glowMaterial.color.copy(rim.color);
    wakeUniforms.u_color.value.set(0xdfe8ff).lerp(rim.color, .25); wakeUniforms.u_time.value = time;
    // ~11 m/s (21 kn, a container ship at service speed) broadside, quickening with distance: ~2 min 10 s a voyage
    const here = course(along, view);
    // +30% on the leg to the horizon, ramped in through the turn
    const speed = 11 * Math.pow(here.z / here.d0, 1.15) * (1 + .3 * Math.min(1, here.heading / .8));
    along += still ? 0 : speed * dt;
    if (along >= here.total) along = 0;
    const p = course(along, view);
    const tx = Math.cos(p.heading), tz = Math.sin(p.heading);
    const wx = view.x + p.x, wz = view.z + p.z;
    voyage.position.set(wx, -WATERLINE * METRES, -wz);
    voyage.rotation.y = Math.atan2(tz, tx);
    // the sea draws the wake at the hull's true pose; wave physics use a plausible service speed
    controller.current?.setShip?.({ x: wx, z: wz, heading: p.heading, speed: Math.min(speed, 13), half: HALF_LENGTH, beam: HALF_BEAM });
    // the hull rides the long waves under its own bow, stern and sides
    const sea = controller.current?.heightAt;
    const at = (dx: number, dz: number) => sea ? sea(wx + dx, wz + dz) : 0;
    const reach = HALF_LENGTH * .87, side = HALF_BEAM * .7;
    const bow = at(tx * reach, tz * reach), stern = at(-tx * reach, -tz * reach), port = at(-tz * side, tx * side), star = at(tz * side, -tx * side);
    const targetHeave = THREE.MathUtils.clamp((bow + stern + port + star) / 4 / METRES, -.2, .2);
    const targetPitch = THREE.MathUtils.clamp((bow - stern) / (reach * 2), -.035, .035);
    const targetRoll = THREE.MathUtils.clamp((port - star) / (side * 2) * .6 + Math.sin(time * .37) * .008, -.05, .05);
    for (const [value, velocity, target, stiffness, damping] of [["heave", "heaveV", targetHeave, 5, 2.8], ["pitch", "pitchV", targetPitch, 6, 3.2], ["roll", "rollV", targetRoll, 4, 2.2]] as const) {
      motion[velocity] += ((target - motion[value]) * stiffness - motion[velocity] * damping) * dt;
      motion[value] += motion[velocity] * dt;
    }
    rig.position.set(0, motion.heave, 0);
    rig.rotation.set(motion.roll, 0, motion.pitch);
    const haze = Math.min(1, p.z / 9000);
    void tz;
    glowMaterial.opacity = .22 * (1 - haze);
    wakeUniforms.u_opacity.value = .75 * (1 - haze) * (1 - haze);
    foam.scale.set(1, 1, 1);
    voyage.updateMatrixWorld(true);
    for (const copy of reflection.children as THREE.Mesh[]) {
      const source = copy.userData.source as THREE.Mesh;
      copy.matrix.makeTranslation(0, 2 * waterY, 0).multiply(new THREE.Matrix4().makeScale(1, -1, 1)).multiply(source.matrixWorld);
    }
    if (radar) radar.rotation.y += dt * 1.4;
    if (mastLight) mastLight.emissiveIntensity = Math.sin(time * 3.2) > .55 ? 22 : 3;
    if (time - lastWake > 3.2 && p.z < 900) {
      const stern3 = new THREE.Vector3(-12, WATERLINE, 0).applyMatrix4(voyage.matrixWorld).project(camera);
      if (stern3.x > -1.05 && stern3.x < 1.05) { lastWake = time; controller.current?.emit((stern3.x + 1) / 2, .2, false); }
    }
    // shadows: every frame up close, every 8th once the hull is small, never at the horizon
    shadowFrame++;
    renderer.shadowMap.needsUpdate = p.z < 1200 || (p.z < 4000 && shadowFrame % 8 === 0);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(frameStep);
  }
  function sync() { cancelAnimationFrame(frame); frame = 0; last = 0; if (disposed || !ready) return; if (still || document.hidden) { if (!document.hidden) render(); } else frame = requestAnimationFrame(frameStep); }
  document.addEventListener("visibilitychange", sync);
  addEventListener("resize", sync);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  return {
    update(state) { void apply(state); },
    hit(clientX, clientY) {
      if (!ready) return null;
      const box = canvas.getBoundingClientRect();
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null;
      pointer.set((clientX - box.left) / box.width * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      // only the part of the ship above the sea counts; a logo container answers with its slot
      const first = raycaster.intersectObject(ship, true).find(hit => hit.point.y > waterY);
      if (!first) return null;
      const slot = /^Logo(?:Plate|Box)_(\d\d)/.exec(first.object.name);
      return slot ? { kind: "cargo", index: Number(slot[1]) } : { kind: "ship" };
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); controller.current?.setShip?.(null);
      document.removeEventListener("visibilitychange", sync); removeEventListener("resize", sync);
      scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!(mesh.userData.source)) mesh.geometry.dispose();
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
      });
      placards.forEach(placard => placard?.texture.dispose()); hullTexture?.dispose(); glowTexture.dispose(); environment.dispose(); pmrem.dispose(); skyDome.geometry.dispose(); (skyDome.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
