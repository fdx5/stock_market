import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { api, RealEstateBuilding, RealEstateBuildingsResponse } from "../api/client";
import { vworldBuildings } from "./vworldBuildings";
import "../desk2/realestate-hologram.css";

/* 부동산 맵 — one complex as a turning hologram. Footprints and heights are the real
 * ones (backend app/services/realestate_buildings.py: 국토부 GIS건물통합정보 via
 * VWorld, else OpenStreetMap); only the facade — windows, balconies, paint — is
 * drawn, since no open source carries each building's real elevation. */

interface Palette { wall: string; wall2: string; accent: string; glass: [string, string]; roof: string; holo: string }

// Brand-inspired schemes (colour only, never a mark), matched on the complex name.
const BRANDS: [RegExp, Palette][] = [
  [/래미안|raemian/i, { wall: "#ecebe6", wall2: "#c9cbc4", accent: "#2f6b57", glass: ["#9cc3d6", "#27414f"], roof: "#6f7771", holo: "#5ff2c0" }],
  [/자이|xi\b/i, { wall: "#e7e5e1", wall2: "#3c3f45", accent: "#8b1d2c", glass: ["#a9c4d8", "#1f2c3a"], roof: "#4a4d52", holo: "#ff6f7f" }],
  [/힐스테이트|hillstate/i, { wall: "#efe9e0", wall2: "#7a5a48", accent: "#5a3a2e", glass: ["#b3cad6", "#2c3b45"], roof: "#6b5347", holo: "#ffb784" }],
  [/아이파크|ipark/i, { wall: "#f2f1ee", wall2: "#d8d6d0", accent: "#d1492e", glass: ["#a4c9e0", "#233a4d"], roof: "#8a8d90", holo: "#ff8a5c" }],
  [/푸르지오|prugio/i, { wall: "#eeeae0", wall2: "#b9c3a4", accent: "#4f7a3a", glass: ["#aecbd2", "#28413f"], roof: "#6f7865", holo: "#9dff7a" }],
  [/롯데캐슬|캐슬/i, { wall: "#f0ebe4", wall2: "#9c6b5d", accent: "#8c2230", glass: ["#b5c9d4", "#2e3a44"], roof: "#6e4c47", holo: "#ff7a94" }],
  [/e편한|이편한|편한세상/i, { wall: "#f3f2ef", wall2: "#cfd3d6", accent: "#c8102e", glass: ["#a8cde3", "#20384c"], roof: "#8d9296", holo: "#ff5f7a" }],
  [/더샵|the ?sharp/i, { wall: "#eceef0", wall2: "#304a63", accent: "#1d7a8c", glass: ["#9fc9dc", "#1b3244"], roof: "#4c5c6a", holo: "#57e3ff" }],
  [/아크로|acro/i, { wall: "#e9e3d6", wall2: "#3a3631", accent: "#b08d57", glass: ["#b9c6cc", "#262a2e"], roof: "#4b463f", holo: "#ffd27a" }],
  [/디에이치|the ?h\b/i, { wall: "#2f2f31", wall2: "#1d1d1f", accent: "#c4a05a", glass: ["#9fb0bd", "#15191d"], roof: "#2a2a2c", holo: "#ffcf6a" }],
  [/sk ?뷰|sk ?view|에스케이/i, { wall: "#f1efeb", wall2: "#d6d2ca", accent: "#e8661c", glass: ["#a6c8dc", "#22384a"], roof: "#8c8a86", holo: "#ffa25c" }],
  [/써밋|summit|호반/i, { wall: "#ebedf0", wall2: "#26344d", accent: "#3d5a8c", glass: ["#a2c1dc", "#1a2a40"], roof: "#46526a", holo: "#7aa8ff" }],
  [/위브|weve|두산/i, { wall: "#f0eee9", wall2: "#5b6f86", accent: "#2f5d8a", glass: ["#a8c6db", "#213448"], roof: "#5f6b78", holo: "#6fc0ff" }],
  [/센트레빌|centreville|동부/i, { wall: "#f1eee6", wall2: "#8aa36b", accent: "#3d6b3a", glass: ["#afcbd0", "#27403a"], roof: "#6c775f", holo: "#a4ff8a" }],
];
const FALLBACKS: Palette[] = [
  { wall: "#eeebe4", wall2: "#b8b3a8", accent: "#6d5d4b", glass: ["#aac5d4", "#26394a"], roof: "#77716a", holo: "#ffd08a" },
  { wall: "#e8ecef", wall2: "#8a9bab", accent: "#34566f", glass: ["#9fc4dc", "#1c3246"], roof: "#5d6a76", holo: "#78d4ff" },
  { wall: "#f0ece6", wall2: "#c2a38c", accent: "#9a5b3c", glass: ["#b1c8d2", "#2d3b43"], roof: "#806a5c", holo: "#ffab7a" },
  { wall: "#eceee9", wall2: "#9fae9a", accent: "#48644a", glass: ["#a9cbcd", "#243f3c"], roof: "#697663", holo: "#8dffb8" },
  { wall: "#efedf0", wall2: "#a69bb3", accent: "#5b4a78", glass: ["#adc2dc", "#252f47"], roof: "#6f6879", holo: "#c29bff" },
];

