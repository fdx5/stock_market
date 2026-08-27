import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { api, type MarketMapItem, type MarketMapResponse } from "../api/client";
import { Link, navigate } from "../router";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoProxyUrl, usCompanyLogoUrl } from "../usLogo";
import { reportMarketOrbitEvent } from "../useActivityTracking";
import {
  PLANET_FRAG,
  PLANET_VERT,
  SUN_FRAG,
  SUN_VERT,
  SUNGLOW_FRAG,
  SUNGLOW_VERT,
} from "../hub2/shaders";
import { createAlienPlanetMaps } from "./alienPlanetTextures";
import {
  loadPremiumPlanetMaps,
  type PremiumPlanetKind,
} from "./premiumPlanetTextures";
import StockDiscussionTab from "./StockDiscussionTab";
import StockNewsTab from "./StockNewsTab";
import "./stocksPage.css";
import "./kospiOrbit.css";
import "./orbitCompanyArchive.css";

type System = {
  name: string;
  stocks: MarketMapItem[];
  cap: number;
  change: number;
};
type SceneMode = { kind: "system"; sector: string };
type OrbitMarket = "kospi" | "kosdaq" | "nasdaq100";
type OrbitConfig = {
  key: OrbitMarket;
  label: string;
  limit: number;
  route: string;
  currency: "KRW" | "USD";
  fetchMap: (limit: number) => Promise<MarketMapResponse>;
  logoUrl: (code: string) => string;
  /** The same logo, from wherever it can be read back out of a canvas. Sampling a
   *  brand colour means drawing the image and calling getImageData, which needs the
   *  bytes to arrive CORS-clean — so this is not always the URL the <img> tags use.
   *  See the note on nasdaq100 below. */
  colorUrl: (code: string) => string;
  capOf: (stock: MarketMapItem) => number;
  discussion: "naver" | "global";
  news: "naver-finance" | "naver-search";
};
const ORBIT_CONFIGS: Record<OrbitMarket, OrbitConfig> = {
  kospi: {
    key: "kospi",
    label: "KOSPI",
    limit: 500,
    route: "/kospi-orbit",
    currency: "KRW",
    fetchMap: (limit) => api.marketMap(limit),
    logoUrl: stockIconUrl,
    // Naver's icon host sends `access-control-allow-origin: *`, so the displayed
    // image is also the one the colour is sampled from.
    colorUrl: stockIconUrl,
    capOf: (stock) => stock.marcap,
    discussion: "naver",
    news: "naver-finance",
  },
  kosdaq: {
    key: "kosdaq",
    label: "KOSDAQ",
    limit: 200,
    route: "/kosdaq-orbit",
    currency: "KRW",
    fetchMap: (limit) => api.kosdaqMap(limit),
    logoUrl: stockIconUrl,
    // Naver's icon host sends `access-control-allow-origin: *`, so the displayed
    // image is also the one the colour is sampled from.
    colorUrl: stockIconUrl,
    capOf: (stock) => stock.marcap,
    discussion: "naver",
    news: "naver-finance",
  },
  nasdaq100: {
    key: "nasdaq100",
    label: "NASDAQ100",
    limit: 103,
    route: "/nasdaq100-orbit",
    currency: "USD",
    fetchMap: (limit) => api.nasdaq100Map(limit),
    logoUrl: usCompanyLogoUrl,
    // companiesmarketcap sends no `Access-Control-Allow-Origin` at all, so an
    // `img.crossOrigin = "anonymous"` load of it fails outright and every US body fell
    // back to `colorFor`'s hash palette — which is why NVIDIA's star was violet rather
    // than its own green. Sampling goes through our same-origin proxy instead; the
    // tiles on screen keep loading straight from the CDN, which costs this app nothing.
    colorUrl: usCompanyLogoProxyUrl,
    capOf: (stock) => stock.market_cap ?? 0,
    discussion: "global",
    news: "naver-search",
  },
};
const orbitMarketCache = new Map<
  OrbitMarket,
  { at: number; data: MarketMapResponse }
>();
const ORBIT_MARKET_CACHE_MS = 60_000;
function loadOrbitMarket(config: OrbitConfig) {
  const cached = orbitMarketCache.get(config.key);
  if (cached && Date.now() - cached.at < ORBIT_MARKET_CACHE_MS)
    return Promise.resolve(cached.data);
  return config.fetchMap(config.limit).then((data) => {
    orbitMarketCache.set(config.key, { at: Date.now(), data });
    return data;
  });
}

const PALETTE = [
  0x63b3ff, 0x7c6cff, 0x18d7c4, 0xffa95f, 0xff6584, 0xc68cff, 0x57df79,
  0xf5d45c,
];
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const money = (n: number) =>
  n >= 1e12
    ? `${(n / 1e12).toFixed(1)}조`
    : `${Math.round(n / 1e8).toLocaleString()}억`;
function colorFor(code: string) {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const logoColorCache = new Map<string, Promise<number>>();
const LOGO_COLOR_STORAGE_KEY = "orbit-logo-colors-v1";
let persistedLogoColors: Record<string, number> | null = null;
function readPersistedLogoColors() {
  if (persistedLogoColors) return persistedLogoColors;
  try {
    persistedLogoColors = JSON.parse(
      localStorage.getItem(LOGO_COLOR_STORAGE_KEY) || "{}",
    ) as Record<string, number>;
  } catch {
    persistedLogoColors = {};
  }
  return persistedLogoColors;
}
let persistLogoColorTimer = 0;
function persistLogoColor(cacheKey: string, color: number) {
  const stored = readPersistedLogoColors();
  stored[cacheKey] = color;
  window.clearTimeout(persistLogoColorTimer);
  persistLogoColorTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(LOGO_COLOR_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // The in-memory cache remains available when storage is disabled or full.
    }
  }, 250);
}
function logoColor(
  code: string,
  logoUrl: (code: string) => string,
): Promise<number> {
  const cacheKey = logoUrl(code),
    cached = logoColorCache.get(cacheKey);
  if (cached) return cached;
  const persisted = readPersistedLogoColors()[cacheKey];
  if (Number.isInteger(persisted)) {
    const request = Promise.resolve(persisted);
    logoColorCache.set(cacheKey, request);
    return request;
  }
  const request = new Promise<number>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const x = c.getContext("2d", { willReadFrequently: true })!;
        x.drawImage(img, 0, 0, 64, 64);
        const d = x.getImageData(0, 0, 64, 64).data;
        let r = 0,
          g = 0,
          b = 0,
          w = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 100) continue;
          const mx = Math.max(d[i], d[i + 1], d[i + 2]),
            mn = Math.min(d[i], d[i + 1], d[i + 2]),
            sat = mx - mn;
          if ((mx > 238 && mn > 225) || sat < 18) continue;
          const weight = 0.3 + sat / 255;
          r += d[i] * weight;
          g += d[i + 1] * weight;
          b += d[i + 2] * weight;
          w += weight;
        }
        const color = w
          ? new THREE.Color(r / w / 255, g / w / 255, b / w / 255).getHex()
          : colorFor(code);
        persistLogoColor(cacheKey, color);
        resolve(color);
      } catch {
        const color = colorFor(code);
        persistLogoColor(cacheKey, color);
        resolve(color);
      }
    };
    img.onerror = () => {
      const color = colorFor(code);
      persistLogoColor(cacheKey, color);
      resolve(color);
    };
    img.src = cacheKey;
  });
  logoColorCache.set(cacheKey, request);
  return request;
}
function planetRadius(rank: number, count: number) {
  const scaled =
    count < 52
      ? Math.ceil((rank - 1) / Math.max(1, (count - 1) / 8))
      : rank <= 2
        ? 1
        : rank <= 5
          ? 2
          : rank <= 10
            ? 3
            : rank <= 20
              ? 4
              : rank <= 30
                ? 5
                : rank <= 40
                  ? 6
                  : rank <= 50
                    ? 7
                    : 8;
  const base = [0, 2.4, 2.05, 1.75, 1.47, 1.23, 1.02, 0.84, 0.68][
    Math.min(8, scaled)
  ];
  return base * (scaled === 1 ? 5 : scaled === 2 ? 3 : 2) * 0.5;
}

