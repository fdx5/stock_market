import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { AtlasArchitecture, AtlasSnapshot } from "./systemAtlasApi";
import { createAtlasSentinel } from "./atlasSentinel";

export type NexusQuality = "cinematic" | "balanced" | "eco";
export interface NexusState { live: AtlasSnapshot | null; selected: string; motion: boolean; reduced: boolean }
export function createNexusWorld(host: HTMLElement, graph: AtlasArchitecture, quality: NexusQuality, current: () => NexusState, select: (id: string) => void, recover: () => void) {
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
  renderer.setClearColor("#010909"); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.domElement.setAttribute("aria-label", "센티널이 순찰하는 3D 사이버 관제 공간. 드래그하여 회전하고 서비스 노드를 선택할 수 있습니다.");
  renderer.domElement.setAttribute("role", "img"); renderer.domElement.className = "an-world-canvas"; host.appendChild(renderer.domElement);
  const scene = new T.Scene(); scene.fog = new T.FogExp2("#020f0c", .019);
  const camera = new T.PerspectiveCamera(46, 1, .1, 150);
  const home = new T.Vector3(19, 12.5, 27), target = new T.Vector3(1, 1, -3);
  camera.position.copy(home);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(target); controls.enableDamping = true; controls.dampingFactor = .075; controls.enablePan = false; controls.minDistance = 17; controls.maxDistance = 49; controls.minPolarAngle = .25; controls.maxPolarAngle = Math.PI * .47; controls.enableZoom = false;
  const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
  const env = pmrem.fromScene(room, .03); scene.environment = env.texture; scene.environmentIntensity = .53; room.dispose(); pmrem.dispose();
  const ambient = new T.HemisphereLight("#bbf5ec", "#010503", 1.15); scene.add(ambient);
  const key = new T.DirectionalLight("#efffff", 2.2); key.position.set(13, 16, 18); scene.add(key);
  const rim = new T.DirectionalLight("#48ffc4", 2.2); rim.position.set(-10, 7, -8); scene.add(rim);
  const glow = new T.PointLight("#33ffb3", 90, 30, 2); glow.position.set(0, 3, 0); scene.add(glow);
  const composer = new EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: quality === "cinematic" ? 4 : 0 }));
  const renderPass = new RenderPass(scene, camera), bloom = new UnrealBloomPass(new T.Vector2(1, 1), .38, .3, 1.6), output = new OutputPass();
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(output); bloom.enabled = quality !== "eco";
  const neon = (color: T.ColorRepresentation, opacity = 1) => new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: T.AdditiveBlending, depthWrite: false });
  const metal = new T.MeshStandardMaterial({ color: "#071717", metalness: .7, roughness: .4 });
  const mesh = (geo: T.BufferGeometry, mat: T.Material, pos: [number, number, number], parent: T.Object3D = scene) => { const m = new T.Mesh(geo, mat); m.position.set(...pos); parent.add(m); return m; };
  // The observation deck: radial circuits, concentric machinery and deep perspective.
  mesh(new T.PlaneGeometry(180, 180), new T.MeshStandardMaterial({ color: "#030d0d", metalness: .5, roughness: .5 }), [0, -3.25, 0]).rotation.x = -Math.PI / 2;
  const grid = new T.GridHelper(140, 100, "#14563f", "#063327"); grid.position.y = -3.21; (grid.material as T.Material).transparent = true; (grid.material as T.Material).opacity = .52; scene.add(grid);
  const deck = mesh(new T.CylinderGeometry(8.1, 8.8, .52, 96), metal, [0, -2.91, 0]);
  for (const radius of [3.3, 5.4, 8.3, 11.8, 15.4]) { const ring = mesh(new T.TorusGeometry(radius, radius === 8.3 ? .042 : .018, 8, 160), neon("#25b784", .55), [0, -2.58, 0]); ring.rotation.x = Math.PI / 2; }
  const markings = new T.Group(); scene.add(markings);
  for (let i = 0; i < 96; i++) { const angle = i / 96 * Math.PI * 2; const tick = mesh(new T.BoxGeometry(i % 8 === 0 ? .04 : .018, .018, i % 8 === 0 ? .44 : .18), neon("#49ffa9", .62), [Math.sin(angle) * 8.5, -2.54, Math.cos(angle) * 8.5], markings); tick.rotation.y = angle; }
  // Core cage, gyro rings and scanning plane.
  const core = new T.Group(); core.position.set(0, 1.25, 0); scene.add(core);
  mesh(new T.IcosahedronGeometry(1.24, 1), new T.MeshBasicMaterial({ color: "#5bffd0", wireframe: true, transparent: true, opacity: .75 }), [0, 0, 0], core);
  mesh(new T.IcosahedronGeometry(.77, 0), new T.MeshStandardMaterial({ color: "#072b23", emissive: "#1cb480", emissiveIntensity: 1.3, metalness: .68, roughness: .15 }), [0, 0, 0], core);
  const gyro: T.Mesh[] = [];
  for (let i = 0; i < 3; i++) { const r = mesh(new T.TorusGeometry(1.72 + i * .3, .023, 8, 120), neon(i === 1 ? "#a1ffee" : "#4bffb0"), [0, 0, 0], core); r.rotation.set(i * .85, i * .53, .4 + i); gyro.push(r); }
  const beam = mesh(new T.CylinderGeometry(.65, 1.4, 5.4, 32, 1, true), new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, uniforms: { time: { value: 0 } }, vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}", fragmentShader: "varying vec2 vUv;uniform float time;void main(){float line=pow(max(0.,1.-abs(fract(vUv.y*19.-time*.11)-.5)*2.),12.);float edge=pow(1.-vUv.y,2.);gl_FragColor=vec4(.15,.95,.63,edge*(.055+line*.085));}" }), [0, -.3, 0]);
  const scan = mesh(new T.RingGeometry(2.6, 2.63, 128), neon("#61ffbb", .36), [0, .2, 0]); scan.rotation.x = -Math.PI / 2;
  // Actual source topology, spatially arranged around the gateway.
  const positions = new Map<string, T.Vector3>(); positions.set("gateway", new T.Vector3(0, 1.25, 0));
  const services = graph.nodes.filter(n => n.kind === "service"), external = graph.nodes.filter(n => n.kind === "external");
  services.forEach((n, i) => { const a = i / services.length * Math.PI * 2 + .35; positions.set(n.id, new T.Vector3(Math.cos(a) * 6.2, -.8 + i % 2 * .35, Math.sin(a) * 6.2)); });
  external.forEach((n, i) => { const a = i / external.length * Math.PI * 2 + .2; positions.set(n.id, new T.Vector3(Math.cos(a) * 13.1, -.85 + i % 3 * .55, Math.sin(a) * 13.1 - 3)); });
  positions.set("cache", new T.Vector3(-3.6, -1.5, -.5)); positions.set("database", new T.Vector3(3.2, -1.4, -2.8)); positions.set("estate-db", new T.Vector3(3.6, -1.4, 2.5)); positions.set("client", new T.Vector3(-11, .1, 8)); positions.set("graphics", new T.Vector3(-13, -.5, 5));
  type NodeVisual = { id: string; group: T.Group; ring: T.Mesh; crystal: T.Mesh; light: T.MeshBasicMaterial; label?: HTMLButtonElement };
  const visuals: NodeVisual[] = [], labels = document.createElement("div"); labels.className = "an-spatial-labels"; host.appendChild(labels);
  const pickers: T.Object3D[] = [];
  graph.nodes.forEach(n => {
    const p = positions.get(n.id); if (!p || n.id === "gateway") return;
    const g = new T.Group(); g.position.copy(p); scene.add(g);
    mesh(new T.CylinderGeometry(.65, .78, .22, 6), metal, [0, -.18, 0], g);
    const light = neon(n.kind === "service" ? "#50eeb3" : "#239685", .84);
    const ring = mesh(new T.TorusGeometry(.67, .018, 6, 64), light, [0, -.04, 0], g); ring.rotation.x = Math.PI / 2;
    const crystal = mesh(new T.OctahedronGeometry(n.kind === "service" ? .53 : .3, 0), new T.MeshBasicMaterial({ color: n.kind === "service" ? "#74ffc2" : "#53cfb0", wireframe: true, transparent: true, opacity: .75 }), [0, .56, 0], g);
    const hit = mesh(new T.SphereGeometry(.78, 12, 8), new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), [0, .5, 0], g); hit.userData.nodeId = n.id; pickers.push(hit);
    let label: HTMLButtonElement | undefined;
    if (n.kind === "service") { label = document.createElement("button"); label.className = "an-spatial-node"; label.type = "button"; label.setAttribute("aria-label", `${n.label} 3D 노드 선택`); label.innerHTML = `<span></span><b></b><small></small>`; label.querySelector("b")!.textContent = n.label.split(" · ")[0]; label.onclick = () => select(n.id); labels.appendChild(label); }
    visuals.push({ id: n.id, group: g, ring, crystal, light, label });
  });
  const flowPaths: { id: string; source: string; curve: T.CatmullRomCurve3; dot: T.Mesh; line: T.Material }[] = [];
  graph.edges.forEach(e => { const from = positions.get(e.source), to = positions.get(e.target); if (!from || !to) return;
    const middle = from.clone().lerp(to, .5); middle.y += e.source === "gateway" ? 1 : .4;
    const curve = new T.CatmullRomCurve3([from.clone(), middle, to.clone()]);
    const material = neon(e.source === "gateway" ? "#27b583" : "#1e695d", .42);
    mesh(new T.TubeGeometry(curve, 24, .013, 4, false), material, [0, 0, 0]);
    const dot = mesh(new T.SphereGeometry(.06, 8, 6), neon("#96ffce"), [0, 0, 0]); dot.visible = false;
    flowPaths.push({ id: e.id, source: e.source, curve, dot, line: material });
  });
  // Remote data vaults, suspended hoops and algorithmic code curtains.
  const towers = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color: "#061915", metalness: .62, roughness: .48 }), 80);
  const transform = new T.Object3D();
  for (let i = 0; i < 80; i++) { const height = 3 + i % 7 * 1.25; transform.position.set((i % 20 - 9.5) * 3.6, height / 2 - 3.2, -27 - Math.floor(i / 20) * 5); transform.scale.set(.7, height, .7); transform.updateMatrix(); towers.setMatrixAt(i, transform.matrix); }
  scene.add(towers);
  const codeCanvas = document.createElement("canvas"); codeCanvas.width = 512; codeCanvas.height = 1024;
  const ctx = codeCanvas.getContext("2d")!; ctx.fillStyle = "#011008"; ctx.fillRect(0, 0, 512, 1024); ctx.font = "15px monospace";
  const glyphs = "01アカサタナハマヤラワ0123456789ABCDEF";
  for (let x = 0; x < 32; x++) for (let y = 0; y < 62; y++) { const v = Math.sin(x * 38.72 + y * 17.23) * 43758.54; const f = v - Math.floor(v); ctx.fillStyle = `rgba(68,255,153,${f > .86 ? .7 : f * .19})`; ctx.fillText(glyphs[Math.floor(f * glyphs.length)], x * 16, y * 17); }
  const codeTexture = new T.CanvasTexture(codeCanvas); codeTexture.wrapS = codeTexture.wrapT = T.RepeatWrapping; codeTexture.repeat.set(5, 1.8);
  const curtain = mesh(new T.CylinderGeometry(37, 37, 29, 80, 1, true), new T.MeshBasicMaterial({ map: codeTexture, transparent: true, opacity: .27, blending: T.AdditiveBlending, side: T.BackSide, depthWrite: false }), [0, 9, -4]);
  const starsGeo = new T.BufferGeometry(), starPositions: number[] = [];
  for (let i = 0; i < 700; i++) { const r = Math.sin(i * 14.357) * 43758.4, f = r - Math.floor(r); starPositions.push(Math.sin(i * 1.83) * 42, f * 25 - 1, Math.cos(i * 2.31) * 42 - 12); }
  starsGeo.setAttribute("position", new T.Float32BufferAttribute(starPositions, 3)); const dust = new T.Points(starsGeo, new T.PointsMaterial({ color: "#7bffc5", size: .028, transparent: true, opacity: .4, blending: T.AdditiveBlending, depthWrite: false })); scene.add(dust);
  const sentinels = [0, 1, 2].map(i => createAtlasSentinel(scene, i, quality === "cinematic" ? 64 : 40));
  const coreCaption = host.parentElement?.querySelector<HTMLElement>(".an-core-caption"), sentinelCaption = host.parentElement?.querySelector<HTMLElement>(".an-sentinel-tag");
  host.dataset.sentinels = "3"; host.dataset.state = "ready";
  let width = 1, height = 1, frame = 0, raf = 0, disposed = false, released = false, contextLost = false, lastFrame = 0, simTime = 0, dirty = true, lastAt = 0, pointerStart = new T.Vector2(), cameraReset = false;
  const baseRatio = quality === "cinematic" ? 1.5 : quality === "balanced" ? Math.min(devicePixelRatio, 1.25) : .85;
  let ratio = baseRatio, slowFrames = 0;
  let compact: boolean | undefined;
  const resize = () => {
    width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight);
    const nextCompact = width < 620;
    if (compact !== nextCompact) {
      compact = nextCompact; home.set(...(compact ? [17, 16, 31] : [19, 12.5, 27]) as [number, number, number]);
      target.set(...(compact ? [8, 5, 0] : [1, 1, -3]) as [number, number, number]);
      camera.position.copy(home); controls.target.copy(target); camera.fov = compact ? 58 : 46;
    }
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setPixelRatio(ratio); renderer.setSize(width, height); composer.setPixelRatio(ratio); composer.setSize(width, height); dirty = true;
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const projected = new T.Vector3(), raycaster = new T.Raycaster();
  const down = (e: PointerEvent) => pointerStart.set(e.clientX, e.clientY);
  const click = (e: PointerEvent) => { if (pointerStart.distanceTo(new T.Vector2(e.clientX, e.clientY)) > 5) return; const box = renderer.domElement.getBoundingClientRect(); raycaster.setFromCamera(new T.Vector2((e.clientX - box.left) / box.width * 2 - 1, -(e.clientY - box.top) / box.height * 2 + 1), camera); const hit = raycaster.intersectObjects(pickers, false)[0]; if (hit) select(hit.object.userData.nodeId); };
  renderer.domElement.addEventListener("pointerdown", down); renderer.domElement.addEventListener("pointerup", click);
  const lose = (e: Event) => { e.preventDefault(); contextLost = true; host.dataset.state = "context-lost"; cancelAnimationFrame(raf); releaseResources(); };
  renderer.domElement.addEventListener("webglcontextlost", lose);
  // Rebuild after restoration: old VAOs, programs and composer targets belong to the lost context.
  const restored = () => { if (!disposed) recover(); };
  renderer.domElement.addEventListener("webglcontextrestored", restored);
  controls.addEventListener("change", () => dirty = true);
  function tick(stamp: number) {
    if (disposed || contextLost || document.hidden) return;
    raf = requestAnimationFrame(tick);
    const budget = quality === "cinematic" ? 1000 / 45 : 1000 / 30;
    if (stamp - lastFrame < budget) return;
    const delta = lastFrame ? Math.min(.08, (stamp - lastFrame) / 1000) : .025; lastFrame = stamp;
    const state = current(), moving = state.motion && !state.reduced;
    if (cameraReset) { camera.position.lerp(home, .13); controls.target.lerp(target, .13); cameraReset = camera.position.distanceTo(home) > .03; dirty = true; }
    const changed = controls.update();
    if (!moving && !dirty && !changed && state.live?.at === lastAt) return;
    if (moving) simTime += delta;
    const t = simTime; sentinels.forEach(s => s.update(t)); core.rotation.y = t * .14; core.rotation.z = Math.sin(t * .18) * .1;
    if (coreCaption && !compact) { projected.copy(core.position).add(new T.Vector3(0, 6, 0)).project(camera); coreCaption.style.left = `${(projected.x * .5 + .5) * width}px`; coreCaption.style.top = `${(-projected.y * .5 + .5) * height}px`; }
    else if (coreCaption) { coreCaption.style.removeProperty("left"); coreCaption.style.removeProperty("top"); }
    if (sentinelCaption && !compact) { projected.copy(sentinels[0].group.position).add(new T.Vector3(2.5, 1.4, 0)).project(camera); sentinelCaption.style.left = `${(projected.x * .5 + .5) * width}px`; sentinelCaption.style.top = `${(-projected.y * .5 + .5) * height}px`; sentinelCaption.style.right = "auto"; }
    else if (sentinelCaption) { ["left", "top", "right"].forEach(p => sentinelCaption.style.removeProperty(p)); }
    gyro.forEach((r, i) => { r.rotation.x = i * .85 + t * .12 * (i % 2 ? -1 : 1); r.rotation.y = i * .53 + t * .08; });
    (beam.material as T.ShaderMaterial).uniforms.time.value = t; scan.position.y = -1.9 + (Math.sin(t * .7) + 1) * 2.1; codeTexture.offset.y = -t * .016; curtain.rotation.y = t * .006; dust.rotation.y = t * .012;
    flowPaths.forEach((f, i) => { const observed = state.live?.observed_edges[f.id] || (f.source === "gateway" ? state.live?.api.groups[f.id.split(":")[1]]?.count || 0 : 0); f.dot.visible = moving && observed > 0; if (f.dot.visible) f.dot.position.copy(f.curve.getPointAt((t * .16 + i * .173) % 1)); });
    visuals.forEach(v => { const stats = state.live?.api.groups[v.id] || state.live?.external.groups[v.id]; const chosen = v.id === state.selected; const error = (stats?.errors || 0) > 0; v.light.color.set(error ? "#ff5868" : chosen ? "#b5ffe5" : "#43b58c"); v.ring.scale.setScalar(chosen ? 1.24 : 1); v.crystal.rotation.y = t * .32; v.crystal.position.y = .55 + Math.sin(t * .7 + v.group.position.x) * .08;
      if (v.label) { projected.copy(v.group.position).add(new T.Vector3(0, 1.25, 0)).project(camera); v.label.style.left = `${(projected.x * .5 + .5) * width}px`; v.label.style.top = `${(-projected.y * .5 + .5) * height}px`; v.label.style.display = projected.z < 1 && projected.z > -1 && Math.abs(projected.x) < 1.06 && Math.abs(projected.y) < 1.02 ? "" : "none"; v.label.className = `an-spatial-node ${chosen ? "is-selected" : ""} ${error ? "has-error" : ""}`; v.label.setAttribute("aria-pressed", String(chosen)); v.label.querySelector("small")!.textContent = state.live ? `${stats?.count || 0} / 60s` : "표본 대기"; }
    });
    const began = performance.now(); composer.render(); const elapsed = performance.now() - began;
    if (moving && elapsed > 38) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 28 && ratio > .85) { ratio = Math.max(.85, ratio * .82); slowFrames = 0; resize(); }
    dirty = false; lastAt = state.live?.at || 0; frame++; host.dataset.frames = String(frame); host.dataset.motion = moving ? "running" : "paused"; host.dataset.selected = state.selected; host.dataset.simulationTime = t.toFixed(3); host.dataset.camera = camera.position.toArray().map(v => v.toFixed(2)).join(",");
  }
  const visibility = () => { cancelAnimationFrame(raf); if (!document.hidden && !disposed && !contextLost) { lastFrame = 0; dirty = true; raf = requestAnimationFrame(tick); } };
  document.addEventListener("visibilitychange", visibility); raf = requestAnimationFrame(tick);
  function releaseResources() {
    if (released) return; released = true;
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    scene.traverse(object => { if (object instanceof T.InstancedMesh) object.dispose(); if (object instanceof T.Mesh || object instanceof T.Points || object instanceof T.LineSegments) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m)); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); codeTexture.dispose(); env.dispose(); renderPass.dispose(); bloom.dispose(); output.dispose(); composer.dispose(); renderer.dispose();
  }
  return {
    reset: () => { cameraReset = true; dirty = true; },
    invalidate: () => { dirty = true; },
    dispose: () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); controls.dispose(); renderer.domElement.removeEventListener("pointerdown", down); renderer.domElement.removeEventListener("pointerup", click); renderer.domElement.removeEventListener("webglcontextlost", lose); renderer.domElement.removeEventListener("webglcontextrestored", restored);
      releaseResources(); renderer.forceContextLoss(); host.replaceChildren(); delete host.dataset.frames; delete host.dataset.state;
    },
  };
}
