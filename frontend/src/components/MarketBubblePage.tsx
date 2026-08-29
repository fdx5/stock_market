import { MutableRefObject, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { StockBoard, StockBoardItem, api } from "../api/client";
import { Link, navigate } from "../router";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoProxyUrl, usCompanyLogoUrl } from "../usLogo";
import { useDocumentTitle } from "../useDocumentTitle";
import { reportMarketBubbleEvent } from "../useActivityTracking";
import MarketBubbleIcon from "./MarketBubbleIcon";
import MarketBubbleDiscussion from "./MarketBubbleDiscussion";
import "./marketBubble.css";

type Market = "kospi" | "kosdaq" | "nasdaq";
type Body = {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number;
  marketCap: number;
  impactX: number; impactY: number; impactZ: number;
  deform: number; deformTarget: number; deformVelocity: number;
  deformAngle: number; deformAngleTarget: number;
  wobbleEnergy: number; wobblePhase: number; shockAge: number; jellyProfile: number;
  lastMatrix: string; lastOrigin: string; lastPosition: string; lastDepthPresence: string;
  screenX: number; screenY: number;
  el: HTMLButtonElement | null; shell: HTMLSpanElement | null;
};
type SparkParticle = {
  x: number; y: number; vx: number; vy: number; born: number;
  life: number; size: number; hue: number; flash?: boolean;
  seed?: number; angle?: number; aspect?: number; saturation?: number;
  arc?: boolean; screenFlash?: boolean;
};
type GestureState = { pointers: Map<number, { x: number; y: number }>; suppressUntil: number };
type CameraCommand = { nonce: number; type: "reset" };
type CollisionWave = { x: number; y: number; z: number; born: number; energy: number; color: string; visualized?: boolean };

const FPS_METER_ENABLED = (() => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("fps")) return false;
  return !["0", "off", "false", "no"].includes((params.get("fps") ?? "").trim().toLowerCase());
})();

const BUBBLE_COUNT = 20;
const WORLD_SCALE = 2;
const BUBBLE_TRAVEL_SPEED = .5;

const MARKETS: { key: Market; label: string; title: string }[] = [
  { key: "kospi", label: "코스피", title: "KOSPI 주요종목" },
  { key: "kosdaq", label: "코스닥", title: "KOSDAQ 주요종목" },
  { key: "nasdaq", label: "나스닥", title: "NASDAQ 주요종목" },
];

const transparentLogoCache = new Map<string, Promise<string>>();
const logoPaletteCache = new Map<string, Promise<[string, string]>>();

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
  const compact = mobile ? .9 : 1;
  if (index < 2) return 1.62 * compact;
  if (index < 5) return 1.36 * compact;
  if (index < 9) return 1.14 * compact;
  if (index < 15) return .98 * compact;
  return .84 * compact;
}

function logoPastelPalette(src: string, cacheKey: string) {
  const cached = logoPaletteCache.get(cacheKey);
  if (cached) return cached;
  const request = transparentBubbleLogo(src).then((resolved) => new Promise<[string, string]>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 40; canvas.height = 40;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("canvas unavailable");
        context.drawImage(image, 0, 0, 40, 40);
        const data = context.getImageData(0, 0, 40, 40).data;
        const bins = Array.from({ length: 18 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
        let neutralWeight = 0, neutral = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 70) continue;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
          if (max > 245 && min > 232) continue;
          if (chroma < 14) { const weight = data[i + 3] / 255; neutral += ((r + g + b) / 3) * weight; neutralWeight += weight; continue; }
          const color = new THREE.Color(r / 255, g / 255, b / 255);
          const hsl = { h: 0, s: 0, l: 0 }; color.getHSL(hsl);
          const bin = bins[Math.min(17, Math.floor(hsl.h * 18))];
          const weight = (data[i + 3] / 255) * (.35 + hsl.s) * (1 - Math.abs(hsl.l - .5) * .55);
          bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
        }
        const dominant = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best, bins[0]);
        const source = dominant.weight > 1
          ? new THREE.Color(dominant.r / dominant.weight / 255, dominant.g / dominant.weight / 255, dominant.b / dominant.weight / 255)
          : new THREE.Color((neutralWeight ? neutral / neutralWeight : 112) / 255);
        const hsl = { h: 0, s: 0, l: 0 }; source.getHSL(hsl);
        const saturation = dominant.weight > 1 ? Math.min(.96, Math.max(.7, hsl.s * 1.06)) : .24;
        const pastel = new THREE.Color().setHSL(hsl.h, saturation, .51);
        const shade = new THREE.Color().setHSL(hsl.h, Math.min(.98, saturation * 1.04), .27);
        resolve([`#${pastel.getHexString()}`, `#${shade.getHexString()}`]);
      } catch { resolve(["#a9bfd2", "#58748d"]); }
    };
    image.onerror = () => resolve(["#a9bfd2", "#58748d"]);
    image.src = resolved;
  }));
  logoPaletteCache.set(cacheKey, request);
  return request;
}

function formatPrice(item: StockBoardItem, market: Market) {
  return market === "nasdaq"
    ? `$${item.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${Math.round(item.close).toLocaleString("ko-KR")}원`;
}

function formatMarketCap(item: StockBoardItem, market: Market) {
  if (market === "nasdaq") {
    const value = item.market_cap;
    if (!value || value <= 0) return null;
    if (value >= 1e12) return { currency: "$", value: (value / 1e12).toFixed(value >= 10e12 ? 1 : 2), unit: "T" };
    return { currency: "$", value: (value / 1e9).toFixed(value >= 100e9 ? 0 : 1), unit: "B" };
  }
  if (!item.marcap || item.marcap <= 0) return null;
  if (item.marcap >= 1e12) return { currency: "", value: (item.marcap / 1e12).toFixed(item.marcap >= 100e12 ? 0 : 1), unit: "조 원" };
  return { currency: "", value: Math.round(item.marcap / 1e8).toLocaleString("ko-KR"), unit: "억 원" };
}