function paletteFor(name: string): Palette {
  const brand = BRANDS.find(([re]) => re.test(name));
  if (brand) return brand[1];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length];
}

// One facade tile: BAYS windows across, ROWS floors up; world scale set by the texture repeat.
const BAY_M = 3.2, FLOOR_M = 2.9, GROUND_M = 1.5, BAYS = 8, ROWS = 8;

function facadeTextures(p: Palette, seed: number) {
  const W = 1024, H = 928, cw = W / BAYS, ch = H / ROWS;
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  const color = mk(), glow = mk(), rough = mk();
  const g = color.getContext("2d")!, e = glow.getContext("2d")!, r = rough.getContext("2d")!;
  let s = seed || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = p.wall; g.fillRect(0, 0, W, H);
  // Subtle weathering so large walls don't read as flat plastic.
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.035})`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 30, 1 + rnd() * 3);
  }
  e.fillStyle = "#000"; e.fillRect(0, 0, W, H);
  r.fillStyle = "rgb(215,215,215)"; r.fillRect(0, 0, W, H);
  for (let row = 0; row < ROWS; row++) {
    for (let bay = 0; bay < BAYS; bay++) {
      const x = bay * cw, y = row * ch;
      if (bay % 4 === 3) { // pilaster between units, in the second wall colour
        g.fillStyle = p.wall2; g.fillRect(x + cw * 0.78, y, cw * 0.22, ch);
      }
      const wx = x + cw * 0.1, wy = y + ch * 0.2, ww = bay % 4 === 3 ? cw * 0.62 : cw * 0.8, wh = ch * 0.6;
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, p.glass[0]); grad.addColorStop(0.55, p.glass[1]); grad.addColorStop(1, p.glass[0]);
      g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(wx, wy, ww, wh * 0.12); // sky catch
      g.strokeStyle = "rgba(40,40,40,0.55)"; g.lineWidth = 3; g.strokeRect(wx, wy, ww, wh);
      g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.stroke(); // mullion
      g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(wx - 2, wy + wh * 0.62, ww + 4, 3); // balcony rail
      r.fillStyle = "rgb(28,28,28)"; r.fillRect(wx, wy, ww, wh);
      if (rnd() < 0.2) {
        const warm = 200 + Math.floor(rnd() * 55);
        e.fillStyle = `rgba(255,${warm},${120 + Math.floor(rnd() * 60)},${0.35 + rnd() * 0.5})`;
        e.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
      }
    }
    // Floor slab edge, the strongest horizontal line of a Korean apartment facade.
    g.fillStyle = p.wall2; g.fillRect(0, row * ch + ch - 7, W, 7);
    g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, row * ch + ch, W, 3);
  }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;
    t.repeat.set(1 / (BAYS * BAY_M), 1 / (ROWS * FLOOR_M));
    // WorldUVGenerator gives v = 1 - z: shift so floor lines start above the ground floor.
    t.offset.set(0, (1 - GROUND_M) / (ROWS * FLOOR_M));
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(color, true), emissiveMap: tex(glow, true), roughnessMap: tex(rough, false) };
}

const HOLO_VERT = `
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const HOLO_FRAG = `
uniform vec3 uColor; uniform float uScan; uniform float uStrength; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float band = exp(-pow((vY - uScan) / 3.0, 2.0));
  float lines = smoothstep(0.93, 1.0, fract(vY / ${FLOOR_M.toFixed(1)})) * 0.35;
  float flicker = 0.92 + 0.08 * sin(uTime * 7.0 + vY * 0.4);
  float a = (fres * 0.42 + band * 0.55 + lines * fres * 0.6) * uStrength * flicker;
  gl_FragColor = vec4(uColor * a, a);
}`;

