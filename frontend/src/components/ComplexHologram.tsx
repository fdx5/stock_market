import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { api, RealEstateBuilding, RealEstateBuildingsResponse } from "../api/client";
import { vworldBuildings } from "./vworldBuildings";
import {
  alongRings, contextTextures, dirFrom, facadeTextures, FinishShader, foliageColors, inRing, Look, LOOKS, mixLook,
  paintGround, paletteFor, patchFoliage, patchMaterial, patchSky, rng, seasonNow, shared, starField, Tod, TOD_LABEL, TOD_ORDER,
  todNow, treeGeometries,
} from "./complexScene";
import "../desk2/realestate-hologram.css";

/* 부동산 맵 — one complex in natural light. Footprints and heights are the real ones
 * (backend app/services/realestate_buildings.py: 국토부 GIS건물통합정보 via VWorld, else
 * OpenStreetMap); the facade, landscaping, trees and lamps are drawn (complexScene.ts),
 * since no open source carries them. Sky, sun, clouds, haze, rain-damp ground with
 * reflections, and a day / dusk / night cycle. */

function shapeOf(b: RealEstateBuilding): THREE.Shape {
  const [outer, ...holes] = b.rings;
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  holes.forEach(h => shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));
  return shape;
}

function extrude(b: RealEstateBuilding): THREE.ExtrudeGeometry {
  const depth = Math.max(2, b.height - b.base);
  const geo = new THREE.ExtrudeGeometry(shapeOf(b), { depth, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, b.base);
  return geo;
}

type Stage = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; composer: EffectComposer; bloom: UnrealBloomPass; finish: ShaderPass;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sky: Sky; stars: THREE.Points;
  reflector: Reflector | null; reflStrength: { value: number };
  refreshEnv: () => void;
  look: Look; fade: { from: Look; to: Look; t0: number } | null;
  lit: { windows: THREE.MeshStandardMaterial[]; crowns: THREE.MeshStandardMaterial[]; lamps: THREE.MeshStandardMaterial[]; ground: THREE.MeshStandardMaterial[] };
  ground: THREE.Mesh | null; model: THREE.Group | null;
  pickables: THREE.Mesh[]; grow: { mesh: THREE.Object3D; delay: number }[];
  intro: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null;
  born: number; now: number; top: number; dist: number; center: THREE.Vector3;
  hq: boolean; disposeModel: () => void;
};

const heightLabel = (b: RealEstateBuilding) =>
  `${b.floors}층 · 높이 ${Math.round(b.height)}m${b.height_source === "measured" ? " (실측)" : b.height_source === "floors" ? " (층수 기준)" : " (추정)"}${b.approved ? ` · ${b.approved}년 사용승인` : ""}`;

/** When the register's buildings are likely not yet the complex's current ones:
 * a complex completed after every tower on its parcel was approved is a rebuild the
 * national data hasn't caught up with; a recent or pre-completion complex may be too. */