function shortName(item: StockBoardItem, market: Market) {
  const name = market === "nasdaq" ? item.name_ko || item.name : item.name;
  return name.replace(/\s+(Inc\.?|Corporation|Corp\.?|Common Stock).*$/i, "");
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

function numericMarketCap(item: StockBoardItem) {
  return Math.max(0, item.market_cap || item.marcap || 0);
}

function BubbleCollisionSparks({ particlesRef }: { particlesRef: MutableRefObject<SparkParticle[]> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const mobilePerformance = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
    let frame = 0;
    const resize = () => {
      const ratio = mobilePerformance ? 1 : Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(stage.clientWidth * ratio);
      canvas.height = Math.round(stage.clientHeight * ratio);
      canvas.style.width = `${stage.clientWidth}px`;
      canvas.style.height = `${stage.clientHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    let previous = performance.now();
    const render = (now: number) => {
      if (mobilePerformance && now - previous < 30) { frame = requestAnimationFrame(render); return; }
      const dt = Math.min(2.2, (now - previous) / 16.667);
      previous = now;
      context.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
      context.globalCompositeOperation = "lighter";
      particlesRef.current = particlesRef.current.filter((particle) => {
        const age = now - particle.born;
        if (age < 0) return true;
        if (age >= particle.life) return false;
        const progress = age / particle.life;
        const alpha = (1 - progress) ** 1.7;
        if (particle.screenFlash) {
          const wash = context.createLinearGradient(0, particle.y, stage.clientWidth, particle.y);
          wash.addColorStop(0, "rgba(75,155,255,0)");
          wash.addColorStop(.36, `hsla(${particle.hue},100%,82%,${alpha * .16})`);
          wash.addColorStop(.5, `rgba(255,255,255,${alpha * .32})`);
          wash.addColorStop(.64, `hsla(42,100%,65%,${alpha * .18})`);
          wash.addColorStop(1, "rgba(255,100,20,0)");
          context.fillStyle = wash;
          context.fillRect(0, 0, stage.clientWidth, stage.clientHeight);
        } else if (particle.arc) {
          const angle = particle.angle || 0,
            length = particle.size * (1 + progress * .45),
            seed = particle.seed || 0;
          context.save();
          context.translate(particle.x, particle.y);
          context.rotate(angle);
          context.strokeStyle = `hsla(${particle.hue},${particle.saturation ?? 70}%,91%,${alpha})`;
          context.lineWidth = Math.max(.55, 2.8 * (1 - progress));
          context.shadowColor = `hsla(${particle.hue},100%,64%,${alpha})`;
          context.shadowBlur = 14;
          context.beginPath();
          context.moveTo(-length * .5, 0);
          const segments = mobilePerformance ? 6 : 11;
          for (let segment = 1; segment <= segments; segment++) {
            const ratio = segment / segments,
              jitter = Math.sin(seed * 11.3 + segment * 9.71) * particle.size * .11 * (1 - Math.abs(ratio - .5));
            context.lineTo(-length * .5 + length * ratio, jitter);
          }
          context.stroke();
          context.restore();
        } else if (particle.flash) {
          // A metal strike is a torn, directional white core rather than a round
          // explosion. Build an irregular blade-shaped polygon along the impact axis.
          const radius = particle.size * (.34 + progress * .82),
            impactAngle = particle.angle || 0,
            aspect = particle.aspect || 2.5,
            seed = particle.seed || 0;
          context.save();
          context.translate(particle.x, particle.y);
          context.rotate(impactAngle);
          context.shadowColor = `hsla(${particle.hue},100%,72%,${alpha})`;
          context.shadowBlur = 22 * alpha;
          context.fillStyle = `hsla(${particle.hue},${particle.saturation ?? 72}%,96%,${alpha})`;
          context.beginPath();
          const points = mobilePerformance ? 10 : 18;
          for (let point = 0; point < points; point++) {
            const theta = point / points * Math.PI * 2,
              jag = .48 + ((Math.sin(seed * 17 + point * 8.73) + 1) * .5) * .72,
              blade = point % 2 ? .52 : 1,
              px = Math.cos(theta) * radius * aspect * jag * blade,
              py = Math.sin(theta) * radius * .3 * jag;
            if (point === 0) context.moveTo(px, py); else context.lineTo(px, py);
          }
          context.closePath();
          context.fill();
          // Hot blue-white contact slit and two asymmetric lens streaks.
          context.shadowBlur = 12;
          context.strokeStyle = `rgba(235,250,255,${alpha})`;
          context.lineWidth = Math.max(1, 5 * (1 - progress));
          context.beginPath(); context.moveTo(-radius * aspect * 1.35, 0); context.lineTo(radius * aspect * 1.1, 0); context.stroke();
          context.strokeStyle = `hsla(47,100%,83%,${alpha * .8})`;
          context.lineWidth = Math.max(.7, 2.4 * (1 - progress));
          context.beginPath(); context.moveTo(-radius * .58, -radius * .72); context.lineTo(radius * .84, radius * .56); context.stroke();
          context.restore();
        } else {
          const oldX = particle.x;
          const oldY = particle.y;
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vx *= .975 ** dt;
          particle.vy = particle.vy * (.975 ** dt) + .018 * dt;
          const flicker = .62 + Math.sin((particle.seed || 0) * 91 + age * .052) * .24;
          context.shadowColor = `hsla(${particle.hue},100%,58%,${alpha})`;
          context.shadowBlur = particle.size * 2.4;
          context.strokeStyle = `hsla(${particle.hue},${particle.saturation ?? 100}%,${64 + progress * 25}%,${alpha * flicker})`;
          context.lineWidth = Math.max(.7, particle.size * (1 - progress));
          context.beginPath();
          context.moveTo(oldX, oldY);
          context.lineTo(particle.x, particle.y);
          context.stroke();
        }
        return true;
      });
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [particlesRef]);
  return <canvas ref={canvasRef} className="bubble-spark-layer" aria-hidden="true" />;
}

function BubbleWebGLSurface({ bodiesRef, bubbleColors, count, focusRef, cameraCommandRef, collisionWavesRef }: {
  bodiesRef: MutableRefObject<Body[]>; bubbleColors: [string, string][]; count: number; focusRef: MutableRefObject<number | null>; cameraCommandRef: MutableRefObject<CameraCommand>; collisionWavesRef: MutableRefObject<CollisionWave[]>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current, stage = canvas?.parentElement;
    if (!canvas || !stage || count === 0) return;
    const mobilePerformance = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobilePerformance ? 1 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .96;
    const scene = new THREE.Scene();
    // Atmospheric falloff and a receding floor give the eye stable distance cues.
    // Without them, differently-sized spheres can still read as flat circles because
    // the transparent background offers no reference plane for their z positions.
    scene.fog = new THREE.FogExp2(0x06101d, mobilePerformance ? .00034 : .00027);
    // Keep the camera well outside even the largest rank-scaled sphere.
    // A close camera clips the front cap of large spheres and makes them look
    // like white-centred rings because the transparent page shows through.
    const cameraDistance = 1200;
    // Start far enough back that the complete 5 x 4 field is visible on desktop.
    // `cameraDistance` remains the projection-plane distance used by resize() and
    // the DOM-overlay scale calculation below; only the camera's initial/reset
    // position is pulled back.
    const initialCameraDistance = 1750;
    const camera = new THREE.PerspectiveCamera(42, 1, 20, 4600);
    camera.position.set(0, mobilePerformance ? 72 : 145, initialCameraDistance);
    // OrbitControls listens on the whole stage and normally captures the pointer
    // on pointerdown. When the target is a moving HTML bubble that capture changes
    // the eventual click target to the stage, so the discussion panel never opens.
    // This listener is deliberately registered before OrbitControls' own listener.
    let controls: OrbitControls;
    const preserveBubbleClick = (event: globalThis.PointerEvent) => {
      const target = event.target;
      // Buttons and links layered over the stage must retain their native click.
      // Otherwise OrbitControls captures their pointer before React receives it.
      controls.enabled = !(target instanceof Element && target.closest("button, a"));
    };
    const restoreCameraControls = () => { controls.enabled = true; };
    stage.addEventListener("pointerdown", preserveBubbleClick);
    stage.addEventListener("pointerup", restoreCameraControls);
    stage.addEventListener("pointercancel", restoreCameraControls);
    controls = new OrbitControls(camera, stage);
    controls.enableDamping = true;
    controls.dampingFactor = .065;
    controls.enablePan = true;
    controls.panSpeed = .55;
    controls.rotateSpeed = .48;
    controls.zoomSpeed = .72;
    controls.minDistance = 520;
    controls.maxDistance = 2900;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controls.saveState();
    controls.target.set(0, -35, 0);
    controls.update();
    const releaseFocus = () => { focusRef.current = null; };
    controls.addEventListener("start", releaseFocus);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    scene.environment = environment;
    scene.add(new THREE.HemisphereLight(0xeef6ff, 0x10182a, .82));
    const key = new THREE.DirectionalLight(0xfff4dc, 1.55); key.position.set(-4, 6, 9); scene.add(key);
    const fill = new THREE.DirectionalLight(0x90bfff, .52); fill.position.set(6, 1, 6); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xa9dfff, .62); rim.position.set(-5, -4, 3); scene.add(rim);
    const floorGrid = new THREE.GridHelper(3600, mobilePerformance ? 22 : 36, 0x4ca7d8, 0x173d5b);
    const floorMaterials = Array.isArray(floorGrid.material) ? floorGrid.material : [floorGrid.material];
    floorMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = mobilePerformance ? .11 : .16;
      material.depthWrite = false;
      material.fog = true;
    });
    floorGrid.position.set(0, -690, -280);
    floorGrid.scale.z = 1.35;
    scene.add(floorGrid);
    const dustGeometry = new THREE.BufferGeometry();
    const dustPositions = new Float32Array((mobilePerformance ? 64 : 210) * 3);
    for (let i = 0; i < dustPositions.length; i += 3) {
      dustPositions[i] = (Math.random() - .5) * 2500;
      dustPositions[i + 1] = (Math.random() - .5) * 1500;
      dustPositions[i + 2] = (Math.random() - .5) * 2600;
    }
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    const dustMaterial = new THREE.PointsMaterial({ color: 0x8ccfff, size: mobilePerformance ? 2.4 : 3.1, transparent: true, opacity: .28, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const dust = new THREE.Points(dustGeometry, dustMaterial); scene.add(dust);
    // Extra radial segments keep the frozen organic profile round even on the
    // smallest bubbles.  The previous low-poly silhouette exposed corners.
    const geometry = new THREE.SphereGeometry(1, mobilePerformance ? 24 : 56, mobilePerformance ? 18 : 40);
    const meshes: THREE.Mesh[] = [], shadows: THREE.Sprite[] = [], shadowTextures: THREE.CanvasTexture[] = [], shaders: any[] = [];
    const trails: THREE.Line[] = [], trailHistories: THREE.Vector3[][] = [];
    for (let i = 0; i < count; i++) {
      const colors = bubbleColors[i] ?? ["#a9bfd2", "#58748d"];
      const logoColor = new THREE.Color(colors[0]);
      const accents = [logoColor.clone().lerp(new THREE.Color(0xffffff), .52), logoColor.clone().lerp(new THREE.Color(colors[1]), .24)];
      const baseColor = new THREE.Color(colors[0]).lerp(new THREE.Color(colors[1]), .41);
      const lightVariation = ((i * 37) % 11) / 10;
      const material = new THREE.MeshPhysicalMaterial({
        color: baseColor,
        roughness: .39 + (i % 4) * .025,
        metalness: 0,
        clearcoat: mobilePerformance ? .18 : .34,
        clearcoatRoughness: .34 + (i % 3) * .025,
        envMapIntensity: .72 + lightVariation * .18,
        sheen: mobilePerformance ? 0 : .18 + lightVariation * .1,
        sheenColor: new THREE.Color(colors[0]).lerp(new THREE.Color(i % 2 ? 0xd9e9ff : 0xffead6), .26 + lightVariation * .2),
        sheenRoughness: .42,
        specularIntensity: .58,
        specularColor: new THREE.Color(colors[0]).lerp(new THREE.Color(0xffffff), .72),
        iridescence: mobilePerformance ? 0 : .22 + (i % 3) * .035,
        iridescenceIOR: 1.38,
        iridescenceThicknessRange: [110, 320],
        ior: 1.46,
        thickness: 1.25,
        transmission: 0,
        attenuationColor: new THREE.Color(colors[0]).lerp(new THREE.Color(colors[1]), .18),
        attenuationDistance: 1.7 + (i % 4) * .22,
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
        .04 + Math.random() * .035,
        (Math.random() - .5) * .095,
        (Math.random() - .5) * .08,
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
        shader.uniforms.uAccentA = { value: accents[0] };
        shader.uniforms.uAccentB = { value: accents[1] };
        const baseCoverage = [.74, .58, .82, .48, .68][i % 5];
        shader.uniforms.uAccentStrength = { value: new THREE.Vector2((1 - baseCoverage) * .82, i % 3 === 0 ? 0 : (1 - baseCoverage) * .54) };
        shader.uniforms.uAccentSpread = { value: new THREE.Vector2(1.45 + (i * 7 % 23) * .09, 1.7 + (i * 11 % 19) * .11) };
        shader.uniforms.uAccentDirA = { value: new THREE.Vector3(-.72 + (i * 17 % 31) / 50, .28 + (i * 13 % 29) / 60, .68).normalize() };
        shader.uniforms.uAccentDirB = { value: new THREE.Vector3(.42 + (i * 19 % 27) / 52, -.55 + (i * 7 % 25) / 55, .7).normalize() };
        shader.uniforms.uDeform = { value: 0 }; shader.uniforms.uWobble = { value: 0 }; shader.uniforms.uPhase = { value: 0 };
        shader.uniforms.uShockAge = { value: 2 }; shader.uniforms.uMaterialWeight = { value: 0 };
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform vec3 uImpact; uniform vec4 uOrganic; uniform vec3 uMochiDetail; uniform float uDeform; uniform float uWobble; uniform float uPhase; uniform float uShockAge; uniform float uMaterialWeight; varying vec3 vBubbleNormal; varying float vImpactFacing;").replace("#include <begin_vertex>", `vec3 transformed=vec3(position); vec3 n=normalize(objectNormal); vBubbleNormal=n; float azimuth=atan(n.y,n.x); float latitude=asin(clamp(n.z,-1.0,1.0)); float micro=sin(azimuth*11.0+uOrganic.x*3.1)*sin(latitude*9.0-uOrganic.x)*.004; float mochi=sin(azimuth*uMochiDetail.x+uOrganic.x)*.62+sin((azimuth+latitude)*uMochiDetail.y+uMochiDetail.z)*.38; transformed*=vec3(1.0+uOrganic.z,1.0+uOrganic.w,1.0-(uOrganic.z+uOrganic.w)*.22); transformed+=n*(mochi*uOrganic.y+micro); vec3 hit=normalize(uImpact); float facing=clamp(dot(n,hit),-1.0,1.0); vBubbleNormal=n; vImpactFacing=facing; float contact=pow(smoothstep(.05,1.0,facing),3.1); float shoulder=pow(max(0.0,1.0-abs(facing-.08)),1.35); float compression=clamp(uDeform,-.09,.35); float rebound=sin(uPhase)*uWobble; float axialDot=dot(transformed,hit); vec3 axialPart=hit*axialDot; vec3 tangentPart=transformed-axialPart; float volumeBulge=max(compression,0.0)*(.16-uMaterialWeight*.035); float wholeBodyRipple=rebound*(.3-uMaterialWeight*.07); transformed=axialPart*(1.0-compression-wholeBodyRipple)+tangentPart*(1.0+volumeBulge+wholeBodyRipple*.48); float axial=max(0.0,dot(transformed,hit)); float shockRadius=uShockAge*1.55; float surfaceDistance=acos(clamp(facing,-1.0,1.0)); float shock=exp(-pow((surfaceDistance-shockRadius)/.105,2.0))*(1.0-smoothstep(.0,1.7,uShockAge))*uWobble; transformed-=hit*axial*contact*max(compression,0.0)*(.24-uMaterialWeight*.05); transformed+=n*(-contact*max(compression,0.0)*.16+shoulder*max(compression,0.0)*.12); transformed+=n*(contact*rebound*(.22-uMaterialWeight*.07)-shoulder*rebound*.08+shock*(.38-uMaterialWeight*.11));`);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uAccentA; uniform vec3 uAccentB; uniform vec2 uAccentStrength; uniform vec2 uAccentSpread; uniform vec3 uAccentDirA; uniform vec3 uAccentDirB; uniform float uDeform; uniform float uShockAge; uniform float uMaterialWeight; varying vec3 vBubbleNormal; varying float vImpactFacing;")
          .replace("#include <color_fragment>", `#include <color_fragment>\nvec3 bubbleN=normalize(vBubbleNormal); float accentA=pow(max(dot(bubbleN,uAccentDirA),0.0),uAccentSpread.x); float accentB=pow(max(dot(bubbleN,uAccentDirB),0.0),uAccentSpread.y); diffuseColor.rgb=mix(diffuseColor.rgb,uAccentA,accentA*uAccentStrength.x); diffuseColor.rgb=mix(diffuseColor.rgb,uAccentB,accentB*uAccentStrength.y); float dome=max(bubbleN.z,0.0); float opticalRim=pow(1.0-dome,2.8); float microGrain=(sin(bubbleN.x*83.0)+sin(bubbleN.y*107.0)+sin(bubbleN.z*71.0))*.008; float surfaceDistance=acos(clamp(vImpactFacing,-1.0,1.0)); float shockRadius=uShockAge*1.55; float shockRing=exp(-pow((surfaceDistance-shockRadius)/.075,2.0))*(1.0-smoothstep(.0,1.65,uShockAge)); float contactGlow=pow(max(vImpactFacing,0.0),16.0)*smoothstep(.015,.12,uDeform); vec3 rimTint=mix(vec3(.45,.82,1.0),vec3(1.0,.65,.24),contactGlow); diffuseColor.rgb*=.94+dome*.08+microGrain; diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0),opticalRim*(.13+uMaterialWeight*.1)); diffuseColor.rgb+=rimTint*(shockRing*.38+contactGlow*.82);`);
        shaders[i] = shader;
      };
      const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh); meshes.push(mesh); shaders.push(null);
      const trailGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 12 }, () => new THREE.Vector3()));
      const trailMaterial = new THREE.LineBasicMaterial({ color: colors[0], transparent: true, opacity: mobilePerformance ? .1 : .2, depthWrite: false, blending: THREE.AdditiveBlending });
      const trail = new THREE.Line(trailGeometry, trailMaterial); trail.frustumCulled = false; trail.renderOrder = -2; scene.add(trail); trails.push(trail); trailHistories.push([]);

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
    const activeWaves: { mesh: THREE.Mesh; born: number; energy: number }[] = [];
    let raf=0, previousRender=0, trailFrame=0;
    const projected = new THREE.Vector3();
    let handledCommand = cameraCommandRef.current.nonce;
    const render = () => {
      const renderNow = performance.now();
      if (mobilePerformance && renderNow - previousRender < 30) { raf=requestAnimationFrame(render); return; }
      previousRender = renderNow;
      const bodies = bodiesRef.current, w = stage.clientWidth, h = stage.clientHeight;
      if (cameraCommandRef.current.nonce !== handledCommand) {
        handledCommand = cameraCommandRef.current.nonce;
        focusRef.current = null;
        controls.target.set(0, -35, 0);
        camera.position.set(0, mobilePerformance ? 72 : 145, initialCameraDistance);
        camera.up.set(0, 1, 0);
        controls.update();
      }
      const focused = focusRef.current == null ? null : meshes[focusRef.current];
      if (focused) {
        controls.target.lerp(focused.position, .055);
        const desired = focused.position.clone().add(new THREE.Vector3(0, Math.max(55, focused.scale.y * .55), Math.max(570, focused.scale.x * 5.4)));
        camera.position.lerp(desired, .04);
      }
      controls.update();
      dust.rotation.y += .000035;
      dust.position.x = camera.position.x * .035;
      dust.position.y = camera.position.y * .025;
      trailFrame += 1;
      meshes.forEach((mesh, i) => {
        const body = bodies[i], shadow = shadows[i];
        mesh.visible = Boolean(body); shadow.visible = Boolean(body);
        if (!body) return;
        mesh.position.set(body.x - w / 2, h / 2 - body.y, body.z);
        mesh.scale.setScalar(body.r);
        mesh.rotation.x += body.vy * .00018; mesh.rotation.y += body.vx * .00022;
        if (trailFrame % (mobilePerformance ? 4 : 2) === 0) {
          const history = trailHistories[i];
          history.unshift(mesh.position.clone());
          if (history.length > 12) history.pop();
          const positions = trails[i].geometry.getAttribute("position") as THREE.BufferAttribute;
          for (let point = 0; point < 12; point++) {
            const sample = history[Math.min(point, history.length - 1)] ?? mesh.position;
            positions.setXYZ(point, sample.x, sample.y, sample.z);
          }
          positions.needsUpdate = true;
        }
        const shadowAngle = ((i * 53) % 360) * Math.PI / 180,
          shadowOffset = body.r * (.055 + (i % 4) * .014);
        shadow.position.set(body.x - w / 2 + Math.cos(shadowAngle) * shadowOffset, h / 2 - body.y + Math.sin(shadowAngle) * shadowOffset, body.z - body.r * .72);
        shadow.scale.set(body.r * (2.05 + (i % 3) * .08), body.r * (1.66 + (i % 4) * .06), 1);
        const shader = shaders[i];
        if (shader) {
          shader.uniforms.uImpact.value.set(body.impactX, -body.impactY, body.impactZ).normalize();
          shader.uniforms.uDeform.value = body.deform;
          shader.uniforms.uWobble.value = body.wobbleEnergy;
          shader.uniforms.uPhase.value = body.wobblePhase;
          shader.uniforms.uShockAge.value = body.shockAge;
          shader.uniforms.uMaterialWeight.value = Math.sqrt(body.marketCap / Math.max(1, bodies[0]?.marketCap || body.marketCap));
        }
        if (body.el) {
          projected.copy(mesh.position).project(camera);
          const px = (projected.x * .5 + .5) * w,
            py = (-projected.y * .5 + .5) * h,
            distance = camera.position.distanceTo(mesh.position),
            scale = Math.max(.52, Math.min(1.75, cameraDistance / distance)),
            position = `translate3d(${(px - body.r).toFixed(1)}px,${(py - body.r).toFixed(1)}px,0) scale(${scale.toFixed(4)})`;
          body.screenX = px; body.screenY = py;
          if (position !== body.lastPosition) { body.el.style.transform = position; body.lastPosition = position; }
          body.el.style.zIndex = `${10 + Math.round((1 - projected.z) * 500)}`;
          body.el.style.setProperty("--info-compensation", `${Math.min(1.32, Math.max(1, 1 / scale)).toFixed(3)}`);
          const depthPresence = THREE.MathUtils.clamp(.58 + scale * .34, .62, 1).toFixed(2);
          if (depthPresence !== body.lastDepthPresence) {
            body.el.style.setProperty("--depth-presence", depthPresence);
            body.lastDepthPresence = depthPresence;
          }
          body.el.style.visibility = projected.z > 1 || projected.z < -1 ? "hidden" : "visible";
        }
      });
      collisionWavesRef.current.forEach((wave) => {
        if (wave.visualized) return;
        wave.visualized = true;
        const waveGeometry = new THREE.RingGeometry(.72, 1, mobilePerformance ? 28 : 52);
        const waveMaterial = new THREE.MeshBasicMaterial({ color: wave.color, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending });
        const waveMesh = new THREE.Mesh(waveGeometry, waveMaterial);
        waveMesh.position.set(wave.x, wave.y, wave.z); waveMesh.lookAt(camera.position); scene.add(waveMesh);
        activeWaves.push({ mesh: waveMesh, born: wave.born, energy: wave.energy });
      });
      for (let index = activeWaves.length - 1; index >= 0; index--) {
        const wave = activeWaves[index], age = renderNow - wave.born, progress = age / 720;
        if (progress >= 1) {
          scene.remove(wave.mesh); wave.mesh.geometry.dispose(); (wave.mesh.material as THREE.Material).dispose(); activeWaves.splice(index, 1); continue;
        }
        const radius = (12 + wave.energy * 20) * (.45 + progress * 3.2);
        wave.mesh.scale.setScalar(radius); wave.mesh.lookAt(camera.position);
        (wave.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) ** 1.7 * .78;
      }
      collisionWavesRef.current = collisionWavesRef.current.filter((wave) => renderNow - wave.born < 1000);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    raf=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(raf);observer.disconnect();stage.removeEventListener("pointerdown",preserveBubbleClick);stage.removeEventListener("pointerup",restoreCameraControls);stage.removeEventListener("pointercancel",restoreCameraControls);controls.removeEventListener("start",releaseFocus);controls.dispose();stage.classList.remove("is-webgl");meshes.forEach(m=>(m.material as THREE.Material).dispose());shadows.forEach(s=>(s.material as THREE.Material).dispose());shadowTextures.forEach(t=>t.dispose());trails.forEach(t=>{t.geometry.dispose();(t.material as THREE.Material).dispose();});activeWaves.forEach(w=>{w.mesh.geometry.dispose();(w.mesh.material as THREE.Material).dispose();});floorGrid.geometry.dispose();floorMaterials.forEach(material=>material.dispose());dustGeometry.dispose();dustMaterial.dispose();geometry.dispose();environment.dispose();pmrem.dispose();renderer.dispose();};
  }, [bodiesRef, bubbleColors, cameraCommandRef, collisionWavesRef, count, focusRef]);
  return <canvas ref={canvasRef} className="bubble-webgl-surface" aria-hidden="true" />;
}