function shapeOf(b: RealEstateBuilding): THREE.Shape {
  const [outer, ...holes] = b.rings;
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  holes.forEach(h => shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));
  return shape;
}

function extrude(b: RealEstateBuilding, bevel = false): THREE.ExtrudeGeometry {
  const depth = Math.max(2, b.height - b.base);
  const geo = new THREE.ExtrudeGeometry(shapeOf(b), { depth, bevelEnabled: bevel, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 1, steps: 1 });
  geo.translate(0, 0, b.base);
  return geo;
}

type Stage = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; composer: EffectComposer; bloom: UnrealBloomPass;
  sun: THREE.DirectionalLight; model: THREE.Group | null; holo: THREE.ShaderMaterial[];
  pickables: THREE.Mesh[]; edges: THREE.LineBasicMaterial[]; grow: { mesh: THREE.Object3D; delay: number }[]; born: number; now: number; top: number;
  disposeModel: () => void;
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

export default function ComplexHologram({ complexId, complexName, caption }: { complexId: string | null; complexName?: string; caption?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [data, setData] = useState<RealEstateBuildingsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [spin, setSpin] = useState(true);
  const [holoOn, setHoloOn] = useState(true);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; pinned: boolean; w: number } | null>(null);
  const [failed3d, setFailed3d] = useState(false);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  // One renderer for the panel's lifetime; each complex only swaps the model.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFailed3d(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#07090d");
    scene.fog = new THREE.FogExp2("#07090d", 0.0011);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);
    camera.position.set(260, 200, 260);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.1;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.enablePan = false;

    scene.add(new THREE.HemisphereLight("#cfe3ff", "#1a140c", 0.35));
    const sun = new THREE.DirectionalLight("#fff1dc", 1.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight("#7fb8ff", 0.9);
    rim.position.set(-300, 180, -260);
    scene.add(rim);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.45, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const stage: Stage = {
      renderer, scene, camera, controls, composer, bloom, sun, model: null, holo: [], pickables: [], edges: [], grow: [],
      born: 0, now: 0, top: 50, disposeModel: () => {},
    };
    stageRef.current = stage;

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.setSize(w / 2, h / 2);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    let idleTimer = 0;
    const onStart = () => { controls.autoRotate = false; window.clearTimeout(idleTimer); };
    const onEnd = () => { idleTimer = window.setTimeout(() => { controls.autoRotate = spinRef.current; }, 3500); };
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      stage.now = t;
      const since = t - stage.born;
      stage.grow.forEach(({ mesh, delay }) => {
        const k = Math.min(1, Math.max(0, (since - delay) / 1.1));
        mesh.scale.z = Math.max(0.001, 1 - Math.pow(1 - k, 3));
      });
      const scan = ((t * 0.35) % 1.4) * stage.top * 1.2 - stage.top * 0.1;
      stage.holo.forEach(m => { m.uniforms.uScan.value = since < 1.6 ? since / 1.6 * stage.top : scan; m.uniforms.uTime.value = t; });
      controls.update();
      composer.render();
    };
    // Paused while off screen: a spinning model below the fold should cost nothing.
    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(raf);
      if (entry.isIntersecting) loop();
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
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, []);

  const spinRef = useRef(spin);
  useEffect(() => {
    spinRef.current = spin;
    if (stageRef.current) stageRef.current.controls.autoRotate = spin;
  }, [spin]);
  useEffect(() => {
    stageRef.current?.holo.forEach(m => { m.uniforms.uStrength.value = holoOn ? 1 : 0; });
    const st = stageRef.current;
    if (st) {
      st.bloom.strength = holoOn ? 0.32 : 0.12;
      st.edges.forEach(m => { m.visible = holoOn; });
      // 실사: a clear dusk sky and brighter sun instead of the night stage.
      st.scene.background = new THREE.Color(holoOn ? "#07090d" : "#9fb7cf");
      if (st.scene.fog instanceof THREE.FogExp2) st.scene.fog.color.set(holoOn ? "#07090d" : "#b8c9da");
      st.sun.intensity = holoOn ? 1.7 : 2.3;
      st.renderer.toneMappingExposure = holoOn ? 0.82 : 0.95;
    }
  }, [holoOn, data]);

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

    let seed = 0;
    for (const ch of data.id) seed = (seed * 33 + ch.charCodeAt(0)) % 2147483647;
    const tex = facadeTextures(palette, seed);
    Object.values(tex).forEach(keep);
    const wall = keep(new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#d8d8d8"), map: tex.map, roughnessMap: tex.roughnessMap, emissiveMap: tex.emissiveMap, emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0.35, roughness: 1, metalness: 0.02, clearcoat: 0.12, clearcoatRoughness: 0.5, envMapIntensity: 0.55,
    }));
    const roof = keep(new THREE.MeshStandardMaterial({ color: palette.roof, roughness: 0.8, metalness: 0.1 }));
    const crown = keep(new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.45, metalness: 0.35, emissive: palette.accent, emissiveIntensity: 0.12 }));
    const low = keep(new THREE.MeshStandardMaterial({ color: palette.wall2, roughness: 0.7 }));
    const holoColor = new THREE.Color(palette.holo);

    const box = new THREE.Box3();
    const grow: Stage["grow"] = [];
    const pickables: THREE.Mesh[] = [];
    const holos: THREE.ShaderMaterial[] = [];
    const edgeMats: THREE.LineBasicMaterial[] = [];
    let top = 10;
    const tall = data.buildings.filter(b => b.floors >= 5);
    data.buildings.forEach((b, i) => {
      const geo = keep(extrude(b));
      const isTower = b.floors >= 5;
      const mesh = new THREE.Mesh(geo, isTower ? [roof, wall] : [roof, low]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.label = `${b.name ? b.name + " · " : ""}${heightLabel(b)}`;
      pickables.push(mesh);
      const holder = new THREE.Group();
      holder.add(mesh);
      if (isTower) {
        // Rooftop crown band and plant room, in the complex's accent colour.
        const cap = keep(new THREE.ExtrudeGeometry(shapeOf(b), { depth: 1.6, bevelEnabled: false }));
        cap.translate(0, 0, b.height);
        const capMesh = new THREE.Mesh(cap, crown);
        capMesh.castShadow = true;
        holder.add(capMesh);
        const holoMat = keep(new THREE.ShaderMaterial({
          vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { uColor: { value: holoColor }, uScan: { value: 0 }, uStrength: { value: holoOn ? 1 : 0 }, uTime: { value: 0 } },
        }));
        holos.push(holoMat);
        holder.add(new THREE.Mesh(geo, holoMat));
        const edges = keep(new THREE.EdgesGeometry(geo, 35));
        const edgeMat = keep(new THREE.LineBasicMaterial({ color: holoColor, transparent: true, opacity: 0.45 }));
        edgeMat.visible = holoOn;
        edgeMats.push(edgeMat);
        holder.add(new THREE.LineSegments(edges, edgeMat));
      }
      grow.push({ mesh: holder, delay: (tall.indexOf(b) >= 0 ? tall.indexOf(b) : i) * 0.03 });
      group.add(holder);
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
      top = Math.max(top, b.height);
    });

    // The neighbourhood as dark glass, so the complex reads against its real setting.
    const ext = data.buildings.flatMap(b => b.rings[0]).reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
    const reach = Math.max(ext * 1.8, ext + 140);
    const ctxGeos = data.context
      .filter(b => { const [x, y] = b.rings[0][0]; return Math.hypot(x, y) <= reach; })
      .map(b => extrude(b));
    if (ctxGeos.length) {
      const merged = keep(mergeGeometries(ctxGeos.map(g => { g.clearGroups(); return g; }), false)!);
      ctxGeos.forEach(g => g.dispose());
      const ctxMat = keep(new THREE.MeshStandardMaterial({ color: "#2a3442", roughness: 0.4, metalness: 0.5, transparent: true, opacity: 0.55, depthWrite: false }));
      const ctxMesh = new THREE.Mesh(merged, ctxMat);
      ctxMesh.receiveShadow = true;
      group.add(ctxMesh);
      const ctxEdges = keep(new THREE.EdgesGeometry(merged, 40));
      group.add(new THREE.LineSegments(ctxEdges, keep(new THREE.LineBasicMaterial({ color: "#4d6b8f", transparent: true, opacity: 0.22 }))));
    }

    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 60);
    const cx = (box.max.x + box.min.x) / 2, cy = (box.max.y + box.min.y) / 2;
    // Site boundary glowing on the ground.
    data.site.forEach(ring => {
      const pts = [...ring, ring[0]].map(([x, y]) => new THREE.Vector3(x, y, 0.3));
      const g = keep(new THREE.BufferGeometry().setFromPoints(pts));
      group.add(new THREE.Line(g, keep(new THREE.LineBasicMaterial({ color: holoColor, transparent: true, opacity: 0.9 }))));
      const fill = keep(new THREE.ShapeGeometry(new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)))));
      const fillMesh = new THREE.Mesh(fill, keep(new THREE.MeshStandardMaterial({ color: "#1f2a22", roughness: 0.95 })));
      fillMesh.position.z = 0.1;
      fillMesh.receiveShadow = true;
      group.add(fillMesh);
    });
    stage.scene.add(group);

    // Ground: a shadow catcher and a holographic ring grid under the complex.
    const radius = span * 1.6 + 120;
    const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(radius, 96)), keep(new THREE.MeshStandardMaterial({ color: "#0c1016", roughness: 0.9, metalness: 0.1 })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.05, -cy);
    ground.receiveShadow = true;
    stage.scene.add(ground);
    const rings = new THREE.PolarGridHelper(radius, 12, 10, 96, holoColor.clone().multiplyScalar(0.5), holoColor.clone().multiplyScalar(0.22));
    (rings.material as THREE.Material).transparent = true;
    (rings.material as THREE.Material).opacity = 0.35;
    rings.position.set(cx, 0.02, -cy);
    stage.scene.add(rings);

    // Camera and sun framed on the complex, not the neighbourhood.
    const target = new THREE.Vector3(cx, top * 0.32, -cy);
    const dist = Math.max(span, top * 1.4) * 1.12 + 30;
    stage.controls.target.copy(target);
    stage.camera.position.set(cx + dist * 0.72, top * 0.55 + dist * 0.5, -cy + dist * 0.72);
    stage.controls.minDistance = Math.max(30, span * 0.35);
    stage.controls.maxDistance = dist * 3;
    stage.scene.fog = new THREE.FogExp2("#07090d", 0.55 / (dist * 2.2));
    const sun = stage.sun;
    // A late-afternoon sun (~32°) so facades split into lit and shaded sides.
    const sunR = span * 1.2 + top;
    sun.position.set(cx + sunR * 0.8, sunR * 0.62, -cy + sunR * 0.45);
    sun.target.position.copy(target);
    const sc = sun.shadow.camera;
    const half = span * 0.9 + top;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = top * 4 + span * 3;
    sc.updateProjectionMatrix();

    stage.model = group;
    stage.holo = holos;
    stage.edges = edgeMats;
    stage.pickables = pickables;
    stage.grow = grow;
    stage.top = top;
    stage.born = stage.now; // the build-up animation starts now
    stage.disposeModel = () => {
      stage.scene.remove(group, ground, rings);
      rings.geometry.dispose();
      (rings.material as THREE.Material).dispose();
      disposables.forEach(d => d.dispose());
      stage.model = null; stage.holo = []; stage.edges = []; stage.pickables = []; stage.grow = [];
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
  return (
    <section className="re-holo" aria-label="단지 3D 홀로그램">
      <header className="re-holo-head">
        <div>
          <small>{caption ?? "3D HOLOGRAM"}</small>
          <strong>{data?.name ?? complexName ?? "단지를 선택하세요"}</strong>
        </div>
        <div className="re-holo-tools">
          <button type="button" aria-pressed={spin} onClick={() => setSpin(v => !v)} title="360° 자동 회전">{spin ? "회전 ■" : "회전 ▶"}</button>
          <button type="button" aria-pressed={holoOn} onClick={() => setHoloOn(v => !v)} title="홀로그램 효과">{holoOn ? "홀로그램" : "실사"}</button>
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
            <span>{data.source === "vworld" ? "건물 윤곽·높이: " : "건물 윤곽: "}{data.attribution}. 외벽 색·창호는 표현용</span>
          </>
        ) : <span>{coarse ? "한 손가락으로 돌리고 두 손가락으로 확대, 건물을 탭하면 동·층수를 봅니다." : "드래그로 회전, 휠로 확대합니다. 지도에서 단지를 누르면 바뀝니다."}</span>}
      </footer>
    </section>
  );
}