function staleNotice(data: RealEstateBuildingsResponse, complexId: string): string | null {
  const towers = data.buildings.filter(b => b.floors >= 5);
  const approved = towers.map(b => b.approved).filter((y): y is number => !!y);
  const latest = approved.length ? Math.max(...approved) : null;
  const built = data.built;
  if (built && latest && latest < built - 1)
    return `자료 갱신 전일 수 있음 · ${built}년 준공 단지인데 건물 자료는 ${latest}년 사용승인 건물입니다(재건축 전 모습일 수 있습니다).`;
  if (complexId.includes(":rights:"))
    return "자료 갱신 전일 수 있음 · 분양·입주권 거래 단지로 준공 전이거나 건물 자료에 아직 반영되지 않았을 수 있습니다.";
  if (built && built >= new Date().getFullYear() - 2 && !latest)
    return "자료 갱신 전일 수 있음 · 최근 준공 단지는 국가 건물 자료에 늦게 반영됩니다.";
  return null;
}

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export default function ComplexHologram({ complexId, complexName, caption }: { complexId: string | null; complexName?: string; caption?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [data, setData] = useState<RealEstateBuildingsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [spin, setSpin] = useState(true);
  const [tod, setTod] = useState<Tod>(() => {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("tod") : null;
    return q && q in LOOKS ? (q as Tod) : todNow();
  });
  const [tip, setTip] = useState<{ x: number; y: number; text: string; pinned: boolean; w: number } | null>(null);
  const [failed3d, setFailed3d] = useState(false);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  // One renderer for the panel's lifetime; each complex only swaps the model.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Phones and small tablets: no planar reflection or AO, fewer trees, lighter shadows.
    const hq = !window.matchMedia?.("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFailed3d(true);
      return;
    }
    const maxRatio = Math.min(window.devicePixelRatio, hq ? 2 : 1.6);
    let ratio = maxRatio;
    renderer.setPixelRatio(ratio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#b9cadb", 0.001);
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 8000);
    camera.position.set(260, 160, 260);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.035;
    controls.enablePan = false;

    const sky = new Sky();
    sky.scale.setScalar(40000);
    patchSky(sky.material, (scene.fog as THREE.FogExp2).color);
    scene.add(sky);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.geometry, sky.material));
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envRT: THREE.WebGLRenderTarget | null = null;
    const refreshEnv = () => {
      const next = pmrem.fromScene(envScene, 0, 0.1, 1000);
      scene.environment = next.texture;
      envRT?.dispose();
      envRT = next;
    };
    const stars = starField(3000);
    scene.add(stars);

    const hemi = new THREE.HemisphereLight("#c4dcf6", "#6f6552", 0.45);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff3e0", 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(hq ? 4096 : 2048, hq ? 4096 : 2048);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.5;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);

    // Rain-damp ground mirrors the towers: a planar reflection sampled by the ground shader.
    const reflStrength = { value: 0.85 };
    const reflector = hq ? new Reflector(new THREE.PlaneGeometry(1, 1), { clipBias: 0.002, textureWidth: 512, textureHeight: 512, multisample: 0 }) : null;
    if (reflector) { reflector.rotation.x = -Math.PI / 2; reflector.updateMatrixWorld(); }

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = hq ? new GTAOPass(scene, camera, 1, 1) : null;
    if (gtao) {
      gtao.updateGtaoMaterial({ radius: 5, distanceExponent: 1.5, thickness: 6, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      gtao.blendIntensity = 0.75;
      composer.addPass(gtao);
    }
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.55, 1.15);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const finish = new ShaderPass(FinishShader);
    composer.addPass(finish);

    const stage: Stage = {
      renderer, scene, camera, controls, composer, bloom, finish, sun, hemi, sky, stars, reflector, reflStrength, refreshEnv,
      look: LOOKS.day, fade: null, lit: { windows: [], crowns: [], lamps: [], ground: [] },
      ground: null, model: null, pickables: [], grow: [], intro: null,
      born: 0, now: 0, top: 50, dist: 300, center: new THREE.Vector3(), hq, disposeModel: () => {},
    };
    stageRef.current = stage;

    let W = 1, H = 1;
    const resize = () => {
      W = host.clientWidth; H = host.clientHeight;
      if (!W || !H) return;
      renderer.setPixelRatio(ratio);
      renderer.setSize(W, H, false);
      composer.setPixelRatio(ratio);
      composer.setSize(W, H);
      bloom.setSize(W * ratio / 2, H * ratio / 2);
      reflector?.getRenderTarget().setSize(Math.round(W * ratio * 0.5), Math.round(H * ratio * 0.5));
      finish.uniforms.uAspect.value = W / H;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    let idleTimer = 0;
    const onStart = () => { controls.autoRotate = false; stage.intro = null; window.clearTimeout(idleTimer); };
    const onEnd = () => { idleTimer = window.setTimeout(() => { controls.autoRotate = spinRef.current; }, 3500); };
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    const keyDir = new THREE.Vector3(), sunDir = new THREE.Vector3(), sunNdc = new THREE.Vector3();
    const sunRay = new THREE.Raycaster();
    let sunVis = 0, sunVisTarget = 0, frame = 0, envFrame = 0;
    // Dynamic resolution (after tidewater): hold ~50 fps by trading pixels, never below 0.75x.
    let slow = 0, quick = 0, last = performance.now();
    const t0 = performance.now();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const nowMs = performance.now();
      const dt = nowMs - last;
      last = nowMs;
      if (dt > 24) { slow++; quick = 0; } else if (dt < 15) { quick++; slow = 0; }
      if (slow > 40 && ratio > 0.75) { ratio = Math.max(0.75, ratio - 0.25); slow = 0; resize(); }
      else if (quick > 240 && ratio < maxRatio) { ratio = Math.min(maxRatio, ratio + 0.25); quick = 0; resize(); }

      const t = (nowMs - t0) / 1000;
      stage.now = t;
      shared.uTime.value = t;
      sky.material.uniforms.time.value = t;
      const since = t - stage.born;
      stage.grow.forEach(({ mesh, delay }) => {
        const k = Math.min(1, Math.max(0, (since - delay) / 1.2));
        mesh.scale.z = Math.max(0.001, 1 - Math.pow(1 - k, 3));
      });
      if (stage.intro) {
        const k = ease((t - stage.intro.t0) / 3.2);
        camera.position.lerpVectors(stage.intro.from, stage.intro.to, k);
        if (k >= 1) stage.intro = null;
      }
      if (stage.fade) {
        const k = ease((t - stage.fade.t0) / 2.2);
        applyLook(mixLook(stage.fade.from, stage.fade.to, k), k >= 1 || ++envFrame % 8 === 0);
        if (k >= 1) stage.fade = null;
      }
      controls.update();
      stars.position.copy(camera.position);

      // How much of the sun the towers hide, eased, for the flare.
      dirFrom(stage.look.sunElev, stage.look.sunAz, sunDir);
      sunNdc.copy(camera.position).addScaledVector(sunDir, 3000).project(camera);
      const onScreen = sunNdc.z < 1 && Math.abs(sunNdc.x) < 1.2 && Math.abs(sunNdc.y) < 1.2 && stage.look.sunElev > -1;
      if (++frame % 6 === 0) {
        sunRay.set(camera.position, sunDir);
        sunVisTarget = onScreen && !(stage.pickables.length && sunRay.intersectObjects(stage.pickables, false).length) ? 1 : 0;
      }
      sunVis += ((onScreen ? sunVisTarget : 0) - sunVis) * Math.min(1, dt / 120);
      finish.uniforms.uSun.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
      finish.uniforms.uSunVis.value = sunVis * THREE.MathUtils.smoothstep(stage.look.sunElev, -1, 6) * (0.55 + 0.45 * (1 - stage.look.clouds));

      if (reflector && stage.ground) {
        stage.ground.visible = false;
        (reflector.onBeforeRender as (r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera) => void)(renderer, scene, camera);
        stage.ground.visible = true;
      }
      composer.render();
    };

    /** Sun, sky, haze and every light-dependent material for one look. */
    const applyLook = (l: Look, env: boolean) => {
      stage.look = l;
      const u = sky.material.uniforms;
      u.turbidity.value = l.turbidity;
      u.rayleigh.value = l.rayleigh;
      u.mieCoefficient.value = l.mie;
      u.mieDirectionalG.value = l.mieG;
      u.cloudCoverage.value = l.clouds;
      u.cloudDensity.value = 0.55;
      u.cloudElevation.value = 0.55;
      u.cloudScale.value = 0.00022;
      u.cloudSpeed.value = 0.00006;
      dirFrom(l.sunElev, l.sunAz, sunDir);
      u.sunPosition.value.copy(sunDir);
      dirFrom(l.keyElev, l.keyAz, keyDir);
      const reach = stage.dist * 2 + stage.top * 2;
      sun.position.copy(stage.center).addScaledVector(keyDir, reach);
      sun.target.position.copy(stage.center);
      sun.color.copy(l.key);
      sun.intensity = l.keyI;
      hemi.color.copy(l.hemiSky);
      hemi.groundColor.copy(l.hemiGround);
      hemi.intensity = l.hemiI;
      const fog = scene.fog as THREE.FogExp2;
      fog.color.copy(l.fog);
      fog.density = l.fogK / stage.dist;
      renderer.toneMappingExposure = l.exposure;
      scene.environmentIntensity = l.env;
      shared.uGlass.value = 0.7 / Math.max(0.05, l.env);
      stage.lit.windows.forEach(m => { m.emissiveIntensity = l.windows; });
      stage.lit.crowns.forEach(m => { m.emissiveIntensity = l.windows * 0.5; });
      stage.lit.lamps.forEach(m => { m.emissiveIntensity = l.lamps * 7; });
      stage.lit.ground.forEach(m => { m.emissiveIntensity = l.lamps * 0.8; });
      (stars.material as THREE.PointsMaterial).opacity = l.stars;
      shared.uCloud.value = l.cloudShade;
      reflStrength.value = l.reflect;
      bloom.strength = l.bloom;
      bloom.threshold = l.bloomAt;
      finish.uniforms.uFlare.value.copy(l.key).lerp(new THREE.Color("#ffffff"), 0.4);
      if (env) refreshEnv();
    };
    stage.refreshEnv = () => applyLook(stage.look, true);
    applyLookRef.current = applyLook;
    applyLook(LOOKS[todRef.current], true);

    // Paused while off screen: a model below the fold should cost nothing.
    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(raf);
      if (entry.isIntersecting) { last = performance.now(); loop(); }
    });
    io.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.clearTimeout(idleTimer);
      stage.disposeModel();
      controls.dispose();
      composer.dispose();
      target.dispose();
      gtao?.dispose();
      reflector?.dispose();
      envRT?.dispose();
      pmrem.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
      applyLookRef.current = null;
    };
  }, []);

  const spinRef = useRef(spin);
  useEffect(() => {
    spinRef.current = spin;
    if (stageRef.current) stageRef.current.controls.autoRotate = spin;
  }, [spin]);

  const todRef = useRef(tod);
  const applyLookRef = useRef<((l: Look, env: boolean) => void) | null>(null);
  useEffect(() => {
    const st = stageRef.current;
    if (!st || todRef.current === tod) return;
    todRef.current = tod;
    st.fade = { from: st.look, to: LOOKS[tod], t0: st.now };
  }, [tod]);

  // Every selection: kept shapes from the server, else VWorld from this browser
  // (VWorld refuses the server abroad), else the server's OpenStreetMap fallback.
  useEffect(() => {
    setTip(null);
    if (!complexId) { setData(null); return; }
    const ctl = new AbortController();
    let live = true;
    setLoading(true);
    setError("");
    (async () => {
      const peek = await api.realEstateBuildings(complexId, ctl.signal, true);
      if (peek.found) return peek;
      if (peek.vworld_key && peek.query?.parcel) {
        try {
          const direct = await vworldBuildings(complexId, peek.query, peek.vworld_key, peek.vworld_domain);
          if (direct) return { ...direct, built: peek.built ?? null };
        } catch (err) {
          // Outside Korea or VWorld down: the server's OpenStreetMap copy is next.
          console.warn("[3D] VWorld direct lookup failed:", err instanceof Error ? err.message : err);
        }
      }
      return api.realEstateBuildings(complexId, ctl.signal);
    })()
      .then(res => { if (!live) return; setData(res); if (!res.found) setError(res.error || "건물 윤곽 자료를 찾지 못했습니다."); })
      .catch(err => { if (live && !ctl.signal.aborted) { setData(null); setError(err instanceof Error ? err.message : "불러오지 못했습니다."); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; ctl.abort(); };
  }, [complexId]);

  // Build the model for the loaded complex.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.disposeModel();
    if (!data?.found || !data.buildings.length) return;
    const palette = paletteFor(data.name);
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };
    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2; // footprints are x east / y north, extruded up z
    const lit: Stage["lit"] = { windows: [], crowns: [], lamps: [], ground: [] };

    let seed = 0;
    for (const ch of data.id) seed = (seed * 33 + ch.charCodeAt(0)) % 2147483647;
    const rnd = rng(seed);

    // Two facade variants so neighbouring towers don't light the same windows.
    const walls = [seed, seed + 7919].map(s => {
      const tex = facadeTextures(palette, s);
      Object.values(tex).forEach(keep);
      const m = keep(new THREE.MeshPhysicalMaterial({
        map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
        roughnessMap: tex.rmMap, metalnessMap: tex.rmMap, roughness: 1, metalness: 1,
        emissiveMap: tex.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
        clearcoat: 0.08, clearcoatRoughness: 0.6,
      }));
      patchMaterial(m, { glass: true });
      lit.windows.push(m);
      return m;
    });
    const roof = keep(new THREE.MeshStandardMaterial({ color: "#6f8174", roughness: 0.93 }));
    const crown = keep(new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.4, metalness: 0.45, emissive: palette.accent, emissiveIntensity: 0 }));
    lit.crowns.push(crown);
    const low = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wall).lerp(new THREE.Color(palette.wall2), 0.45), roughness: 0.75 }));
    const plant = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wall2).lerp(new THREE.Color("#9a9a96"), 0.5), roughness: 0.8 }));
    [roof, crown, low, plant].forEach(m => patchMaterial(m));

    const box = new THREE.Box3();
    const grow: Stage["grow"] = [];
    const pickables: THREE.Mesh[] = [];
    let top = 10;
    const tall = data.buildings.filter(b => b.floors >= 5);
    data.buildings.forEach((b, i) => {
      const geo = keep(extrude(b));
      const isTower = b.floors >= 5;
      const mesh = new THREE.Mesh(geo, isTower ? [roof, walls[i % 2]] : [roof, low]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.label = `${b.name ? b.name + " · " : ""}${heightLabel(b)}`;
      pickables.push(mesh);
      const holder = new THREE.Group();
      holder.add(mesh);
      if (isTower) {
        // Rooftop crown band in the complex's accent colour, and the lift / stair core.
        const cap = keep(new THREE.ExtrudeGeometry(shapeOf(b), { depth: 1.6, bevelEnabled: false }));
        cap.translate(0, 0, b.height);
        const capMesh = new THREE.Mesh(cap, [roof, crown]);
        capMesh.castShadow = true;
        holder.add(capMesh);
        const ring = b.rings[0];
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        if (inRing([cx, cy], ring)) {
          let ang = 0, best = 0;
          ring.forEach((p, j) => {
            const q = ring[(j + 1) % ring.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (len > best) { best = len; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
          });
          const core = new THREE.Mesh(keep(new THREE.BoxGeometry(Math.min(9, best * 0.3), 5, 4.2)), plant);
          core.position.set(cx, cy, b.height + 1.6 + 2.1);
          core.rotation.z = ang;
          core.castShadow = core.receiveShadow = true;
          holder.add(core);
        }
      }
      grow.push({ mesh: holder, delay: (tall.indexOf(b) >= 0 ? tall.indexOf(b) : i) * 0.025 });
      group.add(holder);
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
      top = Math.max(top, b.height);
    });

    // The neighbourhood: opaque, tinted per building, windows lit in the evening.
    const ext = data.buildings.flatMap(b => b.rings[0]).reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
    const reach = Math.max(ext * 1.8, ext + 160);
    const tints = ["#f1ede4", "#e4e1da", "#d9d4ca", "#c9b8a4", "#b88f78", "#a9b3bb", "#e8e3d3", "#cfc9bd"];
    const ctxGeos = data.context
      .filter(b => { const [x, y] = b.rings[0][0]; return Math.hypot(x, y) <= reach; })
      .map(b => {
        const g = extrude(b);
        g.clearGroups();
        const c = new THREE.Color(tints[Math.floor(rnd() * tints.length)]);
        const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3);
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        return g;
      });
    if (ctxGeos.length) {
      const merged = keep(mergeGeometries(ctxGeos, false)!);
      ctxGeos.forEach(g => g.dispose());
      const ct = contextTextures(seed + 3);
      Object.values(ct).forEach(keep);
      const ctxMat = keep(new THREE.MeshStandardMaterial({
        map: ct.map, vertexColors: true, roughnessMap: ct.rmMap, metalnessMap: ct.rmMap, roughness: 1, metalness: 1,
        emissiveMap: ct.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
      }));
      patchMaterial(ctxMat, { roof: new THREE.Color("#7b7e7a"), glass: true });
      lit.windows.push(ctxMat);
      const ctxMesh = new THREE.Mesh(merged, ctxMat);
      ctxMesh.castShadow = ctxMesh.receiveShadow = true;
      group.add(ctxMesh);
    }
    stage.scene.add(group);

    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 60);
    const cx = (box.max.x + box.min.x) / 2, cy = (box.max.y + box.min.y) / 2;
    const dist = Math.max(span, top * 1.4) * 1.1 + 40;

    // Street lamps along the complex's perimeter road.
    const lampPts = alongRings(data.site.length ? data.site : data.buildings.filter(b => b.floors >= 5).map(b => b.rings[0]), 22, stage.hq ? 420 : 200);
    // The ground: painted plan, damp paving, lawns and lamp pools, reflecting the towers.
    const T = Math.max(reach * 1.15, span * 0.9 + 120);
    const plan = paintGround(data, T, lampPts, seed, stage.hq ? 4096 : 2048);
    [plan.color, plan.rough, plan.glow].forEach(keep);
    const G = dist * 12;
    const groundGeo = keep(new THREE.PlaneGeometry(2 * G, 2 * G, 1, 1));
    const uv = groundGeo.getAttribute("uv") as THREE.BufferAttribute, gp = groundGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, (gp.getX(j) + T) / (2 * T), (gp.getY(j) + T) / (2 * T));
    const groundMat = keep(new THREE.MeshStandardMaterial({
      map: plan.color, roughnessMap: plan.rough, roughness: 1, metalness: 0,
      emissiveMap: plan.glow, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
    }));
    patchMaterial(groundMat, {
      detail: true,
      reflect: stage.reflector ? {
        tex: { value: stage.reflector.getRenderTarget().texture },
        matrix: (stage.reflector.material as THREE.ShaderMaterial).uniforms.textureMatrix,
        strength: stage.reflStrength,
        far: { value: dist * 2.2 },
      } : undefined,
    });
    lit.ground.push(groundMat);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    stage.scene.add(ground);

    // Trees on the lawns and along the perimeter, in the season's colours.
    const trees = treeGeometries();
    [trees.trunk, trees.leaf, trees.pine].forEach(keep);
    const spots: { x: number; y: number; pine: boolean }[] = [];
    const cell = 6.5;
    for (let x = -T; x < T; x += cell) {
      for (let y = -T; y < T; y += cell) {
        const px = x + (rnd() - 0.5) * cell * 0.9, py = y + (rnd() - 0.5) * cell * 0.9;
        const [lawn, blocked] = plan.mask.at(px, py);
        if (lawn > 128 && blocked < 128 && rnd() < 0.72) spots.push({ x: px, y: py, pine: rnd() < 0.32 });
      }
    }
    for (const [x, y] of alongRings(data.site, 9, 600)) {
      const [, blocked] = plan.mask.at(x, y);
      if (blocked < 128 && rnd() < 0.8) spots.push({ x, y, pine: false });
    }
    const cap = stage.hq ? 2600 : 900;
    for (let j = spots.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [spots[j], spots[k]] = [spots[k], spots[j]]; }
    const chosen = spots.slice(0, cap);
    const broad = chosen.filter(s => !s.pine), pines = chosen.filter(s => s.pine);
    const leafMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.88, color: "#ffffff" }));
    const trunkMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.95, color: "#4a3b2e" }));
    patchFoliage(leafMat);
    const colors = foliageColors(seasonNow()), pineColors = ["#2f4f2a", "#34552c", "#3b5a30"];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
    const trunkMesh = new THREE.InstancedMesh(trees.trunk, trunkMat, Math.max(1, chosen.length));
    const place = (list: typeof chosen, geo: THREE.BufferGeometry, palette: string[], pine: boolean, offset: number) => {
      const im = new THREE.InstancedMesh(geo, leafMat, Math.max(1, list.length));
      im.count = list.length;
      list.forEach((s, j) => {
        const h = pine ? 7 + rnd() * 6 : 5.5 + rnd() * 5;
        const w = pine ? h * (0.55 + rnd() * 0.15) : h * (0.85 + rnd() * 0.35);
        q.setFromAxisAngle(yAxis, rnd() * Math.PI * 2);
        m4.compose(p.set(s.x, 0, -s.y), q, sc.set(w, h, w));
        im.setMatrixAt(j, m4);
        trunkMesh.setMatrixAt(offset + j, m4);
        im.setColorAt(j, new THREE.Color(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.85 + rnd() * 0.3));
      });
      im.castShadow = im.receiveShadow = true;
      im.frustumCulled = false;
      return im;
    };
    const broadMesh = place(broad, trees.leaf, colors, false, 0);
    const pineMesh = place(pines, trees.pine, pineColors, true, broad.length);
    trunkMesh.count = chosen.length;
    trunkMesh.castShadow = true;
    trunkMesh.frustumCulled = false;
    const flora = new THREE.Group();
    flora.add(broadMesh, pineMesh, trunkMesh);
    disposables.push({ dispose: () => { broadMesh.dispose(); pineMesh.dispose(); trunkMesh.dispose(); } });

    // Lamps: a slim post and a warm head that blooms at night.
    const postGeo = keep(new THREE.CylinderGeometry(0.06, 0.09, 4.4, 6));
    postGeo.translate(0, 2.2, 0);
    const headGeo = keep(new THREE.SphereGeometry(0.26, 12, 8));
    headGeo.translate(0, 4.5, 0);
    const postMat = keep(new THREE.MeshStandardMaterial({ color: "#3b3f44", roughness: 0.5, metalness: 0.6 }));
    const headMat = keep(new THREE.MeshStandardMaterial({ color: "#f4efe6", emissive: "#ffcf94", emissiveIntensity: 0, roughness: 0.3 }));
    lit.lamps.push(headMat);
    const posts = new THREE.InstancedMesh(postGeo, postMat, Math.max(1, lampPts.length));
    const heads = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, lampPts.length));
    lampPts.forEach(([x, y], j) => { m4.makeTranslation(x, 0, -y); posts.setMatrixAt(j, m4); heads.setMatrixAt(j, m4); });
    posts.count = heads.count = lampPts.length;
    posts.castShadow = true;
    posts.frustumCulled = heads.frustumCulled = false;
    flora.add(posts, heads);
    disposables.push({ dispose: () => { posts.dispose(); heads.dispose(); } });
    stage.scene.add(flora);

    // Camera, sun and shadows framed on the complex, not the neighbourhood.
    const center = new THREE.Vector3(cx, top * 0.28, -cy);
    stage.center.copy(center);
    stage.dist = dist;
    stage.top = top;
    stage.controls.target.copy(center);
    const to = new THREE.Vector3(cx + dist * 0.74, top * 0.4 + dist * 0.24, -cy + dist * 0.74);
    const from = new THREE.Vector3(cx + dist * 1.25, top * 0.6 + dist * 0.95, -cy + dist * 0.3);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    stage.camera.position.copy(still ? to : from);
    stage.intro = still ? null : { from, to, t0: stage.now };
    stage.camera.far = dist * 14 + 2000;
    stage.camera.near = Math.max(0.5, dist / 800);
    stage.camera.updateProjectionMatrix();
    stage.controls.minDistance = Math.max(30, span * 0.3);
    stage.controls.maxDistance = dist * 3;
    const sc2 = stage.sun.shadow.camera;
    const half = span * 0.75 + top * 0.9 + 40;
    sc2.left = -half; sc2.right = half; sc2.top = half; sc2.bottom = -half;
    sc2.near = 1; sc2.far = (dist * 2 + top * 2) * 2 + top * 2;
    sc2.updateProjectionMatrix();

    stage.model = group;
    stage.ground = ground;
    stage.lit = lit;
    stage.pickables = pickables;
    stage.grow = grow;
    stage.born = stage.now; // the build-up animation starts now
    stage.refreshEnv();
    stage.disposeModel = () => {
      stage.scene.remove(group, ground, flora);
      disposables.forEach(d => d.dispose());
      stage.model = null; stage.ground = null; stage.pickables = []; stage.grow = [];
      stage.lit = { windows: [], crowns: [], lamps: [], ground: [] };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Which 동, how many floors, whether that height is surveyed: on hover with a
  // mouse, and on a tap (a touch that didn't turn the model) on phones.
  const pick = (e: { clientX: number; clientY: number; currentTarget: HTMLDivElement }, pinned: boolean) => {
    const stage = stageRef.current;
    if (!stage || !stage.pickables.length) { setTip(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, stage.camera);
    const hit = ray.intersectObjects(stage.pickables, false)[0];
    setTip(hit ? { x: e.clientX - rect.left, y: e.clientY - rect.top, text: hit.object.userData.label, pinned, w: rect.width } : null);
  };
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    if (e.buttons) { setTip(null); return; }
    if (!tip?.pinned) pick(e, false);
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => { press.current = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    // A drag turned the model: whatever was pinned no longer points at its building.
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8 || performance.now() - p.t > 450) { setTip(null); return; }
    pick(e, true);
  };

  const notice = data?.found && complexId ? staleNotice(data, complexId) : null;
  const measured = data?.coverage ? data.coverage.with_height : 0;
  const total = data?.coverage ? data.coverage.buildings : 0;
  const nextTod = TOD_ORDER[(TOD_ORDER.indexOf(tod) + 1) % TOD_ORDER.length];
  return (
    <section className="re-holo" aria-label="단지 3D 뷰">
      <header className="re-holo-head">
        <div>
          <small>{caption ?? "3D 단지뷰"}</small>
          <strong>{data?.name ?? complexName ?? "단지를 선택하세요"}</strong>
        </div>
        <div className="re-holo-tools">
          <button type="button" aria-pressed={spin} onClick={() => setSpin(v => !v)} title="360° 자동 회전">{spin ? "회전 ■" : "회전 ▶"}</button>
          <button type="button" onClick={() => setTod(nextTod)} title={`시간대 바꾸기 · 다음: ${TOD_LABEL[nextTod]}`}>{TOD_LABEL[tod]}</button>
        </div>
      </header>
      <div className="re-holo-stage" ref={hostRef} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp}
        onPointerLeave={e => { if (e.pointerType === "mouse" && !tip?.pinned) setTip(null); }}>
        {notice && <p className="re-holo-stale" role="note">{notice}</p>}
        {failed3d && <p className="re-holo-msg">이 브라우저에서는 3D를 표시할 수 없습니다.</p>}
        {loading && <div className="re-holo-scan" role="status"><span />건물 윤곽 불러오는 중…</div>}
        {!loading && error && <p className="re-holo-msg" role="status">{error}</p>}
        {tip && <div className={`re-holo-tip${tip.x > tip.w * 0.55 ? " is-left" : ""}${tip.pinned ? " is-pinned" : ""}`} style={{ left: tip.x, top: tip.y }}
          role="status">{tip.text}</div>}
      </div>
      <footer className="re-holo-foot">
        {data?.found ? (
          <>
            <span>건물 {total}개 · 층수·높이 확인 {measured}개{total > measured ? ` · ${data.source === "vworld" ? "층수 미등록 부대시설" : "높이 추정"} ${total - measured}개` : ""}</span>
            <span>{data.source === "vworld" ? "건물 윤곽·높이: " : "건물 윤곽: "}{data.attribution}. 외벽·창호·조경·가로등은 표현용</span>
          </>
        ) : <span>{coarse ? "한 손가락으로 돌리고 두 손가락으로 확대, 건물을 탭하면 동·층수를 봅니다." : "드래그로 회전, 휠로 확대합니다. 지도에서 단지를 누르면 바뀝니다."}</span>}
      </footer>
    </section>
  );
}
