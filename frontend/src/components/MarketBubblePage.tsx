import { MutableRefObject, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { StockBoard, StockBoardItem, api } from "../api/client";
import { Link, navigate } from "../router";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoUrl } from "../usLogo";
import { useDocumentTitle } from "../useDocumentTitle";
import { reportMarketBubbleEvent } from "../useActivityTracking";
import MarketBubbleIcon from "./MarketBubbleIcon";
import MarketBubbleDiscussion from "./MarketBubbleDiscussion";
import "./marketBubble.css";

type Market = "kospi" | "kosdaq" | "nasdaq";
type Body = {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number;
  impactX: number; impactY: number; impactZ: number;
  deform: number; deformTarget: number; deformVelocity: number;
  deformAngle: number; deformAngleTarget: number;
  wobbleEnergy: number; wobblePhase: number; jellyProfile: number;
  lastMatrix: string; lastOrigin: string; lastPosition: string;
  el: HTMLButtonElement | null; shell: HTMLSpanElement | null;
};

const FPS_METER_ENABLED = (() => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("fps")) return false;
  return !["0", "off", "false", "no"].includes((params.get("fps") ?? "").trim().toLowerCase());
})();

const BUBBLE_COUNT = 15;

const MARKETS: { key: Market; label: string; title: string }[] = [
  { key: "kospi", label: "코스피", title: "KOSPI 주요종목" },
  { key: "kosdaq", label: "코스닥", title: "KOSDAQ 주요종목" },
  { key: "nasdaq", label: "나스닥", title: "NASDAQ 주요종목" },
];

const PALETTE = [
  ["#f07f9f", "#b73d69"], ["#67b4ed", "#286eb9"], ["#e7bd57", "#a87019"],
  ["#e78ac4", "#a83d83"], ["#7395e8", "#3558ae"], ["#61c99a", "#197b59"],
  ["#f09a83", "#b94d42"], ["#72cbe0", "#23849e"], ["#f0ce78", "#ba8127"],
  ["#cf86d7", "#8f439d"], ["#71a8f0", "#3163bd"], ["#55c9c3", "#167d83"],
  ["#ee91b2", "#b44b78"], ["#dca94d", "#9b6418"], ["#879ee8", "#465db2"],
];

const SURFACE_ACCENTS = [
  ["#ffd0dc", "#d9d4ff"], ["#c9efff", "#e0d7ff"], ["#fff0ba", "#ffd4c8"],
  ["#ffd3ed", "#d7e9ff"], ["#d4e3ff", "#d8f4ef"], ["#c9f2df", "#fff0c5"],
  ["#ffd8ca", "#dcd8ff"], ["#d2f3ff", "#f0d8ff"], ["#fff1c3", "#d8efff"],
  ["#f3d4ff", "#d3f1ef"], ["#d2e6ff", "#ffe0ea"], ["#c9f4ef", "#ffe2cd"],
  ["#ffd4e4", "#d5eaff"], ["#ffe7af", "#d6f0ec"], ["#d8deff", "#f0d5ff"],
];

const transparentLogoCache = new Map<string, Promise<string>>();

function transparentBubbleLogo(src: string) {
  const cached = transparentLogoCache.get(src);
  if (cached) return cached;
  const request = new Promise<string>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) { resolve(src); return; }
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
          const brightest = Math.max(r, g, b), darkest = Math.min(r, g, b);
          if (darkest > 232 && brightest - darkest < 14) {
            pixels.data[i + 3] = Math.round(pixels.data[i + 3] * Math.max(0, (252 - darkest) / 20));
          }
        }
        context.putImageData(pixels, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch { resolve(src); }
    };
    image.onerror = () => resolve(src);
    image.src = src;
  });
  transparentLogoCache.set(src, request);
  return request;
}

function BubbleCompanyLogo({ src }: { src: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setResolved(null);
    transparentBubbleLogo(src).then((next) => { if (alive) setResolved(next); });
    return () => { alive = false; };
  }, [src]);
  if (!resolved) return null;
  return <img src={resolved} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />;
}

function rankRadiusScale(index: number, mobile = false) {
  if (index < 2) return 1.827;  // 1–2
  if (index < 5) return 1.449;  // 3–5
  if (index < 8) return 1.26;   // 6–8
  if (index < 11) return mobile ? 1.1445 : 1.1025; // 9–11
  if (index < 14) return mobile ? 1.071 : .987;    // 12–14
  return mobile ? 1.03 : .90;                 // 15위
}

function formatPrice(item: StockBoardItem, market: Market) {
  return market === "nasdaq"
    ? `$${item.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${Math.round(item.close).toLocaleString("ko-KR")}원`;
}

function shortName(item: StockBoardItem, market: Market) {
  const name = market === "nasdaq" ? item.name_ko || item.name : item.name;
  return name.replace(/\s+(Inc\.?|Corporation|Corp\.?|Common Stock).*$/i, "").slice(0, 18);
}