function SpaceScene({
  systems,
  mode,
  selected,
  colors,
  onSelect,
  onOpenCompanyBrowser,
  onReady,
  logoUrl,
  colorUrl,
  trackingMarket,
}: {
  systems: System[];
  mode: SceneMode;
  selected: MarketMapItem | null;
  colors: Map<string, number>;
  onSelect: (s: MarketMapItem | null) => void;
  onOpenCompanyBrowser: (s: MarketMapItem) => void;
  onReady: () => void;
  logoUrl: (code: string) => string;
  colorUrl: (code: string) => string;
  trackingMarket: string;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const colorsRef = useRef(colors);
  const selectedRef = useRef(selected);
  colorsRef.current = colors;
  selectedRef.current = selected;
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030712, 0.0009);
    let backgroundTexture: THREE.Texture | null = null;
    const camera = new THREE.PerspectiveCamera(
      48,
      host.clientWidth / host.clientHeight,
      0.1,
      3000,
    );
    camera.position.set(0, 88, 135);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    const coarseDevice = matchMedia("(pointer: coarse)").matches;
    const use8kPanorama =
      !coarseDevice && renderer.capabilities.maxTextureSize >= 8192;
    const panoramaSize = use8kPanorama ? "8k" : "4k";
    const backgroundPath =
      trackingMarket === "KOSPI"
        ? `/img/sky/nebula-kit-deep-field-11-${panoramaSize}.webp`
        : trackingMarket === "KOSDAQ"
          ? `/img/sky/space-spheremaps-blue-nebulae-1-${panoramaSize}.webp`
          : trackingMarket === "NASDAQ100"
            ? `/img/sky/space-spheremaps-hazy-nebulae-1-${panoramaSize}.webp`
            : null;
    if (backgroundPath) {
      backgroundTexture = new THREE.TextureLoader().load(backgroundPath);
      backgroundTexture.colorSpace = THREE.SRGBColorSpace;
      // Project the 2:1 lat-long image onto the environment sphere so camera
      // rotation reveals the complete seamless panorama.
      backgroundTexture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = backgroundTexture;
      scene.backgroundIntensity = trackingMarket === "KOSPI" ? 0.48 : 0.72;
      scene.backgroundBlurriness = 0;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const composer = coarseDevice ? null : new EffectComposer(renderer);
    if (composer) {
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(host.clientWidth, host.clientHeight),
          0.56,
          0.52,
          0.58,
        ),
      );
    }
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.minDistance = 0.8;
    controls.maxDistance = 460;
    controls.maxPolarAngle = Math.PI * 0.84;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    scene.add(new THREE.AmbientLight(0x86add8, 0.92));
    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    const hit: THREE.Object3D[] = [];
    const cloudLayers: { mesh: THREE.Mesh; speed: number }[] = [];
    const pulseGeometry = new THREE.SphereGeometry(1, 24, 14);
    const pulseLayers: {
      mesh: THREE.Mesh;
      material: THREE.MeshBasicMaterial;
      baseScale: number;
      movement: number;
      highlyActive: boolean;
      phase: number;
    }[] = [];
    let blueStarMaterial: THREE.ShaderMaterial | null = null;
    const movers: {
      mesh: THREE.Mesh;
      orbit: number;
      angle: number;
      speed: number;
      inclination: number;
      node: number;
      cosInclination: number;
      sinInclination: number;
      cosNode: number;
      sinNode: number;
      spin: number;
    }[] = [];
    const starGeo = new THREE.BufferGeometry();
    const points = matchMedia("(pointer: coarse)").matches ? 3500 : 8500;
    const pos = new Float32Array(points * 3);
    for (let i = 0; i < points; i++) {
      const r = 250 + Math.random() * 900,
        a = Math.random() * Math.PI * 2,
        z = (Math.random() - 0.5) * 500;
      pos.set([Math.cos(a) * r, z, Math.sin(a) * r], i * 3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({
          color: 0x8bb8ed,
          size: 0.48,
          transparent: true,
          opacity: 0.72,
        }),
      ),
    );
    /* Legacy canvas and solar-system image textures were removed here. Every visible
       planet now receives its final generated design directly, avoiding unused image
       downloads and duplicate design work when a sector is revisited. */
    const surfaceTexture = (code: string, color: number, star: boolean) => {
      const size = matchMedia("(pointer: coarse)").matches ? 256 : 512,
        canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!,
        base = new THREE.Color(color);
      let seed =
        Number.parseInt(code.replace(/\D/g, "").slice(-6) || "731", 10) || 731;
      const gas = !star && seed % 3 !== 0,
        rnd = () =>
          (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      const grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(
        0,
        `#${base.clone().offsetHSL(0.03, -0.05, 0.2).getHexString()}`,
      );
      grad.addColorStop(0.5, `#${base.getHexString()}`);
      grad.addColorStop(
        1,
        `#${base.clone().offsetHSL(-0.03, 0.05, -0.22).getHexString()}`,
      );
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      if (gas) {
        for (let y = 0; y < size;) {
          const h = 5 + rnd() * 30,
            light = (rnd() - 0.5) * 0.24;
          ctx.fillStyle = `#${base
            .clone()
            .offsetHSL((rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.16, light)
            .getHexString()}`;
          ctx.globalAlpha = 0.22 + rnd() * 0.34;
          ctx.fillRect(0, y, size, h);
          y += h;
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < (star ? 170 : gas ? 75 : 45); i++) {
        const x = rnd() * size,
          y = rnd() * size,
          w = (0.02 + rnd() * (gas ? 0.2 : 0.08)) * size,
          h = (0.006 + rnd() * (gas ? 0.035 : 0.06)) * size,
          g = ctx.createRadialGradient(x, y, 0, x, y, w);
        g.addColorStop(
          0,
          `rgba(255,255,255,${star ? 0.08 + rnd() * 0.2 : 0.025 + rnd() * 0.1})`,
        );
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, h / w);
        ctx.beginPath();
        ctx.arc(0, 0, w, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = "multiply";
      for (let i = 0; i < (star ? 90 : gas ? 28 : 130); i++) {
        const x = rnd() * size,
          y = rnd() * size,
          r = (0.005 + rnd() * (gas ? 0.035 : 0.045)) * size;
        ctx.fillStyle = `rgba(5,12,25,${0.04 + rnd() * (gas ? 0.12 : 0.3)})`;
        ctx.beginPath();
        ctx.ellipse(
          x,
          y,
          r,
          r * (gas ? 0.3 + rnd() * 0.3 : 0.7 + rnd() * 0.3),
          rnd() * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(
        8,
        renderer.capabilities.getMaxAnisotropy(),
      );
      texture.wrapS = THREE.RepeatWrapping;
      return texture;
    };
    const placeholderTexture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    placeholderTexture.colorSpace = THREE.SRGBColorSpace;
    placeholderTexture.needsUpdate = true;
    const planetGeometryCache = new Map<number, THREE.SphereGeometry>();
    const cloudGeometryCache = new Map<number, THREE.SphereGeometry>();
    const planetGeometry = (radius: number) => {
      let geometry = planetGeometryCache.get(radius);
      if (!geometry) {
        geometry = new THREE.SphereGeometry(radius, 48, 36);
        planetGeometryCache.set(radius, geometry);
      }
      return geometry;
    };
    const cloudGeometry = (radius: number) => {
      let geometry = cloudGeometryCache.get(radius);
      if (!geometry) {
        geometry = new THREE.SphereGeometry(radius * 1.018, 48, 32);
        cloudGeometryCache.set(radius, geometry);
      }
      return geometry;
    };
    const makeBody = (
      radius: number,
      color: number,
      code: string,
      glow = false,
    ) => {
      const numeric =
          Number.parseInt(code.replace(/\D/g, "").slice(-6) || "731", 10) ||
          731,
        isGas = numeric % 3 !== 0,
        texture = placeholderTexture;
      const segments = glow ? 112 : 48,
        brand = new THREE.Color(color);
      const material = glow
        ? new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.58,
            metalness: 0,
            emissive: brand,
            emissiveMap: texture,
            emissiveIntensity: 0.62,
            color: brand.clone().lerp(new THREE.Color(0xffffff), 0.3),
          })
        : new THREE.ShaderMaterial({
            vertexShader: PLANET_VERT,
            fragmentShader: PLANET_FRAG.replace(
              "uniform sampler2D uMap;",
              `uniform sampler2D uMap;
uniform sampler2D uLandformMap;
uniform vec3 uBrandColor;
uniform vec3 uOceanColor;
uniform vec3 uTerrainTint;
uniform float uHasOcean;
uniform float uUvOffset;
uniform float uBrandMix;
uniform float uLandformOffset;
uniform float uSeaLevel;
uniform float uLandformBlend;
uniform float uInvertLandform;`,
            ).replace(
              "vec4 texel = texture2D(uMap, vUv);\n  vec3 albedo = texel.rgb;",
              `vec2 surfaceUv = vec2(fract(vUv.x + uUvOffset), vUv.y);
  vec4 texel = texture2D(uMap, surfaceUv);
  vec2 landUvA = vec2(fract(vUv.x + uLandformOffset), vUv.y);
  vec2 landUvB = vec2(fract(1.0 - vUv.x + uLandformOffset * 0.47), 1.0 - vUv.y);
  vec3 landA = texture2D(uLandformMap, landUvA).rgb;
  vec3 landB = texture2D(uLandformMap, landUvB).rgb;
  float heightA = dot(landA, vec3(0.299, 0.587, 0.114));
  float heightB = dot(landB, vec3(0.299, 0.587, 0.114));
  float terrainHeight = mix(heightA, heightB, uLandformBlend);
  terrainHeight = mix(terrainHeight, 1.0 - terrainHeight, uInvertLandform);
  float land = smoothstep(uSeaLevel - 0.055, uSeaLevel + 0.055, terrainHeight);
  float ocean = (1.0 - land) * uHasOcean;
  vec3 terrain = texel.rgb * uTerrainTint;
  terrain = mix(terrain, terrain * uBrandColor * 1.7, uBrandMix);
  vec3 albedo = mix(terrain, uOceanColor, ocean);`,
            ).replace(
              "vec3 color = mix(night, lit, day);",
              `vec3 color = mix(night, lit, day);
  vec3 halfway = normalize(L + V);
  float oceanGlint = pow(max(dot(N, halfway), 0.0), 72.0) * ocean;
  float oceanFresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0) * ocean;
  color += vec3(0.62, 0.83, 1.0) * oceanGlint * 0.92;
  color += uOceanColor * oceanFresnel * 0.34;`,
            ),
            uniforms: {
              uMap: { value: texture },
              uLandformMap: { value: texture },
              uBrandColor: { value: brand },
              uOceanColor: { value: new THREE.Color(0x062b52) },
              uTerrainTint: { value: new THREE.Color(0xffffff) },
              uHasOcean: { value: 0 },
              uUvOffset: { value: 0 },
              uBrandMix: { value: 0.46 },
              uLandformOffset: { value: 0 },
              uSeaLevel: { value: 0.48 },
              uLandformBlend: { value: 0 },
              uInvertLandform: { value: 0 },
              uSunPos: { value: new THREE.Vector3(0, 0, 0) },
              uAtmoColor: {
                value: brand.clone().lerp(new THREE.Color(0xffffff), 0.62),
              },
              uAtmoStrength: { value: 0.58 },
              uFocus: { value: 0 },
              uTrend: { value: 0 },
              uAmbient: { value: 0.72 },
              uExposure: { value: 1.08 },
            },
          });
      const m = new THREE.Mesh(
        glow
          ? new THREE.SphereGeometry(
              radius,
              segments,
              Math.round(segments * 0.68),
            )
          : planetGeometry(radius),
        material,
      );
      m.userData.radius = radius;
      m.userData.kind = glow ? "항성" : isGas ? "가스형" : "암석형";
      hit.push(m);
      scene.add(m);
      return m;
    };
    let centralStar: THREE.Mesh | null = null;
    const sys = systems.find((s) => s.name === mode.sector) ?? systems[0];
    if (sys) {
      centralStar = makeBody(
        9,
        colorsRef.current.get(sys.stocks[0].code) ??
          colorFor(sys.stocks[0].code),
        sys.stocks[0].code,
        true,
      );
      centralStar.userData.stock = sys.stocks[0];
      sys.stocks.slice(1).forEach((s, i) => {
        const rank = i + 2,
          radius = planetRadius(rank, sys.stocks.length),
          orbit = 20 + i * 3.45;
        const m = makeBody(
          radius,
          colorsRef.current.get(s.code) ?? colorFor(s.code),
          s.code,
        );
        m.userData.stock = s;
        const inclination = THREE.MathUtils.degToRad(-60 + ((i * 47) % 121));
        const node = (i * 2.399) % (Math.PI * 2);
        movers.push({
          mesh: m,
          orbit,
          angle: i * 2.399,
          speed: 0.055 / Math.sqrt(orbit / 20),
          inclination,
          node,
          cosInclination: Math.cos(inclination),
          sinInclination: Math.sin(inclination),
          cosNode: Math.cos(node),
          sinNode: Math.sin(node),
          spin: 0.22 + (i % 7) * 0.045,
        });
      });
      controls.maxDistance = Math.max(180, sys.stocks.length * 4.2);
      camera.position.set(
        0,
        Math.max(70, sys.stocks.length * 2.2),
        Math.max(115, sys.stocks.length * 3.1),
      );
    }
    let corona: THREE.Mesh | null = null;
    let coronaMaterial: THREE.ShaderMaterial | null = null;
    let lastStarBrand = "";
    const starPalette = (input: THREE.ColorRepresentation) => {
      const source = new THREE.Color(input),
        hsl = { h: 0, s: 0, l: 0 };
      source.getHSL(hsl);
      const saturation = THREE.MathUtils.clamp(hsl.s, 0.52, 0.86);
      return {
        cool: new THREE.Color().setHSL(hsl.h, saturation * 0.9, 0.075),
        warm: new THREE.Color().setHSL(hsl.h, saturation, 0.29),
        hot: new THREE.Color().setHSL(hsl.h, saturation * 0.42, 0.61),
      };
    };
    if (centralStar) {
      centralStar.scale.setScalar(1.5);
      centralStar.userData.radius = 13.5;
    }
    const ringHash = (code: string) => {
      let h = 2166136261;
      for (const char of code) {
        h ^= char.charCodeAt(0);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    const systemStockCount = sys?.stocks.length ?? 0,
      ringedPlanetCount =
        systemStockCount < 10 ? 1 : systemStockCount < 30 ? 2 : 3;
    [...movers]
      .sort(
        (a, b) =>
          ringHash((a.mesh.userData.stock as MarketMapItem).code) -
          ringHash((b.mesh.userData.stock as MarketMapItem).code),
      )
      .slice(0, Math.min(ringedPlanetCount, movers.length))
      .forEach(({ mesh, inclination, node }) => {
        const stock = mesh.userData.stock as MarketMapItem,
          seed = ringHash(stock.code),
          radius = Number(mesh.userData.radius) || 1,
          dense = seed % 2 === 0,
          inner = radius * (1.28 + (seed % 17) / 100),
          outer =
            radius *
            (dense ? 2.25 + (seed % 31) / 100 : 1.72 + (seed % 18) / 100),
          brand = new THREE.Color(
            colorsRef.current.get(stock.code) ?? colorFor(stock.code),
          ),
          geometry = new THREE.RingGeometry(inner, outer, 128, 1),
          material = new THREE.ShaderMaterial({
            vertexShader: `varying vec2 vRing;void main(){vRing=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
            fragmentShader: `uniform vec3 uColor;uniform float uInner;uniform float uOuter;uniform float uBands;uniform float uSeed;varying vec2 vRing;void main(){float r=length(vRing);float t=clamp((r-uInner)/(uOuter-uInner),0.0,1.0);float stripes=sin((t*uBands+uSeed)*6.28318)*.5+.5;float fine=sin((t*uBands*2.73+uSeed*.37)*6.28318)*.5+.5;float gaps=smoothstep(${dense ? ".20" : ".72"},${dense ? ".48" : ".88"},stripes*.72+fine*.28);float edge=smoothstep(0.0,.08,t)*smoothstep(1.0,.9,t);float alpha=gaps*edge*.52;gl_FragColor=vec4(mix(uColor,vec3(1.0),fine*.32),alpha);}`,
            uniforms: {
              uColor: {
                value: brand.clone().lerp(new THREE.Color(0xffffff), 0.26),
              },
              uInner: { value: inner },
              uOuter: { value: outer },
              uBands: { value: dense ? 18 + (seed % 18) : 5 + (seed % 5) },
              uSeed: { value: (seed % 997) / 997 },
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
          ring = new THREE.Mesh(geometry, material);
        ring.userData.orbitQuaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(inclination, node, 0, "XYZ"),
        );
        ring.renderOrder = 1;
        mesh.add(ring);
      });
    movers.forEach(({ mesh }) => {
      const stock = mesh.userData.stock as MarketMapItem,
        seed = ringHash(stock.code);
      mesh.children
        .filter(
          (child) =>
            child instanceof THREE.Mesh &&
            child.geometry instanceof THREE.RingGeometry,
        )
        .forEach((child) => {
          const ring = child as THREE.Mesh<THREE.RingGeometry>,
            count = 36 + (seed % 29),
            positions = new Float32Array(count * 3),
            inner = ring.geometry.parameters.innerRadius as number,
            outer = ring.geometry.parameters.outerRadius as number;
          for (let i = 0; i < count; i++) {
            const cluster = Math.floor(i / 7),
              angle =
                (cluster / Math.ceil(count / 7)) * Math.PI * 2 +
                (((seed + i * 37) % 100) / 100) * 0.42,
              radius =
                inner + (outer - inner) * (0.12 + ((seed + i * 53) % 77) / 100);
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = Math.sin(angle) * radius;
            positions[i * 3 + 2] = ((i % 3) - 1) * 0.012;
          }
          const dustGeometry = new THREE.BufferGeometry();
          dustGeometry.setAttribute(
            "position",
            new THREE.BufferAttribute(positions, 3),
          );
          const dust = new THREE.Points(
            dustGeometry,
            new THREE.PointsMaterial({
              color: new THREE.Color(
                colorsRef.current.get(stock.code) ?? colorFor(stock.code),
              ).lerp(new THREE.Color(0xffffff), 0.48),
              size: Math.max(0.025, Number(mesh.userData.radius) * 0.035),
              transparent: true,
              opacity: 0.72,
              depthWrite: false,
              sizeAttenuation: true,
            }),
          );
          ring.add(dust);
          ring.onBeforeRender = () => {
            const fixed = ring.userData.orbitQuaternion as THREE.Quaternion;
            ring.quaternion.copy(mesh.quaternion).invert().multiply(fixed);
          };
        });
    });
    movers.forEach(({ mesh }) => {
      const stock = mesh.userData.stock as MarketMapItem,
        seed = ringHash(stock.code),
        brand = new THREE.Color(
          colorsRef.current.get(stock.code) ?? colorFor(stock.code),
        );
      mesh.children
        .filter(
          (child) =>
            child instanceof THREE.Mesh &&
            child.geometry instanceof THREE.RingGeometry,
        )
        .forEach((child) => {
          const ring = child as THREE.Mesh<THREE.RingGeometry>,
            inner = ring.geometry.parameters.innerRadius as number,
            outer = ring.geometry.parameters.outerRadius as number,
            span = outer - inner,
            bandCount = 3 + (seed % 4);
          for (let i = 0; i < bandCount; i++) {
            const start = inner + span * (0.06 + ((seed + i * 31) % 78) / 100),
              width = span * (0.012 + ((seed + i * 47) % 13) / 100),
              band = new THREE.Mesh(
                new THREE.RingGeometry(
                  start,
                  Math.min(outer, start + width),
                  96,
                ),
                new THREE.MeshBasicMaterial({
                  color: brand
                    .clone()
                    .lerp(
                      new THREE.Color(0xffffff),
                      0.2 + ((seed + i * 19) % 45) / 100,
                    ),
                  transparent: true,
                  opacity: 0.2 + ((seed + i * 23) % 45) / 100,
                  side: THREE.DoubleSide,
                  depthWrite: false,
                }),
              );
            band.position.z = (i - bandCount * 0.5) * 0.004;
            ring.add(band);
          }
        });
    });
    let orbitCursor = 45,
      previousRadius = 13.5;
    movers.forEach((planet, index) => {
      const radius = Number(planet.mesh.userData.radius) || 1;
      if (index > 0) orbitCursor += (previousRadius + radius) * 1.5 + 10;
      planet.orbit = orbitCursor;
      previousRadius = radius;
    });
    controls.maxDistance = Math.max(780, (sys?.stocks.length ?? 1) * 16);
    const defaultCameraPosition = camera.position.clone(),
      defaultCameraTarget = controls.target.clone();
    let focusTarget: THREE.Object3D | null = selected
      ? (hit.find(
          (o) =>
            (o.userData.stock as MarketMapItem | undefined)?.code ===
            selected.code,
        ) ?? null)
      : null;
    let flying = focusTarget !== null,
      focusViewStyle = -1,
      focusFlightStartedAt = performance.now(),
      tourJourneyStartedAt = performance.now(),
      tourStage: "star" | "planet" | "target" | "dwell" | null = null,
      tourPlanetTarget: THREE.Object3D | null = null,
      tourPlanetViewStyle = -1,
      tourLegStartedAt = 0,
      resettingView = false;
    if (focusTarget) controls.zoomToCursor = false;
    const focusOffset = new THREE.Vector3();
    const desiredCamera = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const lastFocusPosition = new THREE.Vector3();
    const focusMotion = new THREE.Vector3();
    const tourDwellOffset = new THREE.Vector3();
    /* The star-to-planet leg of the tour. It is flown on a clock rather than chased
       with a damped lerp: an exponential approach spends more than half the gap in its
       first second, so the planet went from invisible to filling the frame before the
       viewer could register the trip. Five seconds, eased at both ends, along a bowed
       path — the planet is framed early and grows the whole way in. */
    const TOUR_APPROACH_MS = 5000;
    const tourLegFrom = new THREE.Vector3();
    const tourLegLookFrom = new THREE.Vector3();
    const tourLegControl = new THREE.Vector3();
    const tourLegSpan = new THREE.Vector3();
    const tourLegBow = new THREE.Vector3();
    const cinematicOffsets = [
      new THREE.Vector3(0.8, 0.34, 1).normalize(),
      new THREE.Vector3(-1, 0.18, 0.52).normalize(),
      new THREE.Vector3(0.26, 1, 0.72).normalize(),
      new THREE.Vector3(0.92, -0.42, -0.48).normalize(),
      new THREE.Vector3(-0.35, 0.72, -1).normalize(),
      new THREE.Vector3(1, 0.06, -0.18).normalize(),
      new THREE.Vector3(-0.58, -0.76, 0.82).normalize(),
      new THREE.Vector3(0.12, 0.46, 1).normalize(),
    ];
    const distanceMultipliers = [1, 1.34, 0.86, 1.62, 1.18, 1.48, 1.08, 0.78];
    const approachRates = [0.88, 0.82, 0.94, 0.76, 0.86, 0.8, 0.92, 0.98];
    const rotationAxes = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    const dampAlpha = (rate: number, delta: number) => 1 - Math.exp(-rate * delta);
    if (focusTarget) lastFocusPosition.copy(focusTarget.position);
    // The main solar-system maps are never displayed here. Each stock receives a
    // unique, logo-tinted alien surface generated from its own stable code seed.
    const featured = [...movers].sort(
      (a, b) =>
        ringHash((a.mesh.userData.stock as MarketMapItem).code) -
        ringHash((b.mesh.userData.stock as MarketMapItem).code),
    );
    const oceanWorldCount = Math.round(featured.length * 0.5),
      rockWorldCount = Math.round(featured.length * 0.15),
      premiumKinds = new Map<string, PremiumPlanetKind>();
    const oceanWorlds = featured.slice(0, oceanWorldCount);
    oceanWorlds.forEach((planet, index) => {
      premiumKinds.set(
        (planet.mesh.userData.stock as MarketMapItem).code,
        index % 2 === 0 ? "ocean" : "ocean-clouds",
      );
    });
    const whiteAtmosphereCodes = new Set(
      [...oceanWorlds]
        .sort((a, b) => {
          const aCode = (a.mesh.userData.stock as MarketMapItem).code,
            bCode = (b.mesh.userData.stock as MarketMapItem).code;
          return ringHash(`${aCode}:atmosphere`) - ringHash(`${bCode}:atmosphere`);
        })
        .slice(0, Math.round(oceanWorlds.length * 0.4))
        .map((planet) => (planet.mesh.userData.stock as MarketMapItem).code),
    );
    featured
      .slice(oceanWorldCount, oceanWorldCount + rockWorldCount)
      .forEach((planet) => {
        premiumKinds.set(
          (planet.mesh.userData.stock as MarketMapItem).code,
          "rock",
        );
      });
    const lightweightBodies = featured.filter(
        (planet) =>
          !premiumKinds.has(
            (planet.mesh.userData.stock as MarketMapItem).code,
          ),
      ),
      stormCount = Math.min(
        lightweightBodies.length,
        lightweightBodies.length >= 8 ? 2 : lightweightBodies.length ? 1 : 0,
      ),
      stormCodes = new Set(
        lightweightBodies
          .slice(0, stormCount)
          .map((x) => (x.mesh.userData.stock as MarketMapItem).code),
      ),
      bandCodes = new Set(
        lightweightBodies
          .slice(
            stormCount,
            stormCount + Math.min(2, Math.max(0, featured.length - stormCount)),
          )
          .map((x) => (x.mesh.userData.stock as MarketMapItem).code),
      );
    const progressiveDesign = true;
    const pendingDesignBodies: THREE.Object3D[] = [];
    const activityCodes = new Set(
      [...(sys?.stocks.slice(1) ?? [])]
        .sort(
          (a, b) =>
            (b.close || 0) * (b.volume || 0) -
            (a.close || 0) * (a.volume || 0),
        )
        .slice(0, Math.max(1, Math.round(movers.length * 0.2)))
        .map((stock) => stock.code),
    );
    hit.forEach((body) => {
      const stock = body.userData.stock as MarketMapItem | undefined;
      if (!stock) return;
      const isStar = body === centralStar,
        brandColor = colorsRef.current.get(stock.code) ?? colorFor(stock.code),
        material = (body as THREE.Mesh).material as THREE.Material;
      if (isStar) {
        material.dispose();
        blueStarMaterial = new THREE.ShaderMaterial({
          vertexShader: SUN_VERT,
          fragmentShader: SUN_FRAG,
          uniforms: {
            uTime: { value: 0 },
            uPulse: { value: 0.08 },
            uCool: { value: new THREE.Color(0x031a55) },
            uWarm: { value: new THREE.Color(0x087dcc) },
            uHot: { value: new THREE.Color(0xbdefff) },
            uDetail: { value: 6 },
          },
        });
        (body as THREE.Mesh).material = blueStarMaterial;
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(Number(body.userData.radius) * 1.13, 64, 40),
          new THREE.MeshBasicMaterial({
            color: 0x159ee8,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        body.add(halo);
        return;
      }
      if (material instanceof THREE.ShaderMaterial) {
        material.uniforms.uTrend.value = THREE.MathUtils.clamp(
          stock.change_pct / 6,
          -1,
          1,
        );
      }
      const movement = Math.min(1, Math.abs(stock.change_pct) / 6),
        isHighlyActive = activityCodes.has(stock.code);
      if (movement > 0.18 || isHighlyActive) {
        const radius = Number(body.userData.radius),
          pulseMaterial = new THREE.MeshBasicMaterial({
            color: stock.change_pct >= 0 ? 0xff536b : 0x4b9dff,
            transparent: true,
            opacity: 0.035 + movement * 0.055,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
          pulse = new THREE.Mesh(pulseGeometry, pulseMaterial),
          phase = (ringHash(stock.code) % 628) / 100;
        pulse.scale.setScalar(radius * 1.1);
        pulseLayers.push({
          mesh: pulse,
          material: pulseMaterial,
          baseScale: radius * 1.1,
          movement,
          highlyActive: isHighlyActive,
          phase,
        });
        body.add(pulse);
      }
      if (progressiveDesign) {
        pendingDesignBodies.push(body);
        return;
      }
      const planetStyle = stormCodes.has(stock.code)
          ? "storm"
          : bandCodes.has(stock.code)
            ? "complex-bands"
            : "standard",
        maps = createAlienPlanetMaps(
          stock.code,
          brandColor,
          renderer.capabilities.getMaxAnisotropy(),
          128,
          planetStyle,
        );
      body.userData.kind =
        planetStyle === "storm"
          ? `${maps.kind} · 대형 폭풍`
          : planetStyle === "complex-bands"
            ? `${maps.kind} · 다층 구름띠`
            : maps.kind;
      if (material instanceof THREE.ShaderMaterial) {
        material.uniforms.uMap.value = maps.surface;
        material.uniforms.uAtmoColor.value = maps.atmosphere;
        material.uniforms.uAtmoStrength.value = 0.28;
        material.uniforms.uAmbient.value = 0.54;
        material.uniforms.uExposure.value = 0.84;
      }
      if (maps.clouds) {
        const radius = Number(body.userData.radius),
          cloud = new THREE.Mesh(
            cloudGeometry(radius),
            new THREE.MeshBasicMaterial({
              map: maps.clouds,
              transparent: true,
              opacity: planetStyle === "complex-bands" ? 0.28 : 0.22,
              depthWrite: false,
              blending: THREE.NormalBlending,
              toneMapped: true,
            }),
          );
        body.add(cloud);
        cloudLayers.push({ mesh: cloud, speed: maps.cloudSpeed });
      }
    });
    let designTimer = 0;
    if (progressiveDesign && pendingDesignBodies.length) {
      pendingDesignBodies.sort(
        (a, b) => Number(b.userData.radius) - Number(a.userData.radius),
      );
      let designDisposed = false;
      const applyNextDesign = async () => {
        const body = pendingDesignBodies.shift();
        if (!body) return;
        const stock = body.userData.stock as MarketMapItem,
          brandColor = await logoColor(stock.code, colorUrl),
          material = (body as THREE.Mesh).material,
          premiumKind = premiumKinds.get(stock.code),
          planetStyle = stormCodes.has(stock.code)
            ? "storm"
            : bandCodes.has(stock.code)
              ? "complex-bands"
              : "standard",
          maps = premiumKind
            ? await loadPremiumPlanetMaps(
                stock.code,
                premiumKind,
                renderer.capabilities.getMaxAnisotropy(),
                whiteAtmosphereCodes.has(stock.code),
              )
            : createAlienPlanetMaps(
                stock.code,
                brandColor,
                renderer.capabilities.getMaxAnisotropy(),
                128,
                planetStyle,
              );
        if (designDisposed) return;
        const isPremiumMaps = "kindLabel" in maps;
        const hasDoubleGasAtmosphere =
          !isPremiumMaps &&
          maps.kind === "gas" &&
          ringHash(`${stock.code}:double-atmosphere`) % 10 < 7;
        body.userData.kind = isPremiumMaps
          ? maps.kindLabel
          : planetStyle === "storm"
            ? `${maps.kind} · 대형 폭풍`
            : planetStyle === "complex-bands"
              ? `${maps.kind} · 다층 구름띠`
              : hasDoubleGasAtmosphere
                ? `${maps.kind} · 이중 회전 대기`
                : maps.kind;
        if (material instanceof THREE.ShaderMaterial) {
          material.uniforms.uMap.value = maps.surface;
          material.uniforms.uAtmoColor.value = maps.atmosphere;
          material.uniforms.uAtmoStrength.value = isPremiumMaps ? 0.42 : 0.28;
          material.uniforms.uAmbient.value = isPremiumMaps ? 0.62 : 0.54;
          material.uniforms.uExposure.value = isPremiumMaps ? 0.94 : 0.84;
          if (isPremiumMaps) {
            material.uniforms.uLandformMap.value =
              maps.landformMap ?? maps.surface;
            material.uniforms.uOceanColor.value.copy(maps.oceanColor);
            material.uniforms.uTerrainTint.value.copy(maps.terrainTint);
            material.uniforms.uHasOcean.value = maps.landformMap ? 1 : 0;
            material.uniforms.uUvOffset.value = maps.uvOffset;
            material.uniforms.uBrandMix.value = 0.08;
            material.uniforms.uLandformOffset.value = maps.landformOffset;
            material.uniforms.uSeaLevel.value = maps.seaLevel;
            material.uniforms.uLandformBlend.value = maps.landformBlend;
            material.uniforms.uInvertLandform.value = maps.invertLandform;
          }
        }
        if (maps.clouds) {
          const radius = Number(body.userData.radius),
            cloud = new THREE.Mesh(
              cloudGeometry(radius),
            new THREE.MeshBasicMaterial({
              map: maps.clouds,
              alphaMap: isPremiumMaps ? maps.clouds : null,
              color: isPremiumMaps ? 0xeaf7ff : 0xffffff,
              transparent: true,
              opacity: isPremiumMaps
                ? 0.64
                : planetStyle === "complex-bands"
                  ? 0.28
                  : 0.22,
              alphaTest: isPremiumMaps ? 0.025 : 0,
              depthWrite: false,
                blending: THREE.NormalBlending,
                toneMapped: true,
              }),
            );
          body.add(cloud);
          cloudLayers.push({ mesh: cloud, speed: maps.cloudSpeed });
          if (hasDoubleGasAtmosphere && maps.cloudsSecondary) {
            const outerTexture = maps.cloudsSecondary;
            outerTexture.offset.x =
              (ringHash(`${stock.code}:cloud-offset`) % 1000) / 1000;
            outerTexture.repeat.set(1.08, 1);
            outerTexture.needsUpdate = true;
            const outerCloud = new THREE.Mesh(
              new THREE.SphereGeometry(radius * 1.038, 48, 32),
              new THREE.MeshBasicMaterial({
                map: outerTexture,
                color: maps.atmosphere.clone().lerp(
                  new THREE.Color(0xffffff),
                  0.28,
                ),
                transparent: true,
                opacity: 0.14,
                alphaTest: 0.015,
                depthWrite: false,
                blending: THREE.NormalBlending,
                toneMapped: true,
              }),
            );
            outerCloud.rotation.z =
              ((ringHash(`${stock.code}:cloud-tilt`) % 13) - 6) * 0.012;
            body.add(outerCloud);
            cloudLayers.push({
              mesh: outerCloud,
              speed: -(maps.cloudSpeed * 0.46 + 0.018),
            });
          }
        }
        if (
          isPremiumMaps &&
          maps.landformMap &&
          maps.atmosphereTexture
        ) {
          const radius = Number(body.userData.radius),
            hazeTexture = maps.atmosphereTexture.clone();
          hazeTexture.offset.x =
            (ringHash(`${stock.code}:ocean-haze-offset`) % 1000) / 1000;
          hazeTexture.repeat.set(1.12, 0.96);
          hazeTexture.needsUpdate = true;
          const haze = new THREE.Mesh(
            new THREE.SphereGeometry(radius * 1.052, 48, 32),
            new THREE.MeshBasicMaterial({
              map: hazeTexture,
              alphaMap: hazeTexture,
              color: maps.atmosphere,
              transparent: true,
              opacity: maps.clouds ? 0.095 : 0.14,
              alphaTest: 0.012,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              toneMapped: true,
            }),
          );
          haze.rotation.z =
            ((ringHash(`${stock.code}:ocean-haze-tilt`) % 15) - 7) * 0.01;
          body.add(haze);
          cloudLayers.push({
            mesh: haze,
            speed:
              (ringHash(`${stock.code}:ocean-haze-direction`) % 2 ? 1 : -1) *
              (0.018 +
                (ringHash(`${stock.code}:ocean-haze-speed`) % 32) / 1000),
          });
        }
        if (pendingDesignBodies.length)
          designTimer = window.setTimeout(applyNextDesign, 64);
      };
      designTimer = window.setTimeout(applyNextDesign, 0);
      (scene.userData as { disposeDesigns?: () => void }).disposeDesigns =
        () => {
          designDisposed = true;
        };
    }
    hit.forEach((body) => {
      if (body === centralStar) return;
      const material = (body as THREE.Mesh).material;
      if (material instanceof THREE.ShaderMaterial) {
        material.fragmentShader = material.fragmentShader
          .replace(
            "float day = smoothstep(-0.32, 0.42, ndl);",
            "float day = 1.0;",
          )
          .replace(
            "float lambert = max(ndl, 0.0);",
            "float lambert = 0.0;",
          )
          .replace(
            "vec3 lit = albedo * (uAmbient + lambert * 0.85) * day;",
            "vec3 lit = albedo * (0.58 + dot(N, V) * 0.22);",
          )
          .replace("vec3 night = albedo * 0.26;", "vec3 night = lit;")
          .replace(
            "float lit_rim = rim * smoothstep(-0.35, 0.2, ndl);",
            "float lit_rim = rim * 0.32;",
          )
          .replace(
            "color += uAtmoColor * term * uAtmoStrength * 0.34;",
            "color += uAtmoColor * term * uAtmoStrength * 0.0;",
          );
        material.needsUpdate = true;
      }
    });
    void surfaceTexture;
    if (centralStar) {
      const halo = centralStar.children.find(
        (child) =>
          child instanceof THREE.Mesh &&
          child.material instanceof THREE.MeshBasicMaterial,
      ) as
        THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
      if (halo) halo.visible = false;
      const coronaReach = 20.25;
      coronaMaterial = new THREE.ShaderMaterial({
          vertexShader: SUNGLOW_VERT,
          fragmentShader: SUNGLOW_FRAG.replace(
            "if (r > 1.0) discard;",
            "if (r > 1.0 || r < uUnit * 0.985) discard;",
          ),
          uniforms: {
            uTime: { value: 0 },
            uPulse: { value: 0.025 },
            uColor: { value: new THREE.Color(0x35c5ff) },
            uOuterColor: { value: new THREE.Color(0xbceeff) },
            uIntensity: { value: 0.38 },
            uUnit: { value: 13.5 / coronaReach },
            uFalloff: { value: 4.6 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
      corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), coronaMaterial);
      corona.scale.setScalar(coronaReach);
      corona.renderOrder = 3;
      scene.add(corona);
    }
    if (centralStar) {
      const starStock = centralStar.userData.stock as MarketMapItem,
        { cool, warm, hot } = starPalette(
          colorsRef.current.get(starStock.code) ?? colorFor(starStock.code),
        ),
        starMat = blueStarMaterial as THREE.ShaderMaterial | null;
      if (starMat) {
        starMat.uniforms.uCool.value = cool;
        starMat.uniforms.uWarm.value = warm;
        starMat.uniforms.uHot.value = hot;
      }
      scene.traverse((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          !(object.material instanceof THREE.ShaderMaterial)
        )
          return;
        const uniforms = object.material.uniforms;
        if (uniforms.uOuterColor && uniforms.uColor) {
          uniforms.uColor.value = warm.clone().lerp(hot, 0.28);
          uniforms.uOuterColor.value = hot;
        }
      });
    }
    const labels = document.createElement("div");
    labels.className = "orbit-label-layer";
    host.appendChild(labels);
    const focusBody = (
      body: THREE.Object3D,
      revealDetails = true,
      viewStyle = -1,
    ) => {
      const stock = body.userData.stock as MarketMapItem;
      reportMarketOrbitEvent({
        action: "celestial_focus",
        market: trackingMarket,
        sector: stock.sector,
        code: stock.code,
        name: stock.name,
        detail: revealDetails ? "상세 표시" : "포커스만",
      });
      focusTarget = body;
      if (viewStyle < 0) {
        tourStage = null;
        tourPlanetTarget = null;
      }
      focusViewStyle = viewStyle;
      focusFlightStartedAt = performance.now();
      flying = true;
      lastFocusPosition.copy(body.position);
      // While inspecting a body, zoom around that body's centre. Combining
      // zoomToCursor's moving target with the focus lock below can push the camera
      // back toward the preset focus distance after a wheel-in gesture.
      controls.zoomToCursor = false;
      controls.target.copy(body.position);
      if (revealDetails) {
        // A direct selection belongs to the user, so keep its inspection deck open
        // throughout the camera move. Closing and remounting it on arrival made a
        // normal click look like a failed selection and discarded panel context.
        onSelect(stock);
      }
    };
    const focusStarByTap = (body: THREE.Object3D) => {
      const alreadyFocused = focusTarget === body && !flying;
      if (alreadyFocused) {
        const stock = body.userData.stock as MarketMapItem;
        reportMarketOrbitEvent({
          action: "detail_open",
          market: trackingMarket,
          sector: stock.sector,
          code: stock.code,
          name: stock.name,
        });
        onSelect(stock);
        return;
      }
      focusBody(body, false);
    };
    const externalFocus = (event: Event) => {
      const detail = (
          event as CustomEvent<
            string | { code: string; revealDetails?: boolean; viewStyle?: number }
          >
        ).detail,
        code = typeof detail === "string" ? detail : detail.code,
        revealDetails =
          typeof detail === "string" ? true : detail.revealDetails !== false,
        viewStyle = typeof detail === "string" ? -1 : (detail.viewStyle ?? -1),
        body = hit.find(
          (item) =>
            (item.userData.stock as MarketMapItem | undefined)?.code === code,
        );
      if (
        body &&
        viewStyle >= 0 &&
        centralStar
      ) {
        tourStage = body === centralStar ? "target" : "star";
        tourPlanetTarget = body === centralStar ? null : body;
        tourPlanetViewStyle = viewStyle;
        focusTarget = centralStar;
        focusViewStyle = (viewStyle + 3) % 8;
        focusFlightStartedAt = performance.now();
        tourJourneyStartedAt = focusFlightStartedAt;
        flying = true;
        controls.zoomToCursor = false;
        controls.target.copy(centralStar.position);
        lastFocusPosition.copy(centralStar.position);
      } else if (body) {
        tourStage = null;
        tourPlanetTarget = null;
        focusBody(body, revealDetails, viewStyle);
      }
    };
    window.addEventListener("kospi-orbit-focus", externalFocus);
    const resetView = () => {
      focusTarget = null;
      flying = false;
      tourStage = null;
      tourPlanetTarget = null;
      resettingView = true;
      controls.enabled = true;
      controls.zoomToCursor = true;
      onSelect(null);
    };
    window.addEventListener("kospi-orbit-reset-view", resetView);
    let sphereBrowserActive = false,
      sphereBrowserRequestedAt = 0,
      sphereBrowserBody: THREE.Object3D | null = null,
      sphereBrowserElement: HTMLElement | null = null;
    const browserPoint = new THREE.Vector3();
    const labelEntries = hit.map((o) => {
      const s = o.userData.stock as MarketMapItem,
        isStar = o === centralStar,
        sectorRank = Math.max(
          1,
          (sys?.stocks.findIndex((stock) => stock.code === s.code) ?? 0) + 1,
        ),
        el = document.createElement("button"),
        entryPoint = new THREE.Vector3();
      el.type = "button";
      el.className = `orbit-body-label ${isStar ? "orbit-star-label " : "orbit-planet-label "}${s.change_pct >= 0 ? "up" : "down"}${Math.abs(s.change_pct) >= 5 ? " orbit-extreme-move" : ""}`;
      el.innerHTML = `<span class="orbit-body-name"><em class="orbit-sector-rank rank-${Math.min(sectorRank, 4)}" title="${s.sector} 시가총액 ${sectorRank}위">${sectorRank}</em><img src="${logoUrl(s.code)}" alt=""><b>${s.name}</b></span><span class="orbit-body-change">${pct(s.change_pct)}</span>${host.clientWidth > 900 ? '<span class="orbit-company-browser-trigger">◉ 기업정보 상세 보기</span>' : ""}`;
      const openCompanyBrowser = (event: Event) => {
        event.stopPropagation();
        sphereBrowserActive = true;
        sphereBrowserRequestedAt = performance.now();
        sphereBrowserBody = o;
        onOpenCompanyBrowser(s);
      };
      el.onpointerdown = (event) => {
        if ((event.target as HTMLElement).closest(".orbit-company-browser-trigger")) {
          event.preventDefault();
          openCompanyBrowser(event);
        }
      };
      el.onclick = (event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest(".orbit-company-browser-trigger")) {
          // Keyboard activation has no pointerdown, so retain an accessible click
          // path. Pointer activation was already handled immediately above.
          if (event.detail === 0) openCompanyBrowser(event);
          return;
        }
        if (o === centralStar) focusStarByTap(o);
        else focusBody(o);
      };
      labels.appendChild(el);
      return {
        o,
        el,
        p: entryPoint,
        radius: Number(o.userData.radius) || 2,
        visible: true,
        hasTrigger: false,
        lastX: Number.NaN,
        lastY: Number.NaN,
      };
    });
    const updateLabels = (motionAlpha = 1) => {
      for (const entry of labelEntries) {
        const stock = entry.o.userData.stock as MarketMapItem;
        const hasTrigger =
          host.clientWidth > 900 && selectedRef.current?.code === stock.code;
        if (hasTrigger !== entry.hasTrigger) {
          entry.el.classList.toggle("has-company-trigger", hasTrigger);
          entry.hasTrigger = hasTrigger;
        }
        const relevantDuringFlight =
          !flying || entry.o === focusTarget || entry.o === tourPlanetTarget;
        if (!relevantDuringFlight) {
          if (entry.visible) {
            entry.el.style.visibility = "hidden";
            entry.visible = false;
          }
          continue;
        }
        entry.p.copy(entry.o.position).project(camera);
        const visible =
          entry.p.z > -1 &&
          entry.p.z < 1 &&
          entry.p.x > -1.12 &&
          entry.p.x < 1.12 &&
          entry.p.y > -1.12 &&
          entry.p.y < 1.12;
        if (visible !== entry.visible) {
          entry.el.style.visibility = visible ? "visible" : "hidden";
          entry.visible = visible;
        }
        if (!visible) continue;
        const distance = Math.max(0.1, camera.position.distanceTo(entry.o.position)),
          projectedRadius =
            (entry.radius * host.clientHeight) /
            (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance),
          rawX = (entry.p.x * 0.5 + 0.5) * host.clientWidth +
            Math.max(7, projectedRadius + 5),
          rawY = (-entry.p.y * 0.5 + 0.5) * host.clientHeight,
          isTracked = entry.o === focusTarget || entry.o === tourPlanetTarget,
          alpha = isTracked ? motionAlpha : 1,
          x = Number.isFinite(entry.lastX)
            ? entry.lastX + (rawX - entry.lastX) * alpha
            : rawX,
          y = Number.isFinite(entry.lastY)
            ? entry.lastY + (rawY - entry.lastY) * alpha
            : rawY;
        // A tiny screen-space dead zone absorbs sub-pixel camera/planet floating
        // point noise without introducing visible lag behind the celestial body.
        if (
          !Number.isFinite(entry.lastX) ||
          Math.abs(x - entry.lastX) >= 0.12 ||
          Math.abs(y - entry.lastY) >= 0.12
        ) {
          const renderedX = Math.round(x * 10) / 10,
            renderedY = Math.round(y * 10) / 10;
          entry.el.style.transform = `translate3d(${renderedX}px,${renderedY}px,0) translateY(-50%)`;
          entry.lastX = x;
          entry.lastY = y;
        }
      }
    };
    let browserVisible: boolean | null = null,
      browserCompact: boolean | null = null,
      browserTransform = "";
    const syncSphereBrowser = () => {
      if (!sphereBrowserActive || !sphereBrowserBody) return;
      if (!sphereBrowserElement?.isConnected) {
        const nextBrowserElement = host.parentElement?.querySelector<HTMLElement>(
          ".orbit-sphere-browser",
        ) ?? null;
        if (!nextBrowserElement) {
          if (performance.now() - sphereBrowserRequestedAt < 1000) return;
          sphereBrowserActive = false;
          sphereBrowserBody = null;
          return;
        }
        // A reopened archive is a new DOM node even when it occupies exactly the
        // same projected coordinates. Invalidate all write caches so its CSS
        // default `visibility:hidden` cannot survive the first sync frame.
        sphereBrowserElement = nextBrowserElement;
        browserVisible = null;
        browserCompact = null;
        browserTransform = "";
      }
      const body = sphereBrowserBody;
      browserPoint.copy(body.position).project(camera);
      const visible =
          browserPoint.z > -1 &&
          browserPoint.z < 1 &&
          Math.abs(browserPoint.x) < 1.2 &&
          Math.abs(browserPoint.y) < 1.2,
        radius = Number(body.userData.radius) || 2,
        distance = Math.max(radius + 0.01, camera.position.distanceTo(body.position)),
        focalLength =
          host.clientHeight /
          (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))),
        angularRadius = radius / Math.sqrt(Math.max(0.0001, distance * distance - radius * radius)),
        diameter = Math.max(2, angularRadius * focalLength * 2),
        x = (browserPoint.x * 0.5 + 0.5) * host.clientWidth,
        y = (-browserPoint.y * 0.5 + 0.5) * host.clientHeight;
      if (visible !== browserVisible) {
        sphereBrowserElement.style.visibility = visible ? "visible" : "hidden";
        browserVisible = visible;
      }
      const nextTransform = `translate3d(${Math.round((x - 280) * 10) / 10}px,${Math.round((y - 280) * 10) / 10}px,0) scale(${Math.round((diameter / 560) * 10000) / 10000})`;
      if (nextTransform !== browserTransform) {
        sphereBrowserElement.style.transform = nextTransform;
        browserTransform = nextTransform;
      }
      const compact = diameter < 240;
      if (compact !== browserCompact) {
        sphereBrowserElement.classList.toggle("is-compact", compact);
        browserCompact = compact;
      }
    };
    const click = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      let bestPlanet: THREE.Object3D | null = null,
        bestScore = Infinity;
      for (const body of hit) {
        if (body === centralStar) continue;
        const projected = body.position.clone().project(camera);
        if (projected.z >= 1) continue;
        const distance = Math.hypot(
            projected.x - pointer.x,
            projected.y - pointer.y,
          ),
          worldDistance = camera.position.distanceTo(body.position),
          visualRadius = Math.max(
            0.028,
            ((Number(body.userData.radius) || 1) / worldDistance) * 3.2,
          ),
          score = distance / visualRadius;
        if (score < 1 && score < bestScore) {
          bestScore = score;
          bestPlanet = body;
        }
      }
      if (bestPlanet) {
        focusBody(bestPlanet);
        return;
      }
      ray.setFromCamera(pointer, camera);
      const found = ray
        .intersectObjects(hit)
        .find((entry) => entry.object === centralStar)?.object;
      if (found) focusStarByTap(found);
    };
    renderer.domElement.addEventListener("pointerup", click);
    let raf = 0;
    const clock = new THREE.Clock();
    let lastLabelUpdate = 0,
      previousFlightState = false;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) {
        clock.getDelta();
        return;
      }
      const frameDelta = Math.min(clock.getDelta(), 0.075),
        t = clock.elapsedTime,
        nowMs = performance.now();
      if (flying !== previousFlightState) {
        labels.classList.toggle("is-flight", flying);
        previousFlightState = flying;
        lastLabelUpdate = 0;
        if (flying) {
          for (const entry of labelEntries) {
            const relevant =
              entry.o === focusTarget || entry.o === tourPlanetTarget;
            entry.el.style.visibility = relevant ? "visible" : "hidden";
            entry.visible = relevant;
          }
        }
      }
      for (let i = 0; i < movers.length; i++) {
        const x = movers[i];
        const a = x.angle + t * x.speed,
          ca = Math.cos(a),
          sa = Math.sin(a),
          cn = x.cosNode,
          sn = x.sinNode,
          ci = x.cosInclination,
          si = x.sinInclination;
        x.mesh.position.set(
          x.orbit * (ca * cn - sa * ci * sn),
          x.orbit * sa * si,
          x.orbit * (ca * sn + sa * ci * cn),
        );
        x.mesh.rotation.y = t * x.spin;
      }
      for (let i = 0; i < cloudLayers.length; i++) {
        const layer = cloudLayers[i];
        layer.mesh.rotation.y = t * layer.speed;
      }
      for (let i = 0; i < pulseLayers.length; i++) {
          const { mesh, material, baseScale, movement, highlyActive, phase } = pulseLayers[i];
          const wave = Math.sin(t * 2.2 + phase) * 0.5 + 0.5;
          mesh.scale.setScalar(
            baseScale * (1 + wave * (highlyActive ? 0.09 : 0.045)),
          );
          material.opacity =
            0.025 + movement * 0.045 + wave * (highlyActive ? 0.055 : 0.02);
      }
      if (centralStar) {
        centralStar.rotation.y = t * 0.075;
        if (blueStarMaterial) {
          blueStarMaterial.uniforms.uTime.value = t;
          blueStarMaterial.uniforms.uPulse.value =
            0.04 + Math.sin(t * 1.4) * 0.015;
          const starStock = centralStar.userData.stock as MarketMapItem,
            nextBrand = String(
              colorsRef.current.get(starStock.code) ?? colorFor(starStock.code),
            );
          if (nextBrand !== lastStarBrand) {
            const { cool, warm, hot } = starPalette(nextBrand);
            blueStarMaterial.uniforms.uCool.value.copy(cool);
            blueStarMaterial.uniforms.uWarm.value.copy(warm);
            blueStarMaterial.uniforms.uHot.value.copy(hot);
            if (coronaMaterial) {
              coronaMaterial.uniforms.uColor.value.copy(warm).lerp(hot, 0.28);
              coronaMaterial.uniforms.uOuterColor.value.copy(hot);
            }
            lastStarBrand = nextBrand;
          }
        }
        if (corona && coronaMaterial) {
          corona.quaternion.copy(camera.quaternion);
          coronaMaterial.uniforms.uTime.value = t;
          coronaMaterial.uniforms.uPulse.value =
            0.025 + Math.sin(t * 1.35) * 0.012;
        }
      }
      if (focusTarget) {
        // Once the automatic flight has finished, keep the camera in the moving
        // body's local frame. The planet continues orbiting in world space; moving
        // the camera by the exact same delta preserves the user's zoom distance and
        // viewing angle instead of making the planet appear to shrink away.
        if (!flying) {
          focusMotion.copy(focusTarget.position).sub(lastFocusPosition);
          camera.position.add(focusMotion);
          controls.target.add(focusMotion);
        }
        lastFocusPosition.copy(focusTarget.position);
        const radius = Number(focusTarget.userData.radius) || 2,
          distance = camera.position.distanceTo(focusTarget.position),
          portraitFocus =
            coarseDevice && host.clientHeight > host.clientWidth,
          focusDistance = portraitFocus
            ? Math.max(radius * 5.8, 8)
            : Math.max(radius * 3.15, 4.2);
        desiredTarget.copy(focusTarget.position);
        if (portraitFocus) desiredTarget.y -= radius * 1.55;
        if (flying) {
          const approachLeg = tourStage === "planet",
            approachAge = approachLeg ? nowMs - tourLegStartedAt : 0,
            approachT = approachLeg
              ? Math.min(1, approachAge / TOUR_APPROACH_MS)
              : 0,
            // Smootherstep: unsticks from the star gently, crosses the gap, settles
            // into the framing position instead of slamming into it.
            approachEase =
              approachT * approachT * approachT * (approachT * (approachT * 6 - 15) + 10);
          if (focusViewStyle >= 0) {
            const flightAge = nowMs - focusFlightStartedAt,
              journeyAge = nowMs - tourJourneyStartedAt,
              stageProgress = approachLeg
                ? approachEase
                : tourStage === "star"
                  ? THREE.MathUtils.smoothstep(journeyAge, 0, 4000)
                  : THREE.MathUtils.smoothstep(journeyAge, 4000, 12000),
              approachRemaining = 1 - (tourStage ? stageProgress : THREE.MathUtils.smoothstep(flightAge, 0, 4200)),
              approachSwing = approachRemaining *
                (0.12 + (focusViewStyle % 3) * 0.055);
            focusOffset
              .copy(cinematicOffsets[focusViewStyle % cinematicOffsets.length])
              .multiplyScalar(
                focusDistance *
                  distanceMultipliers[focusViewStyle % distanceMultipliers.length],
              );
            const axisStyle = focusViewStyle % 4;
            const signedSwing = axisStyle === 1
              ? -approachSwing
              : axisStyle === 2
                ? approachSwing * 0.72
                : axisStyle === 3
                  ? -approachSwing * 0.68
                  : approachSwing;
            focusOffset.applyAxisAngle(rotationAxes[axisStyle], signedSwing);
            desiredCamera.copy(focusTarget.position).add(focusOffset);
            if (approachLeg) {
              // Bow the path off the straight line so the crossing reads as a flight
              // through the system rather than a slide down a wire. The control point
              // is rebuilt each frame because the planet keeps moving along its orbit.
              tourLegSpan.subVectors(desiredCamera, tourLegFrom);
              const span = tourLegSpan.length();
              tourLegBow.copy(tourLegSpan).cross(camera.up);
              if (tourLegBow.lengthSq() < 1e-6) tourLegBow.set(0, 1, 0);
              tourLegBow.normalize();
              tourLegControl
                .addVectors(tourLegFrom, desiredCamera)
                .multiplyScalar(0.5)
                .addScaledVector(tourLegBow, span * 0.2)
                .addScaledVector(camera.up, span * 0.12);
              const inverse = 1 - approachEase;
              camera.position
                .set(0, 0, 0)
                .addScaledVector(tourLegFrom, inverse * inverse)
                .addScaledVector(tourLegControl, 2 * inverse * approachEase)
                .addScaledVector(desiredCamera, approachEase * approachEase);
            } else {
              camera.position.lerp(
                desiredCamera,
                dampAlpha(
                  tourStage === "star"
                    ? 0.82
                    : approachRates[focusViewStyle % approachRates.length],
                  frameDelta,
                ),
              );
            }
          } else {
            focusOffset.copy(camera.position).sub(controls.target);
            if (focusOffset.lengthSq() < 0.01) focusOffset.set(0.7, 0.3, 1);
            focusOffset.normalize().multiplyScalar(focusDistance);
            desiredCamera.copy(focusTarget.position).add(focusOffset);
            camera.position.lerp(desiredCamera, dampAlpha(1.95, frameDelta));
          }
          if (approachLeg) {
            // The planet is centred well before arrival, so the back half of the leg
            // is spent watching it grow. That is the shot the tour is here for.
            controls.target.lerpVectors(
              tourLegLookFrom,
              desiredTarget,
              THREE.MathUtils.smoothstep(approachT, 0, 0.45),
            );
          } else {
            controls.target.lerp(
              desiredTarget,
              dampAlpha(tourStage ? 0.9 : 3.08, frameDelta),
            );
          }
          const starFlybyComplete =
            tourStage === "star" &&
            ((nowMs - tourJourneyStartedAt > 3600 &&
              camera.position.distanceTo(focusTarget.position) <
                Math.max(radius * 5.2, 58)) ||
              nowMs - tourJourneyStartedAt >= 4000),
            tourArrivalComplete = approachLeg
              ? approachT >= 1
              : tourStage === "target" && nowMs - tourJourneyStartedAt >= 12000;
          if (starFlybyComplete || tourArrivalComplete ||
              (tourStage === null && camera.position.distanceTo(desiredCamera) < 0.18)) {
            if (tourStage === "star" && tourPlanetTarget) {
              focusTarget = tourPlanetTarget;
              focusViewStyle = tourPlanetViewStyle;
              focusFlightStartedAt = nowMs;
              lastFocusPosition.copy(tourPlanetTarget.position);
              tourStage = "planet";
              // Where the five seconds start from, captured once so the curve below
              // has fixed endpoints to interpolate between.
              tourLegStartedAt = nowMs;
              tourLegFrom.copy(camera.position);
              tourLegLookFrom.copy(controls.target);
              flying = true;
            } else if (tourArrivalComplete && focusTarget) {
              camera.position.copy(desiredCamera);
              controls.target.copy(focusTarget.position);
              flying = false;
              tourStage = "dwell";
              tourDwellOffset.copy(camera.position).sub(focusTarget.position);
            } else {
              flying = false;
              if (tourStage === "planet" && focusTarget) {
                tourStage = "dwell";
                tourDwellOffset.copy(camera.position).sub(focusTarget.position);
              } else {
                tourStage = null;
                tourPlanetTarget = null;
              }
            }
          }
        } else if (tourStage === "dwell") {
          camera.position.copy(focusTarget.position).add(tourDwellOffset);
          controls.target.copy(focusTarget.position);
        } else if (distance <= Math.max(110, radius * 18)) {
          controls.target.copy(desiredTarget);
        } else {
          focusTarget = null;
          controls.zoomToCursor = true;
        }
      }
      if (resettingView) {
        camera.position.lerp(defaultCameraPosition, dampAlpha(4.68, frameDelta));
        controls.target.lerp(defaultCameraTarget, dampAlpha(5.65, frameDelta));
        if (
          camera.position.distanceTo(defaultCameraPosition) < 0.12 &&
          controls.target.distanceTo(defaultCameraTarget) < 0.05
        ) {
          camera.position.copy(defaultCameraPosition);
          controls.target.copy(defaultCameraTarget);
          resettingView = false;
        }
      }
      controls.update(frameDelta);
      syncSphereBrowser();
      const labelInterval = flying ? 0 : labelEntries.length > 35 ? 50 : 33;
      if (nowMs - lastLabelUpdate >= labelInterval) {
        updateLabels(
          flying
            ? dampAlpha(13.5, frameDelta)
            : focusTarget
              ? dampAlpha(18, Math.max(frameDelta, labelInterval / 1000))
              : 1,
        );
        lastLabelUpdate = nowMs;
      }
      if (composer && !sphereBrowserActive && !flying && !resettingView)
        composer.render();
      else renderer.render(scene, camera);
    };
    animate();
    onReady();
    const releaseAutoFocus = () => {
      flying = false;
      controls.enabled = true;
    };
    const releaseAutoFocusFromWheel = () => {
      // Capture the wheel before OrbitControls updates so no animation frame can
      // apply the old automatic flight destination after the user's zoom command.
      flying = false;
    };
    controls.addEventListener("start", releaseAutoFocus);
    renderer.domElement.addEventListener(
      "wheel",
      releaseAutoFocusFromWheel,
      true,
    );
    const resize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
      composer?.setSize(host.clientWidth, host.clientHeight);
    };
    addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      (scene.userData as { disposeDesigns?: () => void }).disposeDesigns?.();
      window.clearTimeout(designTimer);
      removeEventListener("resize", resize);
      window.removeEventListener("kospi-orbit-focus", externalFocus);
      window.removeEventListener("kospi-orbit-reset-view", resetView);
      renderer.domElement.removeEventListener("pointerup", click);
      renderer.domElement.removeEventListener(
        "wheel",
        releaseAutoFocusFromWheel,
        true,
      );
      controls.dispose();
      composer?.dispose();
      backgroundTexture?.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      host.replaceChildren();
    };
  }, [systems, mode.sector, onSelect, onOpenCompanyBrowser, logoUrl, colorUrl, trackingMarket]);
  useEffect(() => {
    if (selected) {
      /* selection is presented by the React inspection deck */
    }
  }, [selected]);
  return <div className="orbit-stage" ref={mount} />;
}

function OrbitDetailPanel({
  stock,
  comparisonStock,
  rank,
  onClose,
  config,
  isFavorite,
  onToggleFavorite,
  isCompareBase,
  onToggleCompare,
  onShare,
}: {
  stock: MarketMapItem;
  comparisonStock: MarketMapItem;
  rank: number;
  onClose: () => void;
  config: OrbitConfig;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isCompareBase: boolean;
  onToggleCompare: () => void;
  onShare: () => void;
}) {
  const [tab, setTab] = useState<"discussion" | "news">("discussion"),
    [intro, setIntro] = useState<string[]>([]),
    [introLoading, setIntroLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setTab("discussion");
    setIntro([]);
    setIntroLoading(true);
    api
      .overview(stock.code)
      .then((result) => {
        if (active) setIntro(result.overview.filter(Boolean).slice(0, 3));
      })
      .catch(() => {
        if (active) setIntro([]);
      })
      .finally(() => {
        if (active) setIntroLoading(false);
      });
    return () => {
      active = false;
    };
  }, [stock.code]);
  const fallback = `${stock.name}은(는) ${stock.sector} 업종에 속한 ${config.label} 상장기업입니다. 주요 사업과 시장 현황은 종목 상세정보에서 확인할 수 있습니다.`;
  const stockCap = config.capOf(stock),
    comparisonCap = config.capOf(comparisonStock),
    capGap = Math.max(0, comparisonCap - stockCap),
    isLeader = rank === 1;
  const formatCap = (value: number) =>
    config.currency === "USD"
      ? value >= 1e12
        ? `$${(value / 1e12).toFixed(2)}T`
        : `$${(value / 1e9).toFixed(1)}B`
      : money(value);
  return (
    <aside className="orbit-detail">
      <button
        className="orbit-close"
        onClick={() => {
          reportMarketOrbitEvent({
            action: "detail_close",
            market: config.label,
            sector: stock.sector,
            code: stock.code,
            name: stock.name,
          });
          onClose();
        }}
        aria-label="상세 패널 닫기"
      >
        ×
      </button>
      <div className="orbit-hero">
        <img src={config.logoUrl(stock.code)} alt="" />
        <div className="orbit-hero-copy">
          <small>
            {stock.sector} · {config.label}
          </small>
          <div className="orbit-hero-title">
            <h2>{stock.name}</h2>
            <span>{stock.code}</span>
          </div>
          <p className={introLoading ? "is-loading" : ""}>
            {introLoading
              ? "기업 소개를 불러오는 중입니다…"
              : intro.length
                ? intro.join(" ")
                : fallback}
          </p>
        </div>
      </div>
      <div className="orbit-detail-actions">
        <button type="button" className={isFavorite ? "active" : ""} onClick={onToggleFavorite}>
          <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
          {isFavorite ? "관심 행성" : "관심 추가"}
        </button>
        <button type="button" className={isCompareBase ? "active" : ""} onClick={onToggleCompare}>
          <span aria-hidden="true">⇄</span>
          {isCompareBase ? "비교 해제" : "비교 기준"}
        </button>
        <button type="button" onClick={onShare}>
          <span aria-hidden="true">↗</span>
          행성 공유
        </button>
      </div>
      <div className="orbit-price">
        <strong>
          {stock.close.toLocaleString()}
          <small> {config.currency}</small>
        </strong>
        <em className={stock.change_pct >= 0 ? "up" : "down"}>
          {pct(stock.change_pct)}
        </em>
      </div>
      <div className="orbit-stats">
        <div>
          <span>시가총액</span>
          <b>{formatCap(stockCap)}</b>
        </div>
        <div>
          <span>거래량</span>
          <b>{(stock.volume ?? 0).toLocaleString()}</b>
        </div>
        <div>
          <span>PER</span>
          <b>{stock.per?.toFixed(2) ?? "—"}</b>
        </div>
        <div>
          <span>외국인</span>
          <b>{stock.foreign_ratio?.toFixed(2) ?? "—"}%</b>
        </div>
      </div>
      <div className="orbit-cap-compare">
        <span>
          {isLeader ? "업종 시가총액 순위" : "바로 위 동일업종 상위 시총 종목"}
        </span>
        <div>
          <img src={config.logoUrl(comparisonStock.code)} alt="" />
          <p>
            <b>{comparisonStock.name}</b>
            <small>
              업종 시총 {isLeader ? 1 : rank - 1}위 · {formatCap(comparisonCap)}
            </small>
          </p>
          <strong>{isLeader ? "업종 1위" : `-${formatCap(capGap)}`}</strong>
        </div>
      </div>
      <div className="orbit-tabs" role="tablist" aria-label="종목 콘텐츠">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "discussion"}
          className={tab === "discussion" ? "active" : ""}
          onClick={() => {
            reportMarketOrbitEvent({
              action: "tab_switch",
              market: config.label,
              code: stock.code,
              name: stock.name,
              detail: "종목토론",
            });
            setTab("discussion");
          }}
        >
          종목토론
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "news"}
          className={tab === "news" ? "active" : ""}
          onClick={() => {
            reportMarketOrbitEvent({
              action: "tab_switch",
              market: config.label,
              code: stock.code,
              name: stock.name,
              detail: "NEWS",
            });
            setTab("news");
          }}
        >
          NEWS
        </button>
        <button
          type="button"
          className="orbit-detail-link"
          onClick={() => {
            reportMarketOrbitEvent({
              action: "stock_detail",
              market: config.label,
              sector: stock.sector,
              code: stock.code,
              name: stock.name,
            });
            const detailPath =
              config.key === "nasdaq100"
                ? `/global?code=${encodeURIComponent(stock.code)}`
                : `/desk?code=${encodeURIComponent(stock.code)}`;
            navigate(detailPath);
          }}
        >
          종목 상세 ↗
        </button>
      </div>
      <div className="orbit-tabbody">
        {tab === "discussion" ? (
          <StockDiscussionTab
            key={`discussion-${stock.code}`}
            code={stock.code}
            name={stock.name}
            market={config.label}
            source={config.discussion}
            trackingContext="orbit"
          />
        ) : (
          <StockNewsTab
            key={`news-${stock.code}`}
            code={stock.code}
            name={stock.name}
            market={config.label}
            source={config.news}
            trackingContext="orbit"
          />
        )}
      </div>
    </aside>
  );
}

type WarpStar = {
  /** Distance from the tunnel axis, in focal units — fixed, so travel is pure z. */
  offset: number;
  theta: number;
  z: number;
  tone: string;
  width: number;
  /** Per-star trail scale. Without it every tail bottoms out at the same depth and
      their inner ends line up into a visible ring around the core. */
  trail: number;
};

type WarpWisp = {
  /** Radius of the tunnel wall this streak lies on. */
  wall: number;
  theta: number;
  z: number;
  /** How far back along z the streak smears, and how wide it is in radians. */
  depth: number;
  span: number;
  tone: string;
  weight: number;
};

/* The hyperspace jump in the order Star Wars does it: a still field of points, a hard
   snap where every star stretches into a line at once, and then the mottled blue tunnel
   it settles into. The snap is the shot — `punch` is deliberately front-loaded so the
   stretch happens in a fraction of the time the tunnel afterwards holds for, which is
   what separates a jump from a steady stream of spokes.

   Everything reads off one 0..1 progress, so `brief` only has to compress the clock. */
function OrbitWarpCanvas({ brief }: { brief: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const TAU = Math.PI * 2,
      coarse = matchMedia("(pointer: coarse)").matches,
      random = (min: number, max: number) => min + Math.random() * (max - min),
      pick = (list: string[]) => list[(Math.random() * list.length) | 0],
      // Blue-white only. Warm tones turn this into Star Trek's rainbow tunnel.
      starTones = ["#ffffff", "#e6f6ff", "#a8dcff", "#79beff", "#d8deff"],
      wispTones = ["#f2fbff", "#b6e3ff", "#69b6ff", "#c9d8ff"],
      stars: WarpStar[] = Array.from({ length: coarse ? 260 : 640 }, () => ({
        offset: random(0.04, 1.35),
        theta: Math.random() * TAU,
        z: random(0.07, 1),
        tone: pick(starTones),
        width: random(0.4, 1.35),
        trail: random(0.55, 1.4),
      })),
      wisps: WarpWisp[] = Array.from({ length: coarse ? 30 : 62 }, () => ({
        wall: random(0.4, 1.7),
        theta: Math.random() * TAU,
        z: random(0.06, 1.15),
        depth: random(0.3, 1.5),
        span: random(0.03, 0.15),
        tone: pick(wispTones),
        weight: random(0.3, 1),
      }));
    let width = 1,
      height = 1,
      raf = 0;
    const startedAt = performance.now(),
      resize = () => {
        const ratio = Math.min(devicePixelRatio, coarse ? 1 : 1.5);
        width = canvas.clientWidth;
        height = canvas.clientHeight;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      },
      respawn = (star: WarpStar) => {
        star.offset = random(0.04, 1.35);
        star.theta = Math.random() * TAU;
        star.z = 1;
        star.trail = random(0.55, 1.4);
      },
      render = (now: number) => {
        const elapsed = (now - startedAt) / 1000,
          duration = brief ? 1.7 : 4.4,
          progress = Math.min(1, elapsed / duration),
          // The snap. Raising it to a fractional power front-loads it hard: half the
          // stretch is spent in the first fifth of the window, so it reads as one
          // event rather than a ramp.
          punch = Math.pow(THREE.MathUtils.smoothstep(progress, 0.13, 0.29), 0.4),
          tunnel = THREE.MathUtils.smoothstep(progress, 0.25, 0.52),
          deceleration = 1 - THREE.MathUtils.smoothstep(progress, 0.82, 1),
          // A triangular spike at the instant of the snap — the light the jump throws,
          // not a fade.
          flash = Math.max(0, 1 - Math.abs(progress - 0.21) / 0.07),
          // 0.0009 is the near-still creep before the jump: enough that the field is
          // alive, far too slow to leave a trail.
          speed = (0.0009 + punch * 0.052) * deceleration,
          tailReach = speed * (1.6 + punch * 130),
          // A slow roll around the axis. The tunnel drifts; it does not spin.
          roll = elapsed * 0.11,
          focal = Math.min(width, height) * 0.72,
          axisX = width * 0.5 + Math.sin(elapsed * 0.7) * width * 0.009,
          axisY = height * 0.49 + Math.cos(elapsed * 0.52) * height * 0.007;
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = "lighter";

        // ── the tunnel wall: soft radial smears at assorted depths and widths, which
        // is what makes it read as mottled cloud rather than a clean gradient ──
        if (tunnel > 0.01) {
          context.lineCap = "butt";
          for (const wisp of wisps) {
            wisp.z -= speed * 0.82;
            if (wisp.z < 0.05) {
              wisp.z = random(0.95, 1.3);
              wisp.theta = Math.random() * TAU;
              wisp.wall = random(0.4, 1.7);
            }
            const farZ = wisp.z + wisp.depth,
              angle = wisp.theta + roll,
              cos = Math.cos(angle),
              sin = Math.sin(angle),
              outer = (wisp.wall / wisp.z) * focal,
              inner = (wisp.wall / farZ) * focal;
            if (inner > Math.hypot(width, height)) continue;
            const outerX = axisX + cos * outer,
              outerY = axisY + sin * outer,
              innerX = axisX + cos * inner,
              innerY = axisY + sin * inner,
              gradient = context.createLinearGradient(innerX, innerY, outerX, outerY);
            gradient.addColorStop(0, "transparent");
            gradient.addColorStop(0.45, `${wisp.tone}3a`);
            gradient.addColorStop(1, "transparent");
            context.strokeStyle = gradient;
            context.globalAlpha = tunnel * deceleration * wisp.weight * 0.5;
            context.lineWidth = Math.max(1, wisp.span * (inner + outer) * 0.5);
            context.beginPath();
            context.moveTo(innerX, innerY);
            context.lineTo(outerX, outerY);
            context.stroke();
          }
        }

        // ── the stars: points until the snap, lines after it ──
        context.lineCap = "round";
        for (const star of stars) {
          star.z -= speed;
          if (star.z < 0.028) {
            respawn(star);
            continue;
          }
          const tailZ = Math.min(2.6, star.z + tailReach * star.trail),
            angle = star.theta + roll,
            cos = Math.cos(angle),
            sin = Math.sin(angle),
            headScale = (star.offset / star.z) * focal,
            tailScale = (star.offset / tailZ) * focal,
            headX = axisX + cos * headScale,
            headY = axisY + sin * headScale,
            proximity = 1 - Math.min(1, star.z),
            alpha = Math.min(0.95, (0.14 + proximity * 0.86) * deceleration);
          if (
            headX < -140 || headX > width + 140 ||
            headY < -140 || headY > height + 140
          ) {
            respawn(star);
            continue;
          }
          context.globalAlpha = alpha;
          // Before the snap there is no trail to draw, and a zero-length gradient is
          // undefined anyway, so the field is genuinely a field of points.
          if (headScale - tailScale < 1.4) {
            context.fillStyle = star.tone;
            context.beginPath();
            context.arc(headX, headY, star.width * 0.7 + proximity * 0.5, 0, TAU);
            context.fill();
            continue;
          }
          const tailX = axisX + cos * tailScale,
            tailY = axisY + sin * tailScale,
            gradient = context.createLinearGradient(tailX, tailY, headX, headY);
          gradient.addColorStop(0, "transparent");
          gradient.addColorStop(0.62, `${star.tone}66`);
          gradient.addColorStop(1, star.tone);
          context.strokeStyle = gradient;
          context.lineWidth = star.width + proximity * (1.1 + punch * 0.8);
          context.beginPath();
          context.moveTo(tailX, tailY);
          context.lineTo(headX, headY);
          context.stroke();
        }

        // ── the core everything converges on ──
        if (tunnel > 0.01) {
          const coreRadius =
              Math.min(width, height) *
              (0.045 + tunnel * 0.17 + Math.sin(elapsed * 6.2) * 0.005),
            core = context.createRadialGradient(axisX, axisY, 0, axisX, axisY, coreRadius);
          core.addColorStop(0, "#ffffff");
          core.addColorStop(0.24, "#dff2ffcc");
          core.addColorStop(0.55, "#59a8ff4d");
          core.addColorStop(1, "transparent");
          context.globalAlpha = tunnel * deceleration;
          context.fillStyle = core;
          context.beginPath();
          context.arc(axisX, axisY, coreRadius, 0, TAU);
          context.fill();
        }

        if (flash > 0) {
          context.globalAlpha = flash * flash * 0.24;
          context.fillStyle = "#eaf6ff";
          context.fillRect(0, 0, width, height);
        }

        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
        if (progress < 1) raf = requestAnimationFrame(render);
      };
    resize();
    addEventListener("resize", resize);
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
    };
  }, [brief]);
  return <canvas ref={canvasRef} className="orbit-cinematic-warp" aria-hidden="true" />;
}

type CompanyArchiveData = {
  title: string;
  overview: string;
  history: string;
  business: string;
  values: string;
  founded: string;
  sourceUrl: string;
  officialUrl: string;
};

const archiveSection = (extract: string, keywords: string[]) => {
  const lines = extract.split("\n").map((part) => part.trim()),
    headingIndex = lines.findIndex(
    (line) =>
      line.length > 0 &&
      line.length < 80 &&
      keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase())),
  );
  if (headingIndex < 0) return "";
  const content: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    const looksLikeNextHeading =
      content.length > 0 &&
      line.length < 55 &&
      !/[.!?。]$/.test(line) &&
      !/(이다|한다|있다|였다|된다)$/.test(line);
    if (looksLikeNextHeading) break;
    content.push(line);
    if (content.join("\n\n").length >= 1800) break;
  }
  return content.join("\n\n").slice(0, 1800);
};

const conciseArchiveText = (text: string, limit = 1050) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const candidate = normalized.slice(0, limit),
    sentenceEnd = Math.max(
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf("? "),
      candidate.lastIndexOf("! "),
    );
  return candidate
    .slice(0, sentenceEnd > limit * 0.55 ? sentenceEnd + 1 : limit)
    .trim();
};

type WikiPage = {
  title: string;
  extract?: string;
  fullurl?: string;
  missing?: string;
  pageprops?: { wikibase_item?: string };
  langlinks?: Array<{ "*": string }>;
};

type WikiResponse = {
  query?: {
    pages?: Record<string, WikiPage>;
    redirects?: Array<{ from: string; to: string }>;
    normalized?: Array<{ from: string; to: string }>;
  };
};

const wikiQuery = async (language: string, params: Record<string, string>) => {
  const query = new URLSearchParams({ action: "query", format: "json", origin: "*", ...params }),
    response = await fetch(`https://${language}.wikipedia.org/w/api.php?${query}`);
  if (!response.ok) throw new Error("Wikipedia request failed");
  return (await response.json()) as WikiResponse;
};

const ARCHIVE_EXTRACT_PARAMS = {
  prop: "extracts|info|pageprops",
  explaintext: "1",
  exsectionformat: "plain",
  inprop: "url",
};

/* The roster carries exchange listing descriptions, not company names — "Sandisk
 * Corporation Common Stock", "Alphabet Inc. Class C Capital Stock". Handed to a
 * full-text search, those trailing security terms outweigh the company itself and the
 * top hit comes back as an article *about stock*: "Sandisk Corporation Common Stock"
 * resolved to "List of S&P 500 companies", whose Korean counterpart is 네슬레 — which
 * is how a SanDisk page ended up describing a Swiss food company. Strip the security
 * type before anything is looked up. */
const companySearchName = (raw: string) => {
  let name = raw.trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const stripped = name
      .replace(/\s*[-–—]\s*$/, "")
      .replace(/\b(american\s+)?depositary\s+(shares?|receipts?)\s*$/i, "")
      .replace(/\b(common|capital|ordinary|preferred|voting)\s+(stock|shares?)\s*$/i, "")
      .replace(/\bclass\s+[a-z]\s*$/i, "")
      .replace(/[,\s]+$/, "")
      .trim();
    if (stripped === name || !stripped) break;
    name = stripped;
  }
  return name || raw.trim();
};

/** The same name without its corporate suffix — "Astera Labs, Inc." → "Astera Labs",
 *  "ASML Holding NV" → "ASML". Wikipedia titles companies both ways, so both forms
 *  are worth asking for by title. */
const bareCompanyName = (name: string) => {
  let bare = name.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = bare
      .replace(
        /[,.]?\s*\b(incorporated|inc|corporation|corp|company|co|holdings?|group|plc|ltd|limited|ag|nv|n\.v|sa|s\.a|se|ab|asa|oyj|kgaa)\b\.?\s*$/i,
        "",
      )
      .replace(/[,\s]+$/, "")
      .trim();
    if (stripped === bare || !stripped) break;
    bare = stripped;
  }
  return bare || name;
};

/** Articles that a company search plausibly surfaces and that are never the company. */
const ARCHIVE_TITLE_BLOCKLIST =
  /^(list|history|timeline|index|outline|glossary|comparison)\s+of\b|\(disambiguation\)|^share class$/i;

const archiveToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "");

/** How well an article answers "is this that company?", or -1 to reject it outright.
 *  Rejecting is the point: a confidently wrong company is worse than no article. */
const archiveArticleScore = (page: WikiPage, rawName: string, viaRedirect: boolean) => {
  const extract = page.extract?.trim() ?? "";
  if (extract.length < 80) return -1;
  if (ARCHIVE_TITLE_BLOCKLIST.test(page.title.trim())) return -1;
  // A redirect from the name we asked for is Wikipedia itself asserting the two are
  // the same subject (현대차 → 현대자동차, 신한지주 → 신한금융지주). Nothing textual
  // beats that, and the short trading names never match their article title.
  if (viaRedirect) return 4;
  const target = archiveToken(bareCompanyName(companySearchName(rawName)));
  if (target.length < 2) return -1;
  const title = archiveToken(page.title);
  if (title === target) return 3;
  if (title.includes(target) || target.includes(title)) return 2;
  // A company's article names it in the opening sentence. An article that only
  // mentions it further down is an article about something else.
  return archiveToken(extract.slice(0, 300)).includes(target) ? 1 : -1;
};

const bestArchiveArticle = (
  response: WikiResponse,
  rawName: string,
  requested: string[],
) => {
  const asked = new Set(requested.map((name) => name.toLowerCase())),
    redirected = new Set(
      (response.query?.redirects ?? [])
        .filter((hop) => asked.has(hop.from.toLowerCase()))
        .map((hop) => hop.to.toLowerCase()),
    ),
    ranked = Object.values(response.query?.pages ?? {})
      .filter((page) => page.missing === undefined)
      .map((page) => ({
        page,
        score: archiveArticleScore(page, rawName, redirected.has(page.title.toLowerCase())),
      }))
      .filter((entry) => entry.score >= 1)
      .sort(
        (a, b) => b.score - a.score || (b.page.extract?.length ?? 0) - (a.page.extract?.length ?? 0),
      );
  return ranked[0]?.page ?? null;
};

/** Resolves a roster name to the article that is actually about that company, by
 *  exact title first (which follows Wikipedia's own redirects) and only then by
 *  search — every candidate verified either way. Returns null rather than a guess. */
const resolveCompanyArticle = async (language: string, rawName: string) => {
  const searchName = companySearchName(rawName),
    bare = bareCompanyName(searchName),
    candidates = Array.from(
      new Set([searchName, bare, `${bare} (company)`, `${bare} (기업)`].filter(Boolean)),
    ),
    byTitle = await wikiQuery(language, {
      ...ARCHIVE_EXTRACT_PARAMS,
      titles: candidates.join("|"),
      redirects: "1",
    }),
    titled = bestArchiveArticle(byTitle, rawName, candidates);
  if (titled) return titled;
  const searched = await wikiQuery(language, {
    ...ARCHIVE_EXTRACT_PARAMS,
    generator: "search",
    gsrsearch: searchName,
    gsrlimit: "5",
  });
  return bestArchiveArticle(searched, rawName, []);
};

/** The Korean article for an English one, via Wikipedia's own language link. The
 *  NASDAQ path used to re-run a full-text search on ko.wikipedia with the English
 *  title, which is where "List of S&P 500 companies" became 네슬레. A langlink cannot
 *  drift: it is the same subject by definition. */
const koreanCompanyArticle = async (englishTitle: string) => {
  const linked = await wikiQuery("en", {
      titles: englishTitle,
      redirects: "1",
      prop: "langlinks",
      lllang: "ko",
      lllimit: "1",
    }),
    koreanTitle = Object.values(linked.query?.pages ?? {})[0]?.langlinks?.[0]?.["*"];
  if (!koreanTitle) return null;
  const korean = await wikiQuery("ko", {
      prop: "extracts|info",
      explaintext: "1",
      exsectionformat: "plain",
      inprop: "url",
      titles: koreanTitle,
      redirects: "1",
    }),
    page = Object.values(korean.query?.pages ?? {})[0];
  return page && page.missing === undefined && page.extract ? page : null;
};

function OrbitCompanyArchive({
  stock,
  config,
  peers,
}: {
  stock: MarketMapItem;
  config: OrbitConfig;
  peers: MarketMapItem[];
}) {
  const [archive, setArchive] = useState<CompanyArchiveData | null>(null),
    [failed, setFailed] = useState(false),
    [pricePoints, setPricePoints] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    setArchive(null);
    setFailed(false);
    setPricePoints([]);
    const language = config.key === "nasdaq100" ? "en" : "ko";
    void (async () => {
      const [page, localOverview, history] = await Promise.all([
        resolveCompanyArticle(language, stock.name),
        config.key === "nasdaq100"
          ? Promise.resolve({ overview: [] as string[] })
          : api.overview(stock.code).catch(() => ({ overview: [] as string[] })),
        api.history(stock.code, 1).catch(() => ({ points: [] })),
      ]);
      if (!page?.extract) throw new Error("No company article");
      const extract = page.extract,
        blocks = extract.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean),
        wikidataId = page.pageprops?.wikibase_item;
      let officialUrl = "",
        founded = "";
      if (wikidataId) {
        try {
          const entityResponse = await fetch(
            `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`,
          );
          const entityJson = (await entityResponse.json()) as {
            entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }>;
          };
          const claims = entityJson.entities?.[wikidataId]?.claims ?? {},
            websiteValue = claims.P856?.[0]?.mainsnak?.datavalue?.value,
            foundedValue = claims.P571?.[0]?.mainsnak?.datavalue?.value as
              | { time?: string }
              | undefined;
          if (typeof websiteValue === "string") officialUrl = websiteValue;
          if (foundedValue?.time) {
            const match = foundedValue.time.match(/\+?(\d{4})-(\d{2})-(\d{2})/);
            if (match)
              founded = `${match[1]}년${match[2] !== "00" ? ` ${Number(match[2])}월` : ""}${match[3] !== "00" ? ` ${Number(match[3])}일` : ""}`;
          }
        } catch {
          // The article itself remains useful when Wikidata is temporarily unavailable.
        }
      }
      const localBusiness = localOverview.overview.filter(Boolean).join(" "),
        rawArchive = {
          title: page.title,
          overview: conciseArchiveText(blocks[0] || localBusiness),
          history: conciseArchiveText(archiveSection(extract, ["역사", "연혁", "창립", "history", "founding", "origins"])),
          business:
            conciseArchiveText(
              localBusiness ||
              archiveSection(extract, ["사업 분야", "사업", "제품", "operations", "business", "products", "services"]),
            ),
          values: conciseArchiveText(archiveSection(extract, ["기업 철학", "경영 철학", "사회 공헌", "culture", "mission", "corporate affairs", "sustainability"])),
        };
      if (config.key === "nasdaq100") {
        try {
          const koreanPage = await koreanCompanyArticle(page.title),
            koreanExtract = koreanPage?.extract?.trim() ?? "";
          if (koreanExtract && /[가-힣]/.test(koreanExtract)) {
            const koreanBlocks = koreanExtract
              .split(/\n{2,}/)
              .map((part) => part.trim())
              .filter(Boolean);
            rawArchive.title = koreanPage?.title || rawArchive.title;
            rawArchive.overview = conciseArchiveText(koreanBlocks[0] || "");
            rawArchive.history = conciseArchiveText(
              archiveSection(koreanExtract, ["역사", "연혁", "창립", "설립"]),
            ) || rawArchive.history;
            rawArchive.business = conciseArchiveText(
              archiveSection(koreanExtract, ["사업", "제품", "서비스", "사업 분야"]),
            ) || rawArchive.business;
            rawArchive.values = conciseArchiveText(
              archiveSection(koreanExtract, ["기업 문화", "경영", "사회 공헌", "환경", "철학"]),
            ) || rawArchive.values;
          }
        } catch {
          // The shortened English excerpts below remain available for translation.
        }
        try {
          const archiveKeys = ["title", "overview", "history", "business", "values"] as const,
            untranslatedKeys = archiveKeys.filter(
              (key) => rawArchive[key] && !/[가-힣]/.test(rawArchive[key]),
            ),
            sourceTexts = untranslatedKeys.map((key) => rawArchive[key]),
            translated = sourceTexts.length
              ? await api.translateToKorean(sourceTexts)
              : { translations: [] as string[] };
          sourceTexts.forEach((_, index) => {
            const korean = translated.translations[index]?.trim();
            if (korean && /[가-힣]/.test(korean)) {
              rawArchive[untranslatedKeys[index]] = korean;
            }
          });
        } catch {
          // Korean fallbacks below prevent raw English paragraphs from leaking out.
        }
        if (!/[가-힣]/.test(rawArchive.overview))
          rawArchive.overview = `${stock.name}은(는) ${stock.sector} 분야에서 사업을 전개하는 나스닥 상장 기업입니다.`;
        if (!/[가-힣]/.test(rawArchive.history)) rawArchive.history = "";
        if (!/[가-힣]/.test(rawArchive.business)) rawArchive.business = "";
        if (!/[가-힣]/.test(rawArchive.values)) rawArchive.values = "";
      }
      const data: CompanyArchiveData = {
        ...rawArchive,
        founded,
        sourceUrl: page.fullurl || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        officialUrl,
      };
      if (active) {
        setArchive(data);
        setPricePoints(history.points.slice(-90).map((point) => point.close));
      }
    })().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [stock.code, stock.name, config.key]);
  if (failed)
    return (
      <div className="orbit-company-archive is-error">
        <b>기업 아카이브를 불러오지 못했습니다.</b>
        <span>잠시 후 다시 시도하거나 원문 보기를 이용해 주세요.</span>
      </div>
    );
  if (!archive)
    return (
      <div className="orbit-company-archive is-loading">
        <i />
        <b>{stock.name} 기업 아카이브 구성 중</b>
        <span>설립·역사·사업·가치 자료를 정리하고 있습니다.</span>
      </div>
    );
  const peerRanking = [...peers].sort(
      (a, b) => config.capOf(b) - config.capOf(a),
    ),
    peerRank = Math.max(1, peerRanking.findIndex((item) => item.code === stock.code) + 1),
    peerPercentile = peers.length > 1
      ? ((peers.length - peerRank) / (peers.length - 1)) * 100
      : 100,
    prices = pricePoints.length > 1 ? pricePoints : [stock.close, stock.close],
    priceMin = Math.min(...prices),
    priceMax = Math.max(...prices),
    priceSpan = Math.max(1, priceMax - priceMin),
    pricePath = prices
      .map(
        (price, index) =>
          `${index ? "L" : "M"}${(index / (prices.length - 1)) * 300},${86 - ((price - priceMin) / priceSpan) * 72}`,
      )
      .join(" "),
    periodChange = prices[0]
      ? ((prices[prices.length - 1] / prices[0]) - 1) * 100
      : 0,
    moveGauge = THREE.MathUtils.clamp((stock.change_pct + 10) * 5, 0, 100);
  return (
    <article className="orbit-company-archive">
      <div className="orbit-archive-hero">
        <img src={config.logoUrl(stock.code)} alt="" />
        <div><small>COMPANY ARCHIVE</small><h2>{stock.name}</h2><span>{archive.title} · {stock.sector}</span></div>
      </div>
      <div className="orbit-archive-facts">
        <span><small>설립</small><b>{archive.founded || "공개 자료 확인"}</b></span>
        <span><small>시장</small><b>{config.label}</b></span>
        <span><small>종목코드</small><b>{stock.code}</b></span>
      </div>
      <nav className="orbit-archive-index"><a href="#identity">IDENTITY</a><a href="#history">HISTORY</a><a href="#business">BUSINESS</a><a href="#future">FUTURE</a><a href="#watch">WATCH</a></nav>
      <div className="orbit-archive-charts">
        <figure className="orbit-archive-price-chart">
          <figcaption><span>최근 1년 가격 궤적</span><b className={periodChange >= 0 ? "up" : "down"}>{periodChange >= 0 ? "+" : ""}{periodChange.toFixed(1)}%</b></figcaption>
          <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-label="최근 가격 추이"><path className="grid" d="M0 25H300M0 50H300M0 75H300"/><path className={periodChange >= 0 ? "line up-line" : "line down-line"} d={pricePath}/></svg>
          <footer><span>{priceMin.toLocaleString()}</span><span>{priceMax.toLocaleString()}</span></footer>
        </figure>
        <figure className="orbit-archive-position-chart">
          <figcaption><span>업종 시총 위치</span><b>{peerRank} / {peers.length}</b></figcaption>
          <div className="orbit-rank-orbit"><i style={{ left: `${peerPercentile}%` }} /><span /></div>
          <small>하위권</small><small>업종 리더</small>
          <figcaption className="move-caption"><span>오늘의 변동 강도</span><b className={stock.change_pct >= 0 ? "up" : "down"}>{pct(stock.change_pct)}</b></figcaption>
          <div className="orbit-move-gauge"><i /><span style={{ left: `${moveGauge}%` }} /></div>
        </figure>
      </div>
      <section id="identity"><small>01 · 기업 정체성</small><h3>이 기업을 한 문장으로 이해하기</h3><p>{archive.overview}</p></section>
      <section id="history"><small>02 · 설립과 진화</small><h3>현재의 기업을 만든 결정적 과정</h3><p>{archive.history || `${stock.name}의 설립 및 주요 연혁은 공개 기업 문서 원문에서 추가로 확인할 수 있습니다.`}</p></section>
      <section id="business"><small>03 · 비즈니스 엔진</small><h3>무엇을 만들고 어떻게 성장하는가</h3><p>{archive.business || `${stock.name}은(는) ${stock.sector} 분야를 중심으로 사업을 영위하고 있습니다.`}</p></section>
      <section className="orbit-archive-moat"><small>04 · 경쟁 기반</small><h3>기업을 평가할 때 확인할 힘</h3><div><span><b>시장 지위</b>업종 내 시가총액 {peerRank}위로 자본시장의 상대적 평가를 확인합니다.</span><span><b>사업 지속성</b>핵심 제품·고객·기술이 반복적인 수익으로 연결되는지 살펴봅니다.</span><span><b>차별화 근거</b>브랜드·특허·생산력·전환비용을 공식 자료에서 확인해야 합니다.</span></div></section>
      <section id="future"><small>05 · 가치와 미래</small><h3>회사가 향하려는 방향</h3><p>{archive.values || "공개 백과 자료에 별도의 기업 철학 항목이 없어 공식 기업 소개에서 최신 가치와 목적을 확인하는 것이 정확합니다."}</p></section>
      <section id="watch" className="orbit-archive-watch"><small>06 · 투자자 관찰 포인트</small><h3>기회와 위험을 함께 보기</h3><div><span className="opportunity"><b>성장 질문</b>{stock.sector} 시장의 확장이 실제 매출과 수익성 개선으로 연결되는가?</span><span className="risk"><b>위험 질문</b>경쟁 심화·기술 변화·고객 의존도가 현재 사업 기반을 약화시키는가?</span></div><p>위 질문은 투자 권유가 아닌 기업 분석을 위한 점검 항목입니다.</p></section>
      <nav>
        {archive.officialUrl && <a href={archive.officialUrl} target="_blank" rel="noreferrer">공식 기업 사이트 ↗</a>}
        <a href={archive.sourceUrl} target="_blank" rel="noreferrer">기업 문서 원문 ↗</a>
      </nav>
      <footer><b>자료 신뢰도</b> 설립·공식 사이트는 Wikidata, 기업 설명과 역사는 Wikipedia, 국내 사업 개요는 기업 공개자료 기반 데이터에서 가져왔습니다. 사실·기업 주장·분석 질문을 구분해 표시합니다.</footer>
    </article>
  );
}

export default function KospiOrbitPage({
  market = "kospi",
}: {
  market?: OrbitMarket;
}) {
  const config = ORBIT_CONFIGS[market];
  const [items, setItems] = useState<MarketMapItem[]>([]),
    [loading, setLoading] = useState(true),
    [ready, setReady] = useState(false),
    [mode, setMode] = useState<SceneMode>({ kind: "system", sector: "" }),
    [selected, setSelected] = useState<MarketMapItem | null>(null),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(""),
    [loadError, setLoadError] = useState(""),
    [sceneSlow, setSceneSlow] = useState(false),
    [warping, setWarping] = useState<OrbitMarket | null>(null),
    [briefingOpen, setBriefingOpen] = useState(
      () => !matchMedia("(max-width: 760px)").matches,
    ),
    [autoTour, setAutoTour] = useState(false),
    [tourSectorText, setTourSectorText] = useState(""),
    [shareNotice, setShareNotice] = useState(""),
    [favorites, setFavorites] = useState<Set<string>>(() => {
      try {
        return new Set(JSON.parse(localStorage.getItem("orbit-favorites") || "[]"));
      } catch {
        return new Set();
      }
    }),
    [compareBase, setCompareBase] = useState<MarketMapItem | null>(null),
    [showGuide, setShowGuide] = useState(
      () => localStorage.getItem("orbit-guide-seen") !== "1",
    ),
    [introLong] = useState(
      () =>
        new URLSearchParams(location.search).get("intro") === "full" ||
        localStorage.getItem(`orbit-cinematic-seen-${market}`) !== "1",
    ),
    [introVisible, setIntroVisible] = useState(true),
    [companyBrowser, setCompanyBrowser] = useState<{
      code: string;
      x: number;
      y: number;
    } | null>(null),
    [colors, setColors] = useState<Map<string, number>>(new Map());
  const handleSceneReady = useCallback(() => setReady(true), []);
  const handleOpenCompanyBrowser = useCallback((stock: MarketMapItem) => {
    if (innerWidth <= 900) return;
    setSelected(stock);
    setCompanyBrowser({ code: stock.code, x: 0, y: 0 });
  }, []);
  useEffect(() => {
    if (!ready || loading || loadError) return;
    const finish = () => {
      localStorage.setItem(`orbit-cinematic-seen-${market}`, "1");
      setIntroVisible(false);
    };
    const timer = window.setTimeout(finish, introLong ? 9000 : 2800);
    return () => window.clearTimeout(timer);
  }, [ready, loading, loadError, introLong, market]);
  useEffect(() => {
    if (companyBrowser && selected?.code !== companyBrowser.code)
      setCompanyBrowser(null);
  }, [companyBrowser, selected?.code, mode.sector]);
  useEffect(() => {
    if (!companyBrowser) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCompanyBrowser(null);
    };
    addEventListener("keydown", closeOnEscape);
    return () => removeEventListener("keydown", closeOnEscape);
  }, [companyBrowser]);
  const systems = useMemo(() => {
    const map = new Map<string, MarketMapItem[]>();
    items.forEach((x) => {
      const k = x.sector || "기타";
      map.set(k, [...(map.get(k) || []), x]);
    });
    return [...map]
      .map(([name, stocks]) => {
        stocks.sort((a, b) => config.capOf(b) - config.capOf(a));
        const cap = stocks.reduce((a, b) => a + config.capOf(b), 0);
        return {
          name,
          stocks,
          cap,
          change:
            stocks.reduce((a, b) => a + b.change_pct * config.capOf(b), 0) /
            cap,
        };
      })
      .sort((a, b) => b.cap - a.cap);
  }, [items, config]);
  useEffect(() => {
    loadOrbitMarket(config)
      .then((r) => {
        const visibleItems = r.items.filter(
          (item) => item.name.trim() !== "N2 KIS CD금리투자 ETN",
        );
        setItems(visibleItems);
        const p = new URLSearchParams(location.search),
          code = p.get("code"),
          sector = p.get("sector");
        const first = [...visibleItems].sort(
            (a, b) => config.capOf(b) - config.capOf(a),
          )[0],
          initialSector = sector || first?.sector || "기타";
        setMode({ kind: "system", sector: initialSector });
        setExpanded(
          matchMedia("(pointer: coarse)").matches ? "" : initialSector,
        );
        if (code) {
          const s = visibleItems.find((x) => x.code === code);
          if (s) {
            const mobileViewing = matchMedia("(max-width: 760px)").matches;
            setMode({ kind: "system", sector: s.sector || "기타" });
            setExpanded(mobileViewing ? "" : s.sector || "기타");
            if (!mobileViewing) setSelected(s);
          }
        }
      })
      .catch(() => setLoadError("종목 데이터를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [config]);
  useEffect(() => {
    if (loading || ready || loadError) {
      setSceneSlow(false);
      return;
    }
    const timeout = window.setTimeout(() => setSceneSlow(true), 12000);
    return () => window.clearTimeout(timeout);
  }, [loading, ready, loadError, mode.sector]);
  useEffect(() => {
    const targets = items.filter(
      (x) => (x.sector || "기타") === mode.sector && !colors.has(x.code),
    );
    if (!targets.length) return;
    let live = true;
    const entries: Array<readonly [string, number]> = [];
    let cursor = 0;
    const worker = async () => {
      while (live) {
        const index = cursor++;
        if (index >= targets.length) return;
        const stock = targets[index];
        entries.push([
          stock.code,
          await logoColor(stock.code, config.colorUrl),
        ] as const);
      }
    };
    Promise.all(
      Array.from({ length: Math.min(4, targets.length) }, () => worker()),
    ).then(() => {
      if (live)
        setColors((prev) => {
          const next = new Map(prev);
          entries.forEach(([code, color]) => next.set(code, color));
          return next;
        });
    });
    return () => {
      live = false;
    };
  }, [items, mode.sector, config]);
  const results = query.trim()
    ? items
        .filter((x) => x.name.includes(query) || x.code.includes(query))
        .slice(0, 7)
    : [];
  const briefing = useMemo(() => {
    const ranked = [...items],
      strongest = [...ranked].sort((a, b) => b.change_pct - a.change_pct)[0],
      weakest = [...ranked].sort((a, b) => a.change_pct - b.change_pct)[0],
      active = [...ranked].sort(
        (a, b) =>
          (b.close || 0) * (b.volume || 0) -
          (a.close || 0) * (a.volume || 0),
      )[0],
      hotSector = [...systems].sort((a, b) => b.change - a.change)[0];
    return { strongest, weakest, active, hotSector };
  }, [items, systems]);
  const openSystem = (sector: string) => {
    if (mode.sector === sector) {
      setExpanded((current) => (current === sector ? "" : sector));
      return;
    }
    reportMarketOrbitEvent({
      action: "sector_warp",
      market: config.label,
      sector,
    });
    setReady(false);
    setSelected(null);
    setExpanded(sector);
    setMode({ kind: "system", sector });
    history.replaceState(
      {},
      "",
      `${config.route}?sector=${encodeURIComponent(sector)}`,
    );
  };
  const focusStock = (stock: MarketMapItem, revealDetails = true) => {
    reportMarketOrbitEvent({
      action: "stock_focus",
      market: config.label,
      sector: stock.sector,
      code: stock.code,
      name: stock.name,
      detail: revealDetails ? "상세 표시" : "포커스만",
    });
    const closeMobileDrawer = matchMedia("(max-width: 760px)").matches;
    setExpanded(stock.sector || "기타");
    setMode({ kind: "system", sector: stock.sector || "기타" });
    setSelected(revealDetails ? stock : null);
    if (closeMobileDrawer) setExpanded("");
    history.replaceState({}, "", `${config.route}?code=${stock.code}`);
    requestAnimationFrame(() =>
      window.dispatchEvent(
        new CustomEvent("kospi-orbit-focus", {
          detail: { code: stock.code, revealDetails },
        }),
      ),
    );
  };
  useEffect(() => {
    if (!autoTour || !items.length) return;
    const tour = [...items]
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
      .slice(0, 8);
    let cursor = 0,
      resetTimer = 0,
      focusTimer = 0;
    const visit = () => {
      const viewStyle = cursor % 8,
        stock = tour[cursor++ % tour.length];
      setExpanded(stock.sector || "기타");
      setMode({ kind: "system", sector: stock.sector || "기타" });
      setSelected(null);
      resetTimer = window.setTimeout(
        () => window.dispatchEvent(new Event("kospi-orbit-reset-view")),
        160,
      );
      history.replaceState({}, "", `${config.route}?code=${stock.code}`);
      focusTimer = window.setTimeout(
        () => {
          setSelected(stock);
          window.dispatchEvent(
            new CustomEvent("kospi-orbit-focus", {
              detail: { code: stock.code, revealDetails: true, viewStyle },
            }),
          );
        },
        3000,
      );
    };
    visit();
    const timer = window.setInterval(visit, 35000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(resetTimer);
      window.clearTimeout(focusTimer);
    };
  }, [autoTour, items, config.route]);
  useEffect(() => {
    if (!autoTour) {
      setTourSectorText("");
      return;
    }
    setTourSectorText("");
    let character = 0;
    const timer = window.setInterval(() => {
      character += 1;
      setTourSectorText(mode.sector.slice(0, character));
      if (character >= mode.sector.length) window.clearInterval(timer);
    }, 75);
    return () => window.clearInterval(timer);
  }, [autoTour, mode.sector]);
  const shareSelected = async () => {
    if (!selected) return;
    const url = `${location.origin}${config.route}?code=${encodeURIComponent(selected.code)}`,
      text = `${config.label} 증시궤도 · ${selected.name} ${pct(selected.change_pct)}`;
    try {
      const canNativeShare = typeof navigator.share === "function";
      if (canNativeShare) await navigator.share({ title: text, text, url });
      else await navigator.clipboard.writeText(url);
      setShareNotice(canNativeShare ? "공유했습니다" : "링크를 복사했습니다");
    } catch {
      return;
    }
    window.setTimeout(() => setShareNotice(""), 1800);
  };
  const toggleFavorite = (stock: MarketMapItem) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(stock.code)) next.delete(stock.code);
      else next.add(stock.code);
      localStorage.setItem("orbit-favorites", JSON.stringify([...next]));
      return next;
    });
  };
  const toggleCompareBase = (stock: MarketMapItem) => {
    if (compareBase?.code === stock.code) {
      setCompareBase(null);
      setShareNotice("비교 기준을 해제했습니다");
    } else {
      setCompareBase(stock);
      setShareNotice("비교 기준 설정 완료 · 다른 행성을 선택하세요");
    }
    window.setTimeout(() => setShareNotice(""), 2200);
  };
  const closeGuide = () => {
    localStorage.setItem("orbit-guide-seen", "1");
    setShowGuide(false);
  };
  const warpTo = (target: OrbitMarket) => {
    if (target === market) return;
    reportMarketOrbitEvent({
      action: "market_warp",
      market: config.label,
      detail: ORBIT_CONFIGS[target].label,
    });
    setWarping(target);
    void loadOrbitMarket(ORBIT_CONFIGS[target]);
    window.setTimeout(() => navigate(ORBIT_CONFIGS[target].route), 720);
  };
  const companyInfoUrl = selected
    ? `https://${market === "nasdaq100" ? "en" : "ko"}.wikipedia.org/w/index.php?search=${encodeURIComponent(companySearchName(selected.name))}`
    : "";
  return (
    <main
      className={`kospi-orbit orbit-market-${market}${selected ? " has-detail" : ""}`}
    >
      {introVisible && ready && !loading && !loadError && (
        <section
          className={`orbit-cinematic ${introLong ? "is-epic" : "is-brief"}`}
          aria-label={`${config.label} 우주 진입`}
        >
          <OrbitWarpCanvas brief={!introLong} />
          <div className="orbit-cinematic-flare" aria-hidden="true" />
          <div className="orbit-cinematic-title">
            <small>ENTERING MARKET UNIVERSE</small>
            <strong>{config.label}</strong>
            <span>수많은 기업이 하나의 항성계를 이룹니다</span>
          </div>
          <div className="orbit-cinematic-progress"><i /></div>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem(`orbit-cinematic-seen-${market}`, "1");
              setIntroVisible(false);
            }}
          >
            건너뛰기
          </button>
        </section>
      )}
      {market === "kospi" ? (
        <a
          className="orbit-background-credit"
          href="https://nebulakit.itch.io/nebula-skyboxes-vol1"
          target="_blank"
          rel="noreferrer"
        >
          NebulaKit deep_field-11 · 8K 360°
        </a>
      ) : (
        <a
          className="orbit-background-credit"
          href="https://space-spheremaps.itch.io/space-spheremaps"
          target="_blank"
          rel="noreferrer"
        >
          {market === "kosdaq"
            ? "Space Spheremaps blue_nebulae_1"
            : "Space Spheremaps hazy_nebulae_1"}{" "}
          · 8K 360°
        </a>
      )}
      <header className="orbit-top">
        <Link
          to="/desk"
          className="orbit-back-link"
          aria-label="메인 대시보드로 돌아가기"
          title="뒤로가기"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <button className="orbit-brand" onClick={() => navigate("/")}>
          <i />
          K-STOCK <strong>ORBIT</strong>
        </button>
        <div className="orbit-search">
          <span className="orbit-search-icon" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="종목명 또는 코드 검색"
          />
          {results.length > 0 && (
            <div className="orbit-results">
              {results.map((s) => (
                <button
                  key={s.code}
                  onClick={() => {
                    reportMarketOrbitEvent({
                      action: "search_select",
                      market: config.label,
                      sector: s.sector,
                      code: s.code,
                      name: s.name,
                    });
                    setQuery("");
                    openSystem(s.sector || "기타");
                    setTimeout(() => setSelected(s), 180);
                  }}
                >
                  <img src={config.logoUrl(s.code)} />
                  <span>
                    <b>{s.name}</b>
                    <small>
                      {s.sector} · {s.code}
                    </small>
                  </span>
                  <em className={s.change_pct >= 0 ? "up" : "down"}>
                    {pct(s.change_pct)}
                  </em>
                </button>
              ))}
            </div>
          )}
        </div>
        <nav className="orbit-market-warp" aria-label="시장 항성계 워프">
          {(Object.keys(ORBIT_CONFIGS) as OrbitMarket[]).map((key) => (
            <button
              type="button"
              key={key}
              className={key === market ? "active" : ""}
              onClick={() => warpTo(key)}
              disabled={key === market}
            >
              <i />
              {ORBIT_CONFIGS[key].label}
            </button>
          ))}
        </nav>
        <div className="orbit-live">
          <i /> {config.label} {config.limit} LIVE
        </div>
        <button
          type="button"
          className="orbit-view-reset"
          onClick={() =>
            window.dispatchEvent(new Event("kospi-orbit-reset-view"))
          }
          aria-label="기본 카메라 시점으로 초기화"
          title="기본 카메라 시점으로 초기화"
        >
          <span aria-hidden="true">↺</span>
          <b>시점 초기화</b>
        </button>
      </header>
      {(loadError || sceneSlow) && (
        <div className="orbit-loader orbit-load-error">
          <b>
            {loadError
              ? "데이터 연결 오류"
              : "모바일 렌더링이 지연되고 있습니다"}
          </b>
          <span>
            {loadError || "기기 메모리를 정리한 뒤 다시 시도해 주세요."}
          </span>
          <button type="button" onClick={() => location.reload()}>
            다시 시도
          </button>
        </div>
      )}
      {!loadError && !sceneSlow && (!ready || loading) && (
        <div className="orbit-loader">
          <div />
          <b>{config.label} UNIVERSE</b>
          <span>
            {loading
              ? `${config.limit}개 종목 데이터를 불러오는 중`
              : "항성계를 구성하는 중"}
          </span>
        </div>
      )}
      {systems.length > 0 && (
        <SpaceScene
          systems={systems}
          mode={mode}
          selected={selected}
          colors={colors}
          onSelect={setSelected}
          onOpenCompanyBrowser={handleOpenCompanyBrowser}
          onReady={handleSceneReady}
          logoUrl={config.logoUrl}
          colorUrl={config.colorUrl}
          trackingMarket={config.label}
        />
      )}
      {selected && companyBrowser && (
        <aside
          className="orbit-sphere-browser"
          style={{ left: 0, top: 0 }}
          aria-label={`${selected.name} 기업정보 구형 브라우저`}
        >
          <div className="orbit-sphere-browser-glow" aria-hidden="true" />
          <button
            type="button"
            className="orbit-sphere-browser-close"
            onClick={() => setCompanyBrowser(null)}
            aria-label="기업 아카이브 닫기"
          >
            <span>닫기</span> ×
          </button>
          <header>
            <span><i /> CELESTIAL WEB</span>
            <b>{selected.name}</b>
            <div>
              <a href={companyInfoUrl} target="_blank" rel="noreferrer" title="새 창에서 열기">↗</a>
            </div>
          </header>
          <div className="orbit-sphere-browser-screen">
            <OrbitCompanyArchive
              stock={selected}
              config={config}
              peers={systems.find((system) => system.name === selected.sector)?.stocks ?? [selected]}
            />
          </div>
          <footer>
            <span>COMPANY ARCHIVE</span>
            <span>SCROLL TO EXPLORE</span>
          </footer>
        </aside>
      )}
      <aside className="orbit-nav">
        <div className="orbit-nav-title">다른 업종으로 워프</div>
        {systems.map((s) => (
          <div className="orbit-tree" key={s.name}>
            <button
              className={mode.sector === s.name ? "active" : ""}
              onClick={() => openSystem(s.name)}
            >
              <i
                style={{
                  background: `#${colorFor(s.stocks[0].code).toString(16).padStart(6, "0")}`,
                }}
              />
              <span>
                {s.name}
                <small>{s.stocks.length}개</small>
              </span>
              <b className={expanded === s.name ? "open" : ""}>⌄</b>
            </button>
            {expanded === s.name && (
              <div className="orbit-tree-stocks">
                {s.stocks.map((stock, index) => (
                  <button
                    key={stock.code}
                    className={`${selected?.code === stock.code ? "selected " : ""}${Math.abs(stock.change_pct) >= 5 ? `orbit-list-extreme ${stock.change_pct >= 0 ? "extreme-up" : "extreme-down"}` : ""}`}
                    onClick={() => focusStock(stock)}
                  >
                    <em>{index === 0 ? "★" : index + 1}</em>
                    <img
                      className="orbit-tree-logo"
                      src={config.logoUrl(stock.code)}
                      alt=""
                      loading="lazy"
                    />
                    <span>
                      <strong>{stock.name}</strong>
                      <small>{stock.code}</small>
                    </span>
                    <mark className={stock.change_pct >= 0 ? "up" : "down"}>
                      {pct(stock.change_pct)}
                    </mark>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </aside>
      {expanded &&
        (() => {
          const mobileSystem = systems.find(
            (system) => system.name === expanded,
          );
          if (!mobileSystem) return null;
          return (
            <div
              className="orbit-mobile-stocks"
              aria-label={`${expanded} 종목 목록`}
            >
              <div className="orbit-mobile-stocks-head">
                <b>{expanded}</b>
                <span>{mobileSystem.stocks.length}개 종목</span>
                <button
                  type="button"
                  onClick={() => setExpanded("")}
                  aria-label="종목 목록 닫기"
                >
                  ×
                </button>
              </div>
              <div className="orbit-mobile-stock-list">
                {mobileSystem.stocks.map((stock, index) => (
                  <button
                    type="button"
                    key={stock.code}
                    className={`${selected?.code === stock.code ? "selected " : ""}${Math.abs(stock.change_pct) >= 5 ? `orbit-list-extreme ${stock.change_pct >= 0 ? "extreme-up" : "extreme-down"}` : ""}`}
                    onClick={() => focusStock(stock, false)}
                  >
                    <em>{index === 0 ? "★" : index + 1}</em>
                    <img
                      src={config.logoUrl(stock.code)}
                      alt=""
                      loading="lazy"
                    />
                    <span>
                      <strong>{stock.name}</strong>
                      <small>{stock.code}</small>
                    </span>
                    <mark className={stock.change_pct >= 0 ? "up" : "down"}>
                      {pct(stock.change_pct)}
                    </mark>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      <section className="orbit-context">
        <span>SECTOR SYSTEM</span>
        <h1 className={autoTour ? "orbit-sector-typing" : ""}>
          {autoTour ? tourSectorText : mode.sector}
        </h1>
        <p>시가총액 순위가 궤도와 행성의 크기를 결정합니다</p>
        <div className="orbit-hint">
          드래그 회전 · 스크롤 확대 · 오브젝트 클릭
        </div>
      </section>
      <section className={`orbit-briefing${briefingOpen ? " open" : ""}`}>
        <button
          type="button"
          className="orbit-briefing-toggle"
          onClick={() => setBriefingOpen((value) => !value)}
          aria-expanded={briefingOpen}
        >
          <span><i /> TODAY'S ORBIT</span>
          <b>{briefingOpen ? "브리핑 닫기" : "오늘의 우주 브리핑"}</b>
        </button>
        {briefingOpen && briefing.strongest && briefing.weakest && (
          <div className="orbit-briefing-body">
            <div className="orbit-briefing-sector">
              <small>가장 강한 항성계</small>
              <button onClick={() => openSystem(briefing.hotSector.name)}>
                <b>{briefing.hotSector.name}</b>
                <em className={briefing.hotSector.change >= 0 ? "up" : "down"}>
                  {pct(briefing.hotSector.change)}
                </em>
              </button>
            </div>
            <div className="orbit-briefing-grid">
              {[
                ["급상승", briefing.strongest],
                ["급하강", briefing.weakest],
                ["거래 집중", briefing.active],
              ].map(([label, stock]) => {
                const item = stock as MarketMapItem;
                return (
                  <button key={label as string} onClick={() => focusStock(item)}>
                    <small>{label as string}</small>
                    <span><img src={config.logoUrl(item.code)} alt="" /><b>{item.name}</b></span>
                    <em className={item.change_pct >= 0 ? "up" : "down"}>{pct(item.change_pct)}</em>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={`orbit-tour-button${autoTour ? " active" : ""}`}
              onClick={() => setAutoTour((value) => !value)}
            >
              <span>{autoTour ? "■" : "▶"}</span>
              {autoTour ? "자동 탐험 멈추기" : "자동 탐험"}
            </button>
            {favorites.size > 0 && (
              <div className="orbit-favorites">
                <small>나의 관심 은하</small>
                <div>
                  {items
                    .filter((item) => favorites.has(item.code))
                    .slice(0, 5)
                    .map((item) => (
                      <button key={item.code} onClick={() => focusStock(item)}>
                        <img src={config.logoUrl(item.code)} alt="" />
                        {item.name}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      <aside className="orbit-radar" aria-label="업종 시장 레이더">
        <div><b>MARKET RADAR</b><span>{systems.length} SYSTEMS</span></div>
        <div className="orbit-radar-field">
          <i className="orbit-radar-sweep" />
          {systems.slice(0, 16).map((system, index, visible) => {
            const angle = (index / visible.length) * Math.PI * 2 - Math.PI / 2,
              distance = 27 + (index % 3) * 8;
            return (
              <button
                key={system.name}
                className={`${mode.sector === system.name ? "active " : ""}${system.change >= 0 ? "up" : "down"}`}
                style={{
                  left: `${50 + Math.cos(angle) * distance}%`,
                  top: `${50 + Math.sin(angle) * distance}%`,
                }}
                title={`${system.name} ${pct(system.change)}`}
                onClick={() => openSystem(system.name)}
              />
            );
          })}
          <span>{config.label}</span>
        </div>
        <small><i className="up" /> 상승 <i className="down" /> 하락</small>
      </aside>
      <aside className="orbit-effect-legend">
        <b>MARKET SIGNAL</b>
        <span><i className="up" /> 상승 오라</span>
        <span><i className="down" /> 하락 오라</span>
        <span><i className="active" /> 거래 집중 맥동</span>
      </aside>
      {selected &&
        (() => {
          const sectorStocks = systems.find(
              (system) => system.name === selected.sector,
            )?.stocks ?? [selected],
            rank = Math.max(
              1,
              sectorStocks.findIndex((stock) => stock.code === selected.code) +
                1,
            ),
            comparisonStock = sectorStocks[Math.max(0, rank - 2)] ?? selected;
          return (
            <OrbitDetailPanel
              stock={selected}
              comparisonStock={comparisonStock}
              rank={rank}
              config={config}
              isFavorite={favorites.has(selected.code)}
              onToggleFavorite={() => toggleFavorite(selected)}
              isCompareBase={compareBase?.code === selected.code}
              onToggleCompare={() => toggleCompareBase(selected)}
              onShare={shareSelected}
              onClose={() => setSelected(null)}
            />
          );
        })()}
      {compareBase && selected && (
        <aside className="orbit-compare-panel">
          <header><b>쌍성 비교</b><button onClick={() => setCompareBase(null)}>×</button></header>
          {compareBase.code === selected.code ? (
            <div className="orbit-compare-empty">
              <img src={config.logoUrl(compareBase.code)} alt="" />
              <p><b>{compareBase.name}</b><span>비교 기준으로 설정되었습니다.<br />다른 행성을 선택하거나 아래 후보를 선택하세요.</span></p>
              <div>
                {items
                  .filter(
                    (item) =>
                      item.code !== compareBase.code &&
                      item.sector === compareBase.sector,
                  )
                  .slice(0, 3)
                  .map((item) => (
                    <button key={item.code} onClick={() => focusStock(item)}>
                      {item.name}
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            <>
              <div>
                {[compareBase, selected].map((stock) => (
                  <article key={stock.code}>
                    <img src={config.logoUrl(stock.code)} alt="" />
                    <b>{stock.name}</b>
                    <em className={stock.change_pct >= 0 ? "up" : "down"}>{pct(stock.change_pct)}</em>
                    <span>시총 {config.capOf(stock).toLocaleString()}</span>
                    <span>거래량 {(stock.volume || 0).toLocaleString()}</span>
                  </article>
                ))}
              </div>
              <p>
                시총 차이 <b>{Math.abs(config.capOf(compareBase) - config.capOf(selected)).toLocaleString()} {config.currency}</b>
              </p>
            </>
          )}
        </aside>
      )}
      {shareNotice && <div className="orbit-share-notice">{shareNotice}</div>}
      {showGuide && (
        <div className="orbit-guide" role="dialog" aria-modal="true" aria-label="증시궤도 사용 안내">
          <div>
            <small>WELCOME TO K-STOCK ORBIT</small>
            <h2>시장을 탐험하는 세 가지 방법</h2>
            <ol>
              <li><b>01</b><span><strong>우주를 회전하세요</strong>드래그로 시점을 돌리고 휠로 확대합니다.</span></li>
              <li><b>02</b><span><strong>행성을 선택하세요</strong>시세·뉴스·토론을 한 번에 확인합니다.</span></li>
              <li><b>03</b><span><strong>오늘의 궤도를 따라가세요</strong>자동 탐험이 주요 종목을 시네마틱하게 순회합니다.</span></li>
            </ol>
            <button onClick={closeGuide}>우주 탐험 시작</button>
          </div>
        </div>
      )}
      <footer className="orbit-footer">
        <span>
          <i /> 실시간 시세 기반
        </span>
        <span>업종 {systems.length}</span>
        <span>천체 {items.length}</span>
      </footer>
      {warping && (
        <div className="orbit-warp-overlay" aria-live="polite">
          <div className="orbit-warp-tunnel" />
          <b>{ORBIT_CONFIGS[warping].label} 항성계로 워프</b>
          <span>공간 좌표를 동기화하는 중</span>
        </div>
      )}
    </main>
  );
}