export default function MarketBubblePage() {
  const [market, setMarket] = useState<Market>(() => {
    const requested = new URLSearchParams(window.location.search).get("market")?.toLowerCase();
    return requested === "kosdaq" || requested === "nasdaq" || requested === "kospi" ? requested : "kospi";
  });
  const [board, setBoard] = useState<StockBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [bubbleColors, setBubbleColors] = useState<[string, string][]>([]);
  const [discussionIndex, setDiscussionIndex] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bodiesRef = useRef<Body[]>([]);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const pointerRef = useRef({ x: -9999, y: -9999, active: false });
  const pinnedRef = useRef<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const cameraCommandRef = useRef<CameraCommand>({ nonce: 0, type: "reset" });
  const sparkParticlesRef = useRef<SparkParticle[]>([]);
  const pairSparkedAtRef = useRef<Record<string, number>>({});
  const collisionWavesRef = useRef<CollisionWave[]>([]);
  const gestureRef = useRef<GestureState>({ pointers: new Map(), suppressUntil: 0 });
  const clickTimerRef = useRef<number | null>(null);
  const firstLoadRef = useRef(true);
  useDocumentTitle("증시버블 · K-Stock Hub");

  const items = useMemo(() => board?.items.slice().sort((a, b) => a.rank - b.rank).slice(0, BUBBLE_COUNT) ?? [], [board]);
  const marketPulse = useMemo(() => {
    const rising = items.filter((item) => item.change_pct > .04).length;
    const falling = items.filter((item) => item.change_pct < -.04).length;
    const flat = Math.max(0, items.length - rising - falling);
    const average = items.length
      ? items.reduce((sum, item) => sum + item.change_pct, 0) / items.length
      : 0;
    const movers = [...items]
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
      .slice(0, 3);
    return { rising, falling, flat, average, movers };
  }, [items]);

  useEffect(() => {
    let alive = true;
    if (!items.length) { setBubbleColors([]); return () => { alive = false; }; }
    Promise.all(items.map((item) => {
      const logo = market === "nasdaq" ? usCompanyLogoProxyUrl(item.code) : stockIconUrl(item.code);
      return logoPastelPalette(logo, `${market}:${item.code}`);
    })).then((colors) => { if (alive) setBubbleColors(colors); });
    return () => { alive = false; };
  }, [market, items.map((item) => item.code).join(",")]);

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
    const getBaseRadius = (width: number, height: number) => Math.max(25, Math.min(
      72,
      width / 13,
      height / 10.5,
      Math.sqrt((width * height) / BUBBLE_COUNT) * .36,
    ));
    const base = getBaseRadius(rect.width, rect.height);
    const rows = Math.ceil(items.length / 5);
    const nextBodies: Body[] = items.map((item, i) => {
      const col = i % 5, row = Math.floor(i / 5);
      const r = base * rankRadiusScale(i, rect.width <= 760);
      return {
        x: rect.width * .5 + ((((col + .65 + (row % 2) * .16) / 5.35) * rect.width) - rect.width * .5) * 1.55,
        y: rect.height * .5 + ((((row + .7) / (rows + .45)) * rect.height) - rect.height * .5) * 1.55,
        vx: (Math.random() - .5) * .44,
        vy: (Math.random() - .5) * .44,
        // A broad, deterministic front/back spread makes perspective apparent on
        // first paint instead of requiring the viewer to orbit the camera to notice it.
        z: (-470 + (i * 173) % 980) * WORLD_SCALE,
        vz: (Math.random() - .5) * .52,
        r,
        marketCap: numericMarketCap(item),
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
        shockAge: 2,
        jellyProfile: i % 4,
        lastMatrix: "",
        lastOrigin: "",
        lastPosition: "",
        lastDepthPresence: "",
        screenX: rect.width * .5,
        screenY: rect.height * .5,
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
        const halfWorldWidth = nextRect.width * WORLD_SCALE * .5;
        const halfWorldHeight = nextRect.height * WORLD_SCALE * .5;
        body.x = Math.max(nextRect.width*.5-halfWorldWidth+nextRadius, Math.min(nextRect.width*.5+halfWorldWidth-nextRadius, body.x));
        body.y = Math.max(nextRect.height*.5-halfWorldHeight+nextRadius, Math.min(nextRect.height*.5+halfWorldHeight-nextRadius, body.y));
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
    const mobilePerformance = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
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
          body.wobbleEnergy = Math.max(body.wobbleEnergy, Math.min(.135, amount * .37));
          body.wobblePhase = 0;
          body.shockAge = 0;
          // Let impact direction and strength select the material response, so
          // repeated contacts do not replay one recognisable deformation loop.
          body.jellyProfile = Math.abs(Math.floor(angle / 37) + Math.floor(amount * 113)) % 4;
        }
        const jellyCompression = THREE.MathUtils.clamp(amount, .1, .35);
        body.deformTarget = Math.max(body.deformTarget, jellyCompression);
        body.deformVelocity += Math.max(.013, jellyCompression * .085);
      };
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        const largestCap = Math.max(1, bodies[0]?.marketCap || a.marketCap || 1);
        const materialWeight = Math.sqrt(Math.max(0, a.marketCap) / largestCap);
        // Underdamped spring: the whole mass compresses, overshoots slightly and
        // settles in two or three soft oscillations instead of easing linearly.
        a.deformTarget *= Math.pow(.915, dt);
        // One short, strongly damped elastic recoil after impact. Sustained
        // contact cannot restart it, which avoids the old resting jitter.
        a.wobbleEnergy *= Math.pow(.9, dt);
        if (a.wobbleEnergy > .0007) a.wobblePhase += (.19 - materialWeight * .055) * dt;
        else a.wobbleEnergy = 0;
        a.shockAge = Math.min(2, a.shockAge + (.022 + materialWeight * .006) * dt);
        const springStrength = .072 - materialWeight * .01;
        const springDamping = .82 + materialWeight * .035;
        a.deformVelocity += (a.deformTarget - a.deform) * springStrength * dt;
        a.deformVelocity *= Math.pow(springDamping, dt);
        a.deform += a.deformVelocity * dt;
        const angleDifference = ((a.deformAngleTarget - a.deformAngle + 180) % 360 + 360) % 360 - 180;
        a.deformAngle += angleDifference * Math.min(1, .075 * dt);
        if (a.deformTarget < .0003 && Math.abs(a.deform) < .0003 && Math.abs(a.deformVelocity) < .0003) {
          a.deform = 0;
          a.deformVelocity = 0;
        }
        a.deform = Math.max(-.09, Math.min(.35, a.deform));
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
        a.vx *= .988; a.vy *= .988; a.vz *= .988;
        const speed = Math.hypot(a.vx, a.vy, a.vz);
        // Leave enough headroom for a small-cap bubble's high-speed recoil. Drag
        // still settles it quickly, while ordinary ambient motion stays unchanged.
        if (speed > 4.2) { const limit = 4.2 / speed; a.vx *= limit; a.vy *= limit; a.vz *= limit; }
        a.x += a.vx * dt * 4.5 * BUBBLE_TRAVEL_SPEED;
        a.y += a.vy * dt * 4.5 * BUBBLE_TRAVEL_SPEED;
        a.z += a.vz * dt * 4.5 * BUBBLE_TRAVEL_SPEED;
        const depthScale = Math.max(.55, (1200 - a.z) / 1200);
        const halfViewWidth = width * depthScale * .5 * WORLD_SCALE;
        const halfViewHeight = height * depthScale * .5 * WORLD_SCALE;
        const minX = width * .5 - halfViewWidth + a.r, maxX = width * .5 + halfViewWidth - a.r;
        const minY = height * .5 - halfViewHeight + a.r, maxY = height * .5 + halfViewHeight - a.r;
        if (a.x < minX) { const speed = Math.abs(a.vx); a.x = minX; a.vx = speed * .78; a.impactX=-1;a.impactY=0;a.impactZ=0;excite(a, Math.min(.36, .09+speed*.05), 180); }
        if (a.x > maxX) { const speed = Math.abs(a.vx); a.x = maxX; a.vx = -speed * .78; a.impactX=1;a.impactY=0;a.impactZ=0;excite(a, Math.min(.36, .09+speed*.05), 0); }
        if (a.y < minY) { const speed = Math.abs(a.vy); a.y = minY; a.vy = speed * .78; a.impactX=0;a.impactY=-1;a.impactZ=0;excite(a, Math.min(.36, .09+speed*.05), -90); }
        if (a.y > maxY) { const speed = Math.abs(a.vy); a.y = maxY; a.vy = -speed * .78; a.impactX=0;a.impactY=1;a.impactZ=0;excite(a, Math.min(.36, .09+speed*.05), 90); }
        const zLimit = (width <= 760 ? 280 : 360) * WORLD_SCALE;
        if (a.z < -zLimit) { const speed=Math.abs(a.vz);a.z=-zLimit;a.vz=speed*.8;a.impactX=0;a.impactY=0;a.impactZ=-1;excite(a,Math.min(.34,.08+speed*.05),0); }
        if (a.z > zLimit) { const speed=Math.abs(a.vz);a.z=zLimit;a.vz=-speed*.8;a.impactX=0;a.impactY=0;a.impactZ=1;excite(a,Math.min(.34,.08+speed*.05),0); }
      }
      // Market-cap neighbours perform a repeating approach / impact / separation
      // cycle: 1↔2, 3↔4 and so on. A moving target distance keeps the motion organic
      // while the existing soft-body collision solver still owns the actual impact.
      // Periodically remix partners so the choreography is not locked to
      // (1,2), (3,4) and the same stocks do not repeatedly meet.
      const pairingCycle = Math.floor(now / 9200);
      const collisionOrder = bodies.map((_, index) => index).sort((left, right) => {
        const hash = (index: number) => Math.sin((index + 1) * 91.73 + pairingCycle * 47.11) * 43758.5453 % 1;
        return hash(left) - hash(right);
      });
      for (let pair = 0; pair * 2 + 1 < collisionOrder.length; pair++) {
        const aIndex = collisionOrder[pair * 2], bIndex = collisionOrder[pair * 2 + 1];
        const a = bodies[aIndex], b = bodies[bIndex];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const distance = Math.hypot(dx, dy, dz) || 1;
        const nx = dx / distance, ny = dy / distance, nz = dz / distance;
        const phase = (Math.sin(now * .00092 + pair * .42) + 1) * .5;
        const radiusSum = a.r + b.r;
        const targetDistance = radiusSum * (.76 + (1 - phase) * 2.15);
        const force = Math.max(-.09, Math.min(.09, (distance - targetDistance) / Math.max(80, radiusSum) * .038)) * dt;
        // A small 3D corkscrew component makes the approach visibly pass through
        // depth instead of tracing a straight line on the screen plane.
        const orbitDirection = pair % 2 ? 1 : -1;
        const tx = ny * orbitDirection, ty = (-nx + nz * .45) * orbitDirection, tz = (-ny * .55 + nx * .35) * orbitDirection;
        const orbitForce = Math.sin(Math.PI * phase) * .018 * dt;
        if (pinnedRef.current !== aIndex) {
          a.vx += nx * force + tx * orbitForce; a.vy += ny * force + ty * orbitForce; a.vz += nz * force + tz * orbitForce;
        }
        if (pinnedRef.current !== bIndex) {
          b.vx -= nx * force + tx * orbitForce; b.vy -= ny * force + ty * orbitForce; b.vz -= nz * force + tz * orbitForce;
        }
      }
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z;
        const distance = Math.hypot(dx,dy,dz) || 1;
        const radiusSum=a.r+b.r;
        const contactDistance=radiusSum*.985;
        if (distance >= contactDistance) continue;
        const nx=dx/distance, ny=dy/distance, nz=dz/distance;
        const overlap=contactDistance-distance;
        // Let the shells visibly overlap like soft gum. Only the deeper core
        // receives positional correction; the outer volume is spring-driven.
        const coreDistance=radiusSum*.86;
        const penetration=Math.max(0,coreDistance-distance);
        const aMovable=pinnedRef.current!==i, bMovable=pinnedRef.current!==j;
        const capFloor=Math.max(1,Math.min(a.marketCap||1,b.marketCap||1));
        const aMass=Math.sqrt(Math.max(capFloor,a.marketCap||capFloor)/capFloor);
        const bMass=Math.sqrt(Math.max(capFloor,b.marketCap||capFloor)/capFloor);
        const inverseMassA=aMovable?1/aMass:0, inverseMassB=bMovable?1/bMass:0;
        const inverseMassTotal=Math.max(.0001,inverseMassA+inverseMassB);
        const aShare=inverseMassA/inverseMassTotal, bShare=inverseMassB/inverseMassTotal;
        a.x-=nx*penetration*aShare*.42;a.y-=ny*penetration*aShare*.42;a.z-=nz*penetration*aShare*.42;
        b.x+=nx*penetration*bShare*.42;b.y+=ny*penetration*bShare*.42;b.z+=nz*penetration*bShare*.42;
        const relativeNormal=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny+(b.vz-a.vz)*nz;
        const impactSpeed=Math.max(0,-relativeNormal);
        if(relativeNormal<-.08){
          const capRatio=Math.min(a.marketCap||capFloor,b.marketCap||capFloor)/Math.max(a.marketCap||capFloor,b.marketCap||capFloor);
          const imbalance=1-Math.sqrt(capRatio);
          // Similar caps absorb the encounter; a severe mismatch converts much
          // more of the impact into recoil on the smaller-cap bubble.
          const restitution=.18+imbalance*.78;
          const impulse=-(1+restitution)*relativeNormal/inverseMassTotal;
          if(aMovable){a.vx-=nx*impulse*inverseMassA;a.vy-=ny*impulse*inverseMassA;a.vz-=nz*impulse*inverseMassA;}
          if(bMovable){b.vx+=nx*impulse*inverseMassB;b.vy+=ny*impulse*inverseMassB;b.vz+=nz*impulse*inverseMassB;}
        }
        const elasticPush=Math.min(.085,(overlap/contactDistance)*.24)*dt;
        if(aMovable){a.vx-=nx*elasticPush*aShare;a.vy-=ny*elasticPush*aShare;a.vz-=nz*elasticPush*aShare;}
        if(bMovable){b.vx+=nx*elasticPush*bShare;b.vy+=ny*elasticPush*bShare;b.vz+=nz*elasticPush*bShare;}
        const softness=Math.min(.35,Math.max(.1,.1+overlap/Math.max(24,Math.min(a.r,b.r))*.42+impactSpeed*.055));
        a.impactX=nx;a.impactY=ny;a.impactZ=nz;
        b.impactX=-nx;b.impactY=-ny;b.impactZ=-nz;
        const angle=Math.atan2(ny,nx)*180/Math.PI;
        excite(a,softness,angle);excite(b,softness,angle+180);
        const pairKey = `${i}:${j}`;
        if (now - (pairSparkedAtRef.current[pairKey] || 0) > 1050) {
          pairSparkedAtRef.current[pairKey] = now;
          const largestCaps = bodies.map((body) => body.marketCap).sort((left, right) => right - left),
            maximumCapSum = Math.max(1, (largestCaps[0] || 0) + (largestCaps[1] || 0)),
            capSumRatio = THREE.MathUtils.clamp((a.marketCap + b.marketCap) / maximumCapSum, 0, 1),
            // Combined market cap controls every dimension of the effect. The
            // maximum collision reaches 2x the previous hero scale.
            sparkScale = .22 + 1.78 * Math.pow(capSumRatio, .68),
            isMaximumCollision = capSumRatio > .995;
          const contactRatio = a.r / Math.max(1, a.r + b.r),
            x = a.screenX + (b.screenX - a.screenX) * contactRatio,
            y = a.screenY + (b.screenY - a.screenY) * contactRatio,
            // Radius is already derived from market-cap rank, so it is the visual
            // energy source: top pairs throw a huge shower; tail pairs stay precise.
            energy = THREE.MathUtils.clamp(Math.sqrt((a.r + b.r) / 105), .55, 1.85) * sparkScale,
            burstCase = Math.floor(Math.random() * 5),
            count = Math.round((16 + energy * 42) * (isMaximumCollision ? 1.35 : 1) * (mobilePerformance ? .46 : 1)),
            impactAngle = Math.atan2(b.screenY - a.screenY, b.screenX - a.screenX),
            seed = Math.random() * 1000,
            palettes = [
              [198, 48, 30, 10], // blue-white steel / gold / orange / ember
              [52, 38, 20, 4],   // welding gold / amber / copper / red
              [188, 212, 44, 16],// electric cyan / blue / yellow / hot orange
              [285, 205, 52, 25],// ion violet / ice blue / white gold / copper
              [120, 184, 46, 8], // exotic green-white / cyan / gold / red
            ][burstCase];
          collisionWavesRef.current.push({
            x: a.x - width / 2 + dx * contactRatio,
            y: height / 2 - (a.y + dy * contactRatio),
            z: a.z + dz * contactRatio,
            born: now,
            energy,
            color: burstCase % 2 ? "#ffd27a" : "#8adfff",
          });
          sparkParticlesRef.current.push(
            { x, y, vx: 0, vy: 0, born: now, life: 150 + energy * 65, size: 15 + energy * 18, hue: palettes[0], saturation: 58, flash: true, seed, angle: impactAngle + Math.PI / 2, aspect: 2.8 + energy * .7 },
            { x, y, vx: 0, vy: 0, born: now, life: 230 + energy * 80, size: 12 + energy * 15, hue: palettes[1], saturation: 100, flash: true, seed: seed + 9, angle: impactAngle - .22, aspect: 2.1 + energy * .5 },
          );
          if (isMaximumCollision) {
            // The market leaders get a unique third arc: a razor-thin blue-white
            // electrical tear crossing the two material flashes.
            sparkParticlesRef.current.push(
              { x, y, vx: 0, vy: 0, born: now, life: 340, size: 48 * energy, hue: 205, saturation: 34, flash: true, seed: seed + 31, angle: impactAngle + 2.2, aspect: 4.8 },
              { x, y, vx: 0, vy: 0, born: now, life: 145, size: 1, hue: 205, screenFlash: true },
            );
          }
          // Electrical arcs bridge the contact at different angles. Their count and
          // orientation vary per collision, so the silhouette never repeats.
          const arcCount = Math.round((1 + energy * 2.35) * (mobilePerformance ? .52 : 1));
          for (let arc = 0; arc < arcCount; arc++) {
            sparkParticlesRef.current.push({
              x, y, vx: 0, vy: 0,
              born: now + arc * 18,
              life: 120 + Math.random() * 170,
              size: (24 + Math.random() * 42) * energy,
              hue: arc % 2 ? palettes[0] : palettes[1],
              saturation: arc % 2 ? 48 : 100,
              seed: seed + arc * 17,
              angle: impactAngle + (Math.random() - .5) * 2.8,
              arc: true,
            });
          }
          // Tiny delayed fractures bloom where fast fragments tear away from the
          // contact. These staggered secondary events make the shower feel layered.
          const microBursts = Math.round((2 + energy * 2.2) * (mobilePerformance ? .45 : 1));
          for (let micro = 0; micro < microBursts; micro++) {
            const direction = impactAngle + (Math.random() - .5) * Math.PI * 1.7,
              distanceFromContact = (9 + Math.random() * 35) * energy,
              microX = x + Math.cos(direction) * distanceFromContact,
              microY = y + Math.sin(direction) * distanceFromContact,
              delay = 65 + Math.random() * 190;
            sparkParticlesRef.current.push({
              x: microX, y: microY, vx: 0, vy: 0,
              born: now + delay,
              life: 130 + Math.random() * 100,
              size: (5 + Math.random() * 8) * energy,
              hue: palettes[(micro % 3) + 1],
              saturation: 100,
              flash: true,
              seed: seed + micro * 23,
              angle: direction,
              aspect: 2 + Math.random() * 1.8,
            });
          }
          for (let spark = 0; spark < count; spark++) {
            const family = Math.random(),
              fanSide = spark % 2 ? 1 : -1,
              // Five burst families: twin fan, forward cone, backward ricochet,
              // grazing sheet and chaotic fracture. The pattern is picked anew on
              // every impact, not tied to rank or pair.
              spread = burstCase === 0
                ? impactAngle + Math.PI / 2 * fanSide + (Math.random() - .5) * 1.05
                : burstCase === 1
                  ? impactAngle + (Math.random() - .5) * 1.35
                  : burstCase === 2
                    ? impactAngle + Math.PI + (Math.random() - .5) * 1.7
                    : burstCase === 3
                      ? impactAngle + Math.PI / 2 * fanSide + (Math.random() - .5) * .38
                      : Math.random() * Math.PI * 2 + Math.sin(spark * 2.4) * .32,
              speed = (2.2 + Math.random() ** .42 * 9.6) * energy,
              hot = family < .18,
              ember = family > .82,
              hue = hot ? palettes[0] + (Math.random() - .5) * 10 : ember ? palettes[3] + Math.random() * 8 : (family < .56 ? palettes[1] : palettes[2]) + (Math.random() - .5) * 10;
            sparkParticlesRef.current.push({
              x, y,
              vx: Math.cos(spread) * speed,
              vy: Math.sin(spread) * speed,
              born: now,
              life: (ember ? 780 : 360) + Math.random() * (430 + energy * 220),
              size: (hot ? 2.4 + Math.random() * 2.6 : ember ? 1.1 + Math.random() * 1.8 : 1.4 + Math.random() * 2.5) * Math.min(1.35, energy),
              hue,
              saturation: hot ? 48 : 100,
              seed: Math.random() * 1000,
            });
          }
          const particleLimit = mobilePerformance ? 220 : 520;
          if (sparkParticlesRef.current.length > particleLimit) {
            sparkParticlesRef.current.splice(0, sparkParticlesRef.current.length - particleLimit);
          }
        }
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

  const beginGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    gestureRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gestureRef.current.pointers.size > 1) gestureRef.current.suppressUntil = Number.POSITIVE_INFINITY;
  };
  const trackGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    const start = gestureRef.current.pointers.get(event.pointerId);
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) {
      gestureRef.current.suppressUntil = Number.POSITIVE_INFINITY;
    }
  };
  const endGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    gestureRef.current.pointers.delete(event.pointerId);
    if (gestureRef.current.pointers.size === 0 && !Number.isFinite(gestureRef.current.suppressUntil)) {
      gestureRef.current.suppressUntil = performance.now() + 420;
    }
  };
  const gestureBlocksSelection = () => performance.now() < gestureRef.current.suppressUntil;

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
          <button type="button" className="bubble-neo-chip" onClick={() => { reportMarketBubbleEvent({ action: "market_switch", market }); navigate("/kospi-orbit"); }}>증시궤도 ✦</button>
        </div>
        <div className="bubble-heading">
          <p>시가총액 TOP 20 · 5초마다 갱신</p>
          <h1>{MARKETS.find((it) => it.key === market)?.title}</h1>
        </div>
        <div className="bubble-live"><i /> LIVE <span>{board ? new Date(board.generated_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}</span></div>
      </header>

      <section
        ref={stageRef}
        className="bubble-stage"
        aria-label={`${market} 시가총액 상위 20개 종목 버블`}
        onPointerMove={movePointer}
        onPointerDownCapture={beginGesture}
        onPointerMoveCapture={trackGesture}
        onPointerUpCapture={endGesture}
        onPointerCancelCapture={endGesture}
        onPointerLeave={() => { pointerRef.current.active = false; }}
      >
        {!loading && <BubbleWebGLSurface bodiesRef={bodiesRef} bubbleColors={bubbleColors} count={items.length} focusRef={focusRef} cameraCommandRef={cameraCommandRef} collisionWavesRef={collisionWavesRef} />}
        {!loading && <BubbleCollisionSparks particlesRef={sparkParticlesRef} />}
        {!loading && items.length > 0 && (
          <aside className="bubble-market-console" aria-label="시장 온도 요약">
            <div className="bubble-console-kicker"><i /> MARKET PULSE</div>
            <div className="bubble-console-score">
              <span>상위 20 평균</span>
              <strong className={marketPulse.average > .04 ? "is-up" : marketPulse.average < -.04 ? "is-down" : "is-flat"}>
                {marketPulse.average > 0 ? "+" : ""}{marketPulse.average.toFixed(2)}<small>%</small>
              </strong>
            </div>
            <div className="bubble-breadth-bar" aria-label={`상승 ${marketPulse.rising}, 보합 ${marketPulse.flat}, 하락 ${marketPulse.falling}`}>
              <i className="rise" style={{ flex: marketPulse.rising }} />
              <i className="flat" style={{ flex: marketPulse.flat || .25 }} />
              <i className="fall" style={{ flex: marketPulse.falling }} />
            </div>
            <div className="bubble-breadth-labels">
              <span><i className="rise" />상승 <b>{marketPulse.rising}</b></span>
              <span><i className="flat" />보합 <b>{marketPulse.flat}</b></span>
              <span><i className="fall" />하락 <b>{marketPulse.falling}</b></span>
            </div>
            <div className="bubble-movers-title"><span>AMPLITUDE</span><b>변동성 상위</b></div>
            <div className="bubble-movers">
              {marketPulse.movers.map((item) => {
                const index = items.findIndex((candidate) => candidate.code === item.code);
                return (
                  <button
                    type="button"
                    key={item.code}
                    onClick={() => {
                      focusRef.current = index;
                      setDiscussionIndex(index);
                    }}
                  >
                    <span><small>#{item.rank}</small><b>{shortName(item, market)}</b></span>
                    <em className={item.change_pct >= 0 ? "is-up" : "is-down"}>
                      {item.change_pct > 0 ? "+" : ""}{item.change_pct.toFixed(2)}%
                    </em>
                  </button>
                );
              })}
            </div>
            <p>원의 크기는 시총 순위, 깊이는 시장 공간을 뜻합니다.</p>
          </aside>
        )}
        <div className="bubble-stage-hint"><b>MARKET CONSTELLATION</b><span>움직이고, 부딪히고, 반응하는 실시간 시총 지도</span></div>
        <div className="bubble-explorer-guide" aria-hidden="true">
          <span><i>↻</i><b>회전</b><small>한 손가락 · 드래그</small></span>
          <span><i>⌁</i><b>확대·이동</b><small>두 손가락 · 휠</small></span>
          <span><i>◎</i><b>포커스</b><small>버블 탭</small></span>
        </div>
        <button className="bubble-camera-reset" type="button" onClick={() => { cameraCommandRef.current = { nonce: cameraCommandRef.current.nonce + 1, type: "reset" }; }} aria-label="3D 카메라 처음 위치로 초기화">
          <span>⌂</span><b>전체 보기</b>
        </button>
        <div className="bubble-depth-scale" aria-hidden="true"><span>NEAR</span><i /><span>FAR</span></div>
        {loading && <div className="bubble-loading"><MarketBubbleIcon /><span>시장 데이터를 불러오는 중</span></div>}
        {!loading && items.map((item, index) => {
          const colors = bubbleColors[index] ?? ["#a9bfd2", "#58748d"];
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
          const marketCap = formatMarketCap(item, market);
          const sizeTier = index < 2 ? 1 : index < 5 ? 2 : index < 9 ? 3 : index < 15 ? 4 : 5;
          return (
            <button
              key={`${market}-${item.code}`}
              ref={(el) => { if (bodiesRef.current[index]) bodiesRef.current[index].el = el; }}
              type="button"
              className={`stock-bubble bubble-size-tier-${sizeTier}`}
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
                if (gestureBlocksSelection()) return;
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
                if (gestureBlocksSelection()) return;
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
              <span className="stock-bubble-marcap">
                {marketCap ? <>시총 {marketCap.currency}<b>{marketCap.value}</b>{marketCap.unit}</> : "시총 산정 중"}
              </span>
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
                <b className={positive ? "is-up" : negative ? "is-down" : "is-flat"}>{formatPrice(item, market)}</b>
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
            colors={(bubbleColors[discussionIndex] ?? ["#a9bfd2", "#58748d"]) as [string, string]}
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