function BubbleFpsMeter({ bubbles }: { bubbles: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const worstRef = useRef<HTMLSpanElement>(null);
  const heapRef = useRef<HTMLSpanElement>(null);
  const runtimeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0, frames = 0, worst = 0;
    const started = performance.now();
    let since = started, previous = started;
    const tick = (now: number) => {
      const delta = now - previous; previous = now;
      if (delta < 1000) worst = Math.max(worst, delta);
      frames += 1;
      const elapsed = now - since;
      if (elapsed >= 500) {
        const fps = frames * 1000 / elapsed;
        if (fpsRef.current) fpsRef.current.textContent = fps.toFixed(0);
        if (frameRef.current) frameRef.current.textContent = `${(elapsed / frames).toFixed(1)} ms`;
        if (worstRef.current) worstRef.current.textContent = `${worst.toFixed(1)} ms`;
        if (runtimeRef.current) runtimeRef.current.textContent = `${Math.floor((now - started) / 1000)} s`;
        if (rootRef.current) rootRef.current.dataset.tone = fps >= 50 ? "good" : fps >= 30 ? "fair" : "bad";
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        if (heapRef.current) heapRef.current.textContent = memory ? `${(memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : "N/A";
        frames = 0; worst = 0; since = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="bubble-fps" ref={rootRef} data-tone="good" aria-hidden="true">
      <div><strong ref={fpsRef}>—</strong><b>FPS</b><span ref={frameRef}>— ms</span></div>
      <small>WORST <span ref={worstRef}>— ms</span></small>
      <small>HEAP <span ref={heapRef}>—</span></small>
      <small>RUNTIME <span ref={runtimeRef}>— s</span></small>
      <small>BUBBLES <span>{bubbles}</span></small>
    </div>
  );
}

function BubbleWebGLSurface({ bodiesRef, palette, count, focusRef }: {
  bodiesRef: MutableRefObject<Body[]>; palette: number[]; count: number; focusRef: MutableRefObject<number | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current, stage = canvas?.parentElement;
    if (!canvas || !stage || count === 0) return;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.15 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .96;
    const scene = new THREE.Scene();
    // Keep the camera well outside even the largest rank-scaled sphere.
    // A close camera clips the front cap of large spheres and makes them look
    // like white-centred rings because the transparent page shows through.
    const cameraDistance = 1200;
    const camera = new THREE.PerspectiveCamera(42, 1, 20, 2600);
    camera.position.z = cameraDistance;
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = .065;
    controls.enablePan = true;
    controls.panSpeed = .55;
    controls.rotateSpeed = .48;
    controls.zoomSpeed = .72;
    controls.minDistance = 520;
    controls.maxDistance = 1900;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    const releaseFocus = () => { focusRef.current = null; };
    controls.addEventListener("start", releaseFocus);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    scene.environment = environment;
    scene.add(new THREE.HemisphereLight(0xeef6ff, 0x10182a, .82));
    const key = new THREE.DirectionalLight(0xfff4dc, 1.55); key.position.set(-4, 6, 9); scene.add(key);
    const fill = new THREE.DirectionalLight(0x90bfff, .52); fill.position.set(6, 1, 6); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xa9dfff, .62); rim.position.set(-5, -4, 3); scene.add(rim);
    // Extra radial segments keep the frozen organic profile round even on the
    // smallest bubbles.  The previous low-poly silhouette exposed corners.
    const geometry = new THREE.SphereGeometry(1, window.innerWidth <= 760 ? 40 : 56, window.innerWidth <= 760 ? 28 : 40);
    const meshes: THREE.Mesh[] = [], shadows: THREE.Sprite[] = [], shadowTextures: THREE.CanvasTexture[] = [], shaders: any[] = [];
    for (let i = 0; i < count; i++) {
      const colors = PALETTE[palette[i] % PALETTE.length];
      const accents = SURFACE_ACCENTS[palette[i] % SURFACE_ACCENTS.length];
      const baseColor = new THREE.Color(colors[0]).lerp(new THREE.Color(colors[1]), .41);
      const lightVariation = ((i * 37) % 11) / 10;
      const material = new THREE.MeshPhysicalMaterial({
        color: baseColor,
        roughness: .2 + (i % 4) * .018,
        metalness: .035,
        clearcoat: .92,
        clearcoatRoughness: .12 + (i % 3) * .025,
        envMapIntensity: .98 + lightVariation * .34,
        sheen: .27 + lightVariation * .17,
        sheenColor: new THREE.Color(colors[0]).lerp(new THREE.Color(i % 2 ? 0xd9e9ff : 0xffead6), .26 + lightVariation * .2),
        sheenRoughness: .42,
        specularIntensity: .96,
        specularColor: new THREE.Color(colors[0]).lerp(new THREE.Color(0xffffff), .72),
        iridescence: .22 + (i % 3) * .035,
        iridescenceIOR: 1.38,
        iridescenceThicknessRange: [110, 320],
        emissive: new THREE.Color(colors[1]).lerp(new THREE.Color(colors[0]), .42),
        emissiveIntensity: .035 + lightVariation * .045,
        transparent: true,
        opacity: .9,
        depthWrite: true,
      });
      // Rotate the room reflection independently for each sphere. This keeps
      // highlights tied to the curved material without stamping one identical
      // white spot on every bubble.
      material.envMapRotation.set(
        ((i * 37) % 19 - 9) * Math.PI / 180,
        (i * 137.508) * Math.PI / 180,
        ((i * 61) % 23 - 11) * Math.PI / 180,
      );
      // Re-roll a hand-shaped mochi silhouette on every page entry. The
      // profile stays frozen afterwards, so only an actual collision moves it.
      const organicSeed = Math.random() * Math.PI * 2;
      const organicShape = new THREE.Vector4(
        organicSeed,
        .022 + Math.random() * .025,
        (Math.random() - .5) * .075,
        (Math.random() - .5) * .06,
      );
      const mochiDetail = new THREE.Vector3(
        2 + Math.floor(Math.random() * 2),
        3 + Math.floor(Math.random() * 3),
        Math.random() * Math.PI * 2,
      );
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uImpact = { value: new THREE.Vector3(1, 0, 0) };
        shader.uniforms.uOrganic = { value: organicShape };
        shader.uniforms.uMochiDetail = { value: mochiDetail };
        shader.uniforms.uAccentA = { value: new THREE.Color(accents[0]) };
        shader.uniforms.uAccentB = { value: new THREE.Color(accents[1]) };
        const baseCoverage = [.74, .58, .82, .48, .68][i % 5];
        shader.uniforms.uAccentStrength = { value: new THREE.Vector2((1 - baseCoverage) * 1.12, i % 3 === 0 ? 0 : (1 - baseCoverage) * .76) };
        shader.uniforms.uAccentSpread = { value: new THREE.Vector2(1.45 + (i * 7 % 23) * .09, 1.7 + (i * 11 % 19) * .11) };
        shader.uniforms.uAccentDirA = { value: new THREE.Vector3(-.72 + (i * 17 % 31) / 50, .28 + (i * 13 % 29) / 60, .68).normalize() };
        shader.uniforms.uAccentDirB = { value: new THREE.Vector3(.42 + (i * 19 % 27) / 52, -.55 + (i * 7 % 25) / 55, .7).normalize() };
        shader.uniforms.uDeform = { value: 0 }; shader.uniforms.uWobble = { value: 0 }; shader.uniforms.uPhase = { value: 0 };
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform vec3 uImpact; uniform vec4 uOrganic; uniform vec3 uMochiDetail; uniform float uDeform; uniform float uWobble; uniform float uPhase; varying vec3 vBubbleNormal;").replace("#include <begin_vertex>", `vec3 transformed=vec3(position); vec3 n=normalize(objectNormal); vBubbleNormal=n; float azimuth=atan(n.y,n.x); float mochi=sin(azimuth*uMochiDetail.x+uOrganic.x)*.68+sin(azimuth*uMochiDetail.y+uMochiDetail.z)*.32; transformed*=vec3(1.0+uOrganic.z,1.0+uOrganic.w,1.0-(uOrganic.z+uOrganic.w)*.22); transformed+=n*mochi*uOrganic.y; vec3 hit=normalize(uImpact); float facing=clamp(dot(n,hit),-1.0,1.0); float contact=smoothstep(-.34,1.0,facing); contact*=contact; float stickyTip=pow(max(0.0,facing),7.0); float stickyNeck=pow(max(0.0,facing),3.1); float back=pow(max(0.0,-facing),1.9); float shoulder=pow(max(0.0,1.0-abs(facing)),1.22); float compression=max(uDeform,0.0); float adhesion=max(-uDeform,0.0); float contactRebound=sin(uPhase)*uWobble; float delayedBack=sin(uPhase-.72)*uWobble; float axial=dot(transformed,hit); float frontPlate=smoothstep(.4,.97,axial); transformed+=hit*compression*(1.0-axial)*1.08; transformed+=hit*frontPlate*compression*.07; transformed+=n*(-contact*compression*.22+shoulder*compression*.34+stickyNeck*adhesion*.72+stickyTip*adhesion*2.35-shoulder*adhesion*.08);`);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uAccentA; uniform vec3 uAccentB; uniform vec2 uAccentStrength; uniform vec2 uAccentSpread; uniform vec3 uAccentDirA; uniform vec3 uAccentDirB; varying vec3 vBubbleNormal;")
          .replace("#include <color_fragment>", `#include <color_fragment>\nvec3 bubbleN=normalize(vBubbleNormal); float accentA=pow(max(dot(bubbleN,uAccentDirA),0.0),uAccentSpread.x); float accentB=pow(max(dot(bubbleN,uAccentDirB),0.0),uAccentSpread.y); diffuseColor.rgb=mix(diffuseColor.rgb,uAccentA,accentA*uAccentStrength.x); diffuseColor.rgb=mix(diffuseColor.rgb,uAccentB,accentB*uAccentStrength.y); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0),pow(1.0-max(bubbleN.z,0.0),2.5)*.14);`);
        shaders[i] = shader;
      };
      const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh); meshes.push(mesh); shaders.push(null);

      // Each bubble gets a subtly different, palette-tinted pool of shadow.
      // Keeping this in WebGL makes the shadow follow the organic body without
      // reintroducing the detached circular CSS layer.
      const shadowCanvas = document.createElement("canvas");
      shadowCanvas.width = 128; shadowCanvas.height = 128;
      const shadowContext = shadowCanvas.getContext("2d");
      if (shadowContext) {
        const shadowColor = new THREE.Color(colors[1]);
        const red = Math.round(shadowColor.r * 255), green = Math.round(shadowColor.g * 255), blue = Math.round(shadowColor.b * 255);
        const gradient = shadowContext.createRadialGradient(64, 64, 5, 64, 64, 62);
        gradient.addColorStop(0, `rgba(${red},${green},${blue},${.31 + (i % 4) * .025})`);
        gradient.addColorStop(.42, `rgba(${red},${green},${blue},.14)`);
        gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`);
        shadowContext.fillStyle = gradient; shadowContext.fillRect(0, 0, 128, 128);
      }
      const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
      const shadowMaterial = new THREE.SpriteMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: .68 + (i % 5) * .045 });
      const shadow = new THREE.Sprite(shadowMaterial); shadow.renderOrder = -1; scene.add(shadow);
      shadows.push(shadow); shadowTextures.push(shadowTexture);
    }
    const resize = () => { const w=stage.clientWidth,h=stage.clientHeight; renderer.setSize(w,h,false); camera.aspect=w/Math.max(1,h);camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(h/(2*cameraDistance)));camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(stage); resize(); stage.classList.add("is-webgl");
    let raf=0;
    const projected = new THREE.Vector3();
    const render=()=>{ const bodies=bodiesRef.current,w=stage.clientWidth,h=stage.clientHeight;const focused=focusRef.current==null?null:meshes[focusRef.current];if(focused){controls.target.lerp(focused.position,.055);const desired=focused.position.clone().add(new THREE.Vector3(0,0,Math.max(570,focused.scale.x*5.4)));camera.position.lerp(desired,.04);}controls.update();meshes.forEach((mesh,i)=>{const body=bodies[i],shadow=shadows[i];mesh.visible=Boolean(body);shadow.visible=Boolean(body);if(!body)return;mesh.position.set(body.x-w/2,h/2-body.y,body.z);mesh.scale.setScalar(body.r);mesh.rotation.x+=body.vy*.00018;mesh.rotation.y+=body.vx*.00022;const shadowAngle=((i*53)%360)*Math.PI/180;const shadowOffset=body.r*(.055+(i%4)*.014);shadow.position.set(body.x-w/2+Math.cos(shadowAngle)*shadowOffset,h/2-body.y+Math.sin(shadowAngle)*shadowOffset,body.z-body.r*.72);shadow.scale.set(body.r*(2.05+(i%3)*.08),body.r*(1.66+(i%4)*.06),1);const shader=shaders[i];if(shader){shader.uniforms.uImpact.value.set(body.impactX,-body.impactY,body.impactZ).normalize();shader.uniforms.uDeform.value=body.deform;shader.uniforms.uWobble.value=body.wobbleEnergy;shader.uniforms.uPhase.value=body.wobblePhase;}if(body.el){projected.copy(mesh.position).project(camera);const px=(projected.x*.5+.5)*w,py=(-projected.y*.5+.5)*h;const distance=camera.position.distanceTo(mesh.position);const scale=Math.max(.52,Math.min(1.75,cameraDistance/distance));const position=`translate3d(${(px-body.r).toFixed(1)}px,${(py-body.r).toFixed(1)}px,0) scale(${scale.toFixed(4)})`;if(position!==body.lastPosition){body.el.style.transform=position;body.lastPosition=position;}body.el.style.zIndex=`${10+Math.round((1-projected.z)*500)}`;body.el.style.setProperty("--info-compensation",`${Math.min(1.32,Math.max(1,1/scale)).toFixed(3)}`);body.el.style.visibility=projected.z>1||projected.z<-1?"hidden":"visible";}});renderer.render(scene,camera);raf=requestAnimationFrame(render);};
    raf=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(raf);observer.disconnect();controls.removeEventListener("start",releaseFocus);controls.dispose();stage.classList.remove("is-webgl");meshes.forEach(m=>(m.material as THREE.Material).dispose());shadows.forEach(s=>(s.material as THREE.Material).dispose());shadowTextures.forEach(t=>t.dispose());geometry.dispose();environment.dispose();pmrem.dispose();renderer.dispose();};
  }, [bodiesRef, count, focusRef, palette]);
  return <canvas ref={canvasRef} className="bubble-webgl-surface" aria-hidden="true" />;
}

export default function MarketBubblePage() {
  const [market, setMarket] = useState<Market>(() => {
    const requested = new URLSearchParams(window.location.search).get("market")?.toLowerCase();
    return requested === "kosdaq" || requested === "nasdaq" || requested === "kospi" ? requested : "kospi";
  });
  const [board, setBoard] = useState<StockBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [palette] = useState(() => Array.from({ length: BUBBLE_COUNT }, (_, i) => i % PALETTE.length).sort(() => Math.random() - .5));
  const [discussionIndex, setDiscussionIndex] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bodiesRef = useRef<Body[]>([]);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const pointerRef = useRef({ x: -9999, y: -9999, active: false });
  const pinnedRef = useRef<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const firstLoadRef = useRef(true);
  useDocumentTitle("증시버블 · K-Stock Hub");

  const items = useMemo(() => board?.items.slice().sort((a, b) => a.rank - b.rank).slice(0, BUBBLE_COUNT) ?? [], [board]);

  useEffect(() => () => {
    if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDiscussionIndex(null);
    api.stockBoard(market).then((next) => {
      if (!alive) return;
      setBoard(next);
      setLoading(false);
      firstLoadRef.current = true;
    }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [market]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      api.stockBoardRefresh(market).then((fresh) => {
        setBoard((prev) => prev ? { ...prev, ...fresh, spark_dates: prev.spark_dates, items: fresh.items.map((it) => ({ ...it, points: prev.items.find((old) => old.code === it.code)?.points ?? [] })) } : prev);
      }).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(id);
  }, [market]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || items.length === 0) return;
    const rect = stage.getBoundingClientRect();
    const getBaseRadius = (width: number, height: number) => Math.max(22, Math.min(
      88,
      width / 10,
      height / 9.2,
      Math.sqrt((width * height) / BUBBLE_COUNT) * .42,
    ));
    const base = getBaseRadius(rect.width, rect.height);
    const rows = Math.ceil(items.length / 5);
    const nextBodies: Body[] = items.map((_, i) => {
      const col = i % 5, row = Math.floor(i / 5);
      const r = base * rankRadiusScale(i, rect.width <= 760);
      return {
        x: ((col + .65 + (row % 2) * .16) / 5.35) * rect.width,
        y: ((row + .7) / (rows + .45)) * rect.height,
        vx: (Math.random() - .5) * .44,
        vy: (Math.random() - .5) * .44,
        z: -210 + (i * 83) % 470,
        vz: (Math.random() - .5) * .52,
        r,
        impactX: 1,
        impactY: 0,
        impactZ: 0,
        deform: 0,
        deformTarget: 0,
        deformVelocity: 0,
        deformAngle: 0,
        deformAngleTarget: 0,
        wobbleEnergy: 0,
        wobblePhase: Math.random() * Math.PI * 2,
        jellyProfile: i % 4,
        lastMatrix: "",
        lastOrigin: "",
        lastPosition: "",
        el: null,
        shell: null,
      };
    });
    stage.querySelectorAll<HTMLButtonElement>(".stock-bubble").forEach((el, i) => {
      const body = nextBodies[i];
      if (!body) return;
      body.el = el;
      body.shell = el.querySelector<HTMLSpanElement>(".stock-bubble-shell");
      el.style.width = `${body.r * 2}px`;
      el.style.height = `${body.r * 2}px`;
      el.style.transform = `translate3d(${body.x - body.r}px,${body.y - body.r}px,0)`;
    });
    bodiesRef.current = nextBodies;
    stageSizeRef.current = { width: rect.width, height: rect.height };
    firstLoadRef.current = false;

    const resizeStage = () => {
      const nextRect = stage.getBoundingClientRect();
      const previousSize = stageSizeRef.current;
      if (nextRect.width <= 0 || nextRect.height <= 0 ||
          (nextRect.width === previousSize.width && nextRect.height === previousSize.height)) return;

      const nextBase = getBaseRadius(nextRect.width, nextRect.height);
      bodiesRef.current.forEach((body, i) => {
        const radiusScale = rankRadiusScale(i, nextRect.width <= 760);
        const nextRadius = nextBase * radiusScale;
        body.x = previousSize.width > 0 ? body.x / previousSize.width * nextRect.width : nextRect.width / 2;
        body.y = previousSize.height > 0 ? body.y / previousSize.height * nextRect.height : nextRect.height / 2;
        body.r = nextRadius;
        body.x = Math.max(nextRadius, Math.min(nextRect.width - nextRadius, body.x));
        body.y = Math.max(nextRadius, Math.min(nextRect.height - nextRadius, body.y));
        if (body.el) {
          body.el.style.width = `${nextRadius * 2}px`;
          body.el.style.height = `${nextRadius * 2}px`;
          body.el.style.transform = `translate3d(${body.x - nextRadius}px,${body.y - nextRadius}px,0)`;
        }
      });
      pointerRef.current.active = false;
      stageSizeRef.current = { width: nextRect.width, height: nextRect.height };
    };

    const observer = new ResizeObserver(resizeStage);
    observer.observe(stage);
    window.addEventListener("orientationchange", resizeStage);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", resizeStage);
    };
  }, [market, items.map((it) => it.code).join(",")]);

  useEffect(() => {
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const stage = stageRef.current;
      if (!stage) { frame = requestAnimationFrame(tick); return; }
      if (document.hidden) {
        previous = now;
        pointerRef.current.active = false;
        frame = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(2, (now - previous) / 16.667); previous = now;
      const width = stage.clientWidth, height = stage.clientHeight;
      const bodies = bodiesRef.current;
      const pointer = pointerRef.current;
      const excite = (body: Body, amount: number, angle: number) => {
        // Preserve the actual contact side (not only the collision axis), while
        // still taking the shortest path as that contact direction changes.
        const difference = ((angle - body.deformAngleTarget + 180) % 360 + 360) % 360 - 180;
        if (amount > body.deformTarget + .008) {
          body.deformAngleTarget += difference;
          body.wobbleEnergy = 0;
          body.wobblePhase = 0;
          // Let impact direction and strength select the material response, so
          // repeated contacts do not replay one recognisable deformation loop.
          body.jellyProfile = Math.abs(Math.floor(angle / 37) + Math.floor(amount * 113)) % 4;
        }
        body.deformTarget = Math.max(body.deformTarget, amount);
        body.deform = Math.max(body.deform, amount * .46);
        body.deformVelocity = 0;
      };
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        // Ease toward a decaying target. Sustained contact holds a soft shape;
        // separation releases it gradually with a subtle gelatin overshoot.
        a.deformTarget *= Math.pow(.935, dt);
        // A short, collision-triggered recoil: one or two gelatin oscillations,
        // then a completely still surface until the next impact.
        a.wobbleEnergy = 0;
        // Monotonic easing prevents the surface from overshooting and
        // shivering after contact while keeping a soft recovery.
        a.deform += (a.deformTarget - a.deform) * Math.min(1, .16 * dt);
        a.deformVelocity = 0;
        const angleDifference = ((a.deformAngleTarget - a.deformAngle + 180) % 360 + 360) % 360 - 180;
        a.deformAngle += angleDifference * Math.min(1, .075 * dt);
        if (a.deformTarget < .0003 && Math.abs(a.deform) < .0003 && Math.abs(a.deformVelocity) < .0003) {
          a.deform = 0;
          a.deformVelocity = 0;
        }
        a.deform = Math.max(-.3, Math.min(.62, a.deform));
        if (pinnedRef.current === i) {
          a.vx = 0; a.vy = 0; a.vz = 0;
          continue;
        }
        if (pointer.active) {
          const dx = a.x - pointer.x, dy = a.y - pointer.y;
          const d = Math.hypot(dx, dy) || 1;
          const reach = a.r + 68;
          if (d < reach) { const f = (reach - d) / reach * .72; a.vx += dx / d * f; a.vy += dy / d * f; }
        }
        a.vx += Math.sin(now * .00038 + i * 1.71) * .005;
        a.vy += Math.cos(now * .00031 + i * 1.13) * .005;
        a.vz += Math.sin(now * .00027 + i * 2.03) * .0035;
        a.vx *= .995; a.vy *= .995; a.vz *= .995;
        const speed = Math.hypot(a.vx, a.vy, a.vz);
        if (speed > 3.25) { const limit = 3.25 / speed; a.vx *= limit; a.vy *= limit; a.vz *= limit; }
        a.x += a.vx * dt * 4.5; a.y += a.vy * dt * 4.5; a.z += a.vz * dt * 4.5;
        const depthScale = Math.max(.55, (1200 - a.z) / 1200);
        const halfViewWidth = width * depthScale * .5;
        const halfViewHeight = height * depthScale * .5;
        const minX = width * .5 - halfViewWidth + a.r, maxX = width * .5 + halfViewWidth - a.r;
        const minY = height * .5 - halfViewHeight + a.r, maxY = height * .5 + halfViewHeight - a.r;
        if (a.x < minX) { const speed = Math.abs(a.vx); a.x = minX; a.vx = speed * .78; a.impactX=-1;a.impactY=0;a.impactZ=0;excite(a, Math.min(.36, .09+speed*.05), 180); }
        if (a.x > maxX) { const speed = Math.abs(a.vx); a.x = maxX; a.vx = -speed * .78; a.impactX=1;a.impactY=0;a.impactZ=0;excite(a, Math.min(.36, .09+speed*.05), 0); }
        if (a.y < minY) { const speed = Math.abs(a.vy); a.y = minY; a.vy = speed * .78; a.impactX=0;a.impactY=-1;a.impactZ=0;excite(a, Math.min(.36, .09+speed*.05), -90); }
        if (a.y > maxY) { const speed = Math.abs(a.vy); a.y = maxY; a.vy = -speed * .78; a.impactX=0;a.impactY=1;a.impactZ=0;excite(a, Math.min(.36, .09+speed*.05), 90); }
        const zLimit = width <= 760 ? 280 : 360;
        if (a.z < -zLimit) { const speed=Math.abs(a.vz);a.z=-zLimit;a.vz=speed*.8;a.impactX=0;a.impactY=0;a.impactZ=-1;excite(a,Math.min(.34,.08+speed*.05),0); }
        if (a.z > zLimit) { const speed=Math.abs(a.vz);a.z=zLimit;a.vz=-speed*.8;a.impactX=0;a.impactY=0;a.impactZ=1;excite(a,Math.min(.34,.08+speed*.05),0); }
      }
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z;
        const distance = Math.hypot(dx,dy,dz) || 1;
        const contactDistance = (a.r+b.r)*.94;
        if (distance >= contactDistance) continue;
        const nx=dx/distance, ny=dy/distance, nz=dz/distance;
        const penetration=contactDistance-distance;
        const aMovable=pinnedRef.current!==i, bMovable=pinnedRef.current!==j;
        const aShare=aMovable?(bMovable?.5:1):0, bShare=bMovable?(aMovable?.5:1):0;
        a.x-=nx*penetration*aShare;a.y-=ny*penetration*aShare;a.z-=nz*penetration*aShare;
        b.x+=nx*penetration*bShare;b.y+=ny*penetration*bShare;b.z+=nz*penetration*bShare;
        const relativeNormal=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny+(b.vz-a.vz)*nz;
        const impactSpeed=Math.max(0,-relativeNormal);
        if(relativeNormal<0){
          const restitution=.68;
          const impulse=-(1+restitution)*relativeNormal/(Math.max(.5,aShare+bShare));
          if(aMovable){a.vx-=nx*impulse*aShare;a.vy-=ny*impulse*aShare;a.vz-=nz*impulse*aShare;}
          if(bMovable){b.vx+=nx*impulse*bShare;b.vy+=ny*impulse*bShare;b.vz+=nz*impulse*bShare;}
        }
        const softness=Math.min(.46,Math.max(.1,.1+penetration/Math.max(24,Math.min(a.r,b.r))*.32+impactSpeed*.055));
        a.impactX=nx;a.impactY=ny;a.impactZ=nz;
        b.impactX=-nx;b.impactY=-ny;b.impactZ=-nz;
        const angle=Math.atan2(ny,nx)*180/Math.PI;
        excite(a,softness,angle);excite(b,softness,angle+180);
      }
      bodies.forEach((body) => {
        if (body.el) {
          const squash = body.deform;
          // A settled bubble must leave its expensive translucent shell cached.
          // Continuous sub-pixel "breathing" forced all shells to composite forever.
          const isDeforming = Math.abs(squash) > .0008 || body.wobbleEnergy > .001;
          const waveA = Math.sin(body.wobblePhase) * body.wobbleEnergy;
          const waveB = Math.sin(body.wobblePhase * (1.32 + body.jellyProfile * .09) + 1.65) * body.wobbleEnergy;
          const axisTravel = [0, waveB * 12, waveA * 7, (waveA - waveB) * 11][body.jellyProfile];
          const impactRadians = (body.deformAngle + axisTravel) * Math.PI / 180;
          const impactX = Math.cos(impactRadians);
          const impactY = Math.sin(impactRadians);
          const normalCompression = [1.5, 1.7, 1.34, 1.57][body.jellyProfile];
          const tangentExpansion = [1.02, 1.18, .9, 1.08][body.jellyProfile];
          const rebound = [waveA * .025, waveA * .035, waveA * .018, (waveA * .022 + waveB * .012)][body.jellyProfile];
          const sideRipple = [waveA * .015, waveB * .02, waveA * .012, (waveA - waveB) * .015][body.jellyProfile];
          const normalScale = isDeforming ? Math.max(.4, Math.min(1.25, 1 - squash * normalCompression + rebound)) : 1;
          const tangentScale = isDeforming ? Math.max(.78, Math.min(1.68, 1 + squash * tangentExpansion - sideRipple)) : 1;
          const scaleDifference = normalScale - tangentScale;
          const matrix11 = tangentScale + scaleDifference * impactX * impactX;
          const matrix12 = scaleDifference * impactX * impactY;
          const matrix21 = matrix12;
          const matrix22 = tangentScale + scaleDifference * impactY * impactY;
          const matrix = isDeforming ? `matrix(${matrix11.toFixed(3)},${matrix12.toFixed(3)},${matrix21.toFixed(3)},${matrix22.toFixed(3)},0,0)` : "matrix(1,0,0,1,0,0)";
          const contactRadians = body.deformAngle * Math.PI / 180;
          const contactX = Math.cos(contactRadians), contactY = Math.sin(contactRadians);
          const anchorDepth = [48, 43, 52, 46][body.jellyProfile];
          const origin = `${(50 - contactX * anchorDepth).toFixed(1)}% ${(50 - contactY * anchorDepth).toFixed(1)}%`;
          if (body.shell && matrix !== body.lastMatrix) { body.shell.style.transform = matrix; body.lastMatrix = matrix; }
          if (body.shell && origin !== body.lastOrigin) { body.shell.style.transformOrigin = origin; body.lastOrigin = origin; }
        }
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
  };

  return (
    <main className="bubble-page">
      <header className="bubble-header">
        <div className="bubble-header-start">
          <Link to="/desk" className="bubble-back-link" aria-label="메인 대시보드로 돌아가기">
            <span aria-hidden="true">←</span>
          </Link>
          <Link to="/desk" className="bubble-brand" aria-label="K-Stock Hub 홈">
          <span className="bubble-brand-mark"><MarketBubbleIcon /></span>
          <span><strong>증시버블</strong><small>MARKET BUBBLES</small></span>
          </Link>
        </div>
        <div className="bubble-heading">
          <p>시가총액 TOP 15 · 5초마다 갱신</p>
          <h1>{MARKETS.find((it) => it.key === market)?.title}</h1>
        </div>
        <div className="bubble-live"><i /> LIVE <span>{board ? new Date(board.generated_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}</span></div>
      </header>

      <section
        ref={stageRef}
        className="bubble-stage"
        aria-label={`${market} 시가총액 상위 15개 종목 버블`}
        onPointerMove={movePointer}
        onPointerLeave={() => { pointerRef.current.active = false; }}
      >
        {!loading && <BubbleWebGLSurface bodiesRef={bodiesRef} palette={palette} count={items.length} focusRef={focusRef} />}
        <div className="bubble-stage-hint">버블을 건드려 보세요 <span>마우스 이동 · 클릭</span></div>
        {loading && <div className="bubble-loading"><MarketBubbleIcon /><span>시장 데이터를 불러오는 중</span></div>}
        {!loading && items.map((item, index) => {
          const colors = PALETTE[palette[index] % PALETTE.length];
          const body = bodiesRef.current[index];
          const diameter = (body?.r ?? 72) * 2;
          const lightAngle = 108 + (index * 17) % 46;
          const rimAngle = (index * 47 + 18) % 360;
          const rimWidth = 2.1 + (index % 3) * .35;
          const rimAlpha = .28 + (index % 4) * .035;
          const highlightX = 24 + (index * 13) % 18;
          const highlightY = 17 + (index * 7) % 16;
          const causticX = 58 + (index * 11) % 17;
          const light2X = 58 + (index * 17) % 27;
          const light2Y = 19 + (index * 23) % 54;
          const mainLightWidth = 16 + (index * 11) % 18;
          const mainLightHeight = 7 + (index * 7) % 10;
          const mainLightAngle = -38 + (index * 29) % 76;
          const secondaryLightOpacity = index % 5 === 2 ? .34 : index % 7 === 4 ? .2 : 0;
          const lightShape = `${34 + (index * 17) % 43}% ${41 + (index * 23) % 47}% ${38 + (index * 31) % 49}% ${45 + (index * 13) % 41}% / ${39 + (index * 19) % 46}% ${46 + (index * 11) % 39}% ${35 + (index * 29) % 48}% ${43 + (index * 7) % 42}%`;
          const positive = item.change_pct > .04, negative = item.change_pct < -.04;
          return (
            <button
              key={`${market}-${item.code}`}
              ref={(el) => { if (bodiesRef.current[index]) bodiesRef.current[index].el = el; }}
              type="button"
              className="stock-bubble"
              style={{
                width: diameter,
                height: diameter,
                "--bubble-light": colors[0],
                "--bubble-dark": colors[1],
                "--bubble-size": `${diameter}px`,
                "--bubble-light-angle": `${lightAngle}deg`,
                "--bubble-rim-angle": `${rimAngle}deg`,
                "--bubble-rim-width": `${rimWidth}px`,
                "--bubble-rim-color": `rgba(255,255,255,${rimAlpha})`,
                "--sphere-highlight-x": `${highlightX}%`,
                "--sphere-highlight-y": `${highlightY}%`,
                "--sphere-caustic-x": `${causticX}%`,
                "--bubble-light-2-x": `${light2X}%`,
                "--bubble-light-2-y": `${light2Y}%`,
                "--bubble-main-light-width": `${mainLightWidth}%`,
                "--bubble-main-light-height": `${mainLightHeight}%`,
                "--bubble-main-light-angle": `${mainLightAngle}deg`,
                "--bubble-main-light-shape": lightShape,
                "--bubble-secondary-light-opacity": secondaryLightOpacity,
                "--sphere-roll-duration": `${12 + (index % 6) * 2}s`,
                "--sphere-roll-direction": index % 2 ? "reverse" : "normal",
              } as React.CSSProperties}
              onClick={(event) => {
                event.stopPropagation();
                if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
                clickTimerRef.current = window.setTimeout(() => {
                  focusRef.current = index;
                  setDiscussionIndex(index);
                  reportMarketBubbleEvent({ action: "bubble_click", market, code: item.code, name: item.name });
                  clickTimerRef.current = null;
                }, 260);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
                clickTimerRef.current = null;
                reportMarketBubbleEvent({ action: "stock_detail", market, code: item.code, name: item.name });
                navigate(market === "nasdaq" ? `/global?code=${item.code}` : `/stock/${item.code}`);
              }}
              onPointerEnter={() => {
                pinnedRef.current = index;
                const body = bodiesRef.current[index];
                if (body) { body.vx = 0; body.vy = 0; body.vz = 0; }
              }}
              onPointerLeave={() => { if (pinnedRef.current === index) pinnedRef.current = null; }}
              aria-label={`${shortName(item, market)} ${formatPrice(item, market)} ${item.change_pct.toFixed(2)}%, 더블 클릭해 종목 열기`}
            >
              <span className="stock-bubble-shell"><span className="stock-bubble-glass" /></span>
              <span className="stock-bubble-lightfield" aria-hidden="true" />
              <span className="stock-bubble-content">
                <span className="stock-bubble-rank">#{item.rank}</span>
                <span className="stock-bubble-logo-wrap">
                  {market === "nasdaq"
                    ? <img src={usCompanyLogoUrl(item.code)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                    : <BubbleCompanyLogo src={stockIconUrl(item.code)} />}
                </span>
                <strong>{shortName(item, market)}</strong>
                <b>{formatPrice(item, market)}</b>
                <em className={positive ? "is-up" : negative ? "is-down" : "is-flat"}>{item.change_pct > 0 ? "+" : ""}{item.change_pct.toFixed(2)}%</em>
              </span>
            </button>
          );
        })}
      </section>

      {discussionIndex != null && items[discussionIndex] && (
        <>
          <button className="bubble-panel-scrim" type="button" aria-label="종목토론 닫기" onClick={() => setDiscussionIndex(null)} />
          <MarketBubbleDiscussion
            item={items[discussionIndex]}
            market={market}
            colors={PALETTE[palette[discussionIndex] % PALETTE.length] as [string, string]}
            onClose={() => setDiscussionIndex(null)}
          />
        </>
      )}

      <div className="bubble-switcher" role="tablist" aria-label="시장 선택">
        {MARKETS.map((entry) => <button key={entry.key} role="tab" aria-selected={market === entry.key} className={market === entry.key ? "is-active" : ""} onClick={() => { if (market !== entry.key) reportMarketBubbleEvent({ action: "market_switch", market: entry.key }); setMarket(entry.key); }}>{entry.label}</button>)}
      </div>
      <div className="bubble-instruction"><span>CLICK</span> 종목토론 보기 · <span>DOUBLE CLICK</span> 종목 상세</div>
      {FPS_METER_ENABLED && <BubbleFpsMeter bubbles={items.length} />}
    </main>
  );
}
