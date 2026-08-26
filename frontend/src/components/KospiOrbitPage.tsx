import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { api, type MarketMapItem, type MarketMapResponse } from "../api/client";
import { navigate } from "../router";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoUrl } from "../usLogo";
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
import StockDiscussionTab from "./StockDiscussionTab";
import StockNewsTab from "./StockNewsTab";
import "./stocksPage.css";
import "./kospiOrbit.css";

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
  onReady,
  logoUrl,
  trackingMarket,
}: {
  systems: System[];
  mode: SceneMode;
  selected: MarketMapItem | null;
  colors: Map<string, number>;
  onSelect: (s: MarketMapItem | null) => void;
  onReady: () => void;
  logoUrl: (code: string) => string;
  trackingMarket: string;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030712, 0.0009);
    let backgroundTexture: THREE.Texture | null = null;
    const backgroundPath =
      trackingMarket === "KOSPI"
        ? "/img/sky/carina-nebula-jwst-4k.webp"
        : trackingMarket === "KOSDAQ"
          ? "/img/sky/southern-ring-nebula-jwst-4k.webp"
          : trackingMarket === "NASDAQ100"
            ? "/img/sky/tarantula-nebula-jwst-4k.webp"
            : null;
    if (backgroundPath) {
      backgroundTexture = new THREE.TextureLoader().load(
        backgroundPath,
      );
      backgroundTexture.colorSpace = THREE.SRGBColorSpace;
      scene.background = backgroundTexture;
      scene.backgroundIntensity = 0.34;
      scene.backgroundBlurriness = 0.035;
    }
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
    let blueStarMaterial: THREE.ShaderMaterial | null = null;
    const movers: {
      mesh: THREE.Mesh;
      orbit: number;
      angle: number;
      speed: number;
      inclination: number;
      node: number;
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
              "uniform sampler2D uMap;\nuniform vec3 uBrandColor;",
            ).replace(
              "vec3 albedo = texel.rgb;",
              "vec3 albedo = mix(texel.rgb, texel.rgb * uBrandColor * 1.7, 0.46);",
            ),
            uniforms: {
              uMap: { value: texture },
              uBrandColor: { value: brand },
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
      resettingView = false;
    if (focusTarget) controls.zoomToCursor = false;
    const focusOffset = new THREE.Vector3();
    const desiredCamera = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const lastFocusPosition = new THREE.Vector3();
    const focusMotion = new THREE.Vector3();
    if (focusTarget) lastFocusPosition.copy(focusTarget.position);
    // The main solar-system maps are never displayed here. Each stock receives a
    // unique, logo-tinted alien surface generated from its own stable code seed.
    const featured = [...movers].sort(
      (a, b) =>
        ringHash((a.mesh.userData.stock as MarketMapItem).code) -
        ringHash((b.mesh.userData.stock as MarketMapItem).code),
    );
    const stormCount = Math.min(
        featured.length,
        featured.length >= 8 ? 2 : featured.length ? 1 : 0,
      ),
      stormCodes = new Set(
        featured
          .slice(0, stormCount)
          .map((x) => (x.mesh.userData.stock as MarketMapItem).code),
      ),
      bandCodes = new Set(
        featured
          .slice(
            stormCount,
            stormCount + Math.min(2, Math.max(0, featured.length - stormCount)),
          )
          .map((x) => (x.mesh.userData.stock as MarketMapItem).code),
      );
    const progressiveDesign = true;
    const pendingDesignBodies: THREE.Object3D[] = [];
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
          fragmentShader: SUN_FRAG.replace(
            "gl_FragColor = vec4(color, 1.0);",
            "gl_FragColor = vec4(color * 1.5, 1.0);",
          ),
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
          256,
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
        cloud.onBeforeRender = () => {
          cloud.rotation.y -= maps.cloudSpeed * 0.012;
        };
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
          brandColor = await logoColor(stock.code, logoUrl),
          material = (body as THREE.Mesh).material,
          planetStyle = stormCodes.has(stock.code)
            ? "storm"
            : bandCodes.has(stock.code)
              ? "complex-bands"
              : "standard",
          maps = createAlienPlanetMaps(
            stock.code,
            brandColor,
            renderer.capabilities.getMaxAnisotropy(),
            256,
            planetStyle,
          );
        if (designDisposed) return;
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
          cloud.onBeforeRender = () => {
            cloud.rotation.y -= maps.cloudSpeed * 0.012;
          };
          body.add(cloud);
          cloudLayers.push({ mesh: cloud, speed: maps.cloudSpeed });
        }
        if (pendingDesignBodies.length)
          designTimer = window.setTimeout(applyNextDesign, 18);
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
      const coronaReach = 20.25,
        coronaMaterial = new THREE.ShaderMaterial({
          vertexShader: SUNGLOW_VERT,
          fragmentShader: SUNGLOW_FRAG,
          uniforms: {
            uTime: { value: 0 },
            uPulse: { value: 0.08 },
            uColor: { value: new THREE.Color(0x35c5ff) },
            uOuterColor: { value: new THREE.Color(0xbceeff) },
            uIntensity: { value: 0.828 },
            uUnit: { value: 13.5 / coronaReach },
            uFalloff: { value: 3.8 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
        corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), coronaMaterial);
      corona.scale.setScalar(coronaReach);
      corona.renderOrder = 3;
      scene.add(corona);
      corona.onBeforeRender = () => {
        const seconds = performance.now() * 0.001;
        corona.quaternion.copy(camera.quaternion);
        coronaMaterial.uniforms.uTime.value = seconds;
        coronaMaterial.uniforms.uPulse.value =
          0.08 + Math.sin(seconds * 1.35) * 0.035;
      };
      centralStar.onBeforeRender = () => {
        if (blueStarMaterial) {
          const seconds = performance.now() * 0.001;
          blueStarMaterial.uniforms.uTime.value = seconds;
          blueStarMaterial.uniforms.uPulse.value =
            0.09 + Math.sin(seconds * 1.4) * 0.045;
          const stock = centralStar?.userData.stock as
              | MarketMapItem
              | undefined,
            brand = new THREE.Color(
              stock
                ? colorsRef.current.get(stock.code) ?? colorFor(stock.code)
                : 0x35c5ff,
            ),
            cool = brand.clone().offsetHSL(-0.025, 0.12, -0.34),
            warm = brand.clone().offsetHSL(0, 0.08, 0.04),
            hot = brand.clone().lerp(new THREE.Color(0xffffff), 0.68);
          blueStarMaterial.uniforms.uCool.value.copy(cool);
          blueStarMaterial.uniforms.uWarm.value.copy(warm);
          blueStarMaterial.uniforms.uHot.value.copy(hot);
          coronaMaterial.uniforms.uColor.value.copy(
            warm.clone().lerp(hot, 0.28),
          );
          coronaMaterial.uniforms.uOuterColor.value.copy(hot);
        }
      };
    }
    if (centralStar) {
      const starStock = centralStar.userData.stock as MarketMapItem,
        brand = new THREE.Color(
          colorsRef.current.get(starStock.code) ?? colorFor(starStock.code),
        ),
        cool = brand.clone().offsetHSL(-0.025, 0.12, -0.34),
        warm = brand.clone().offsetHSL(0, 0.08, 0.04),
        hot = brand.clone().lerp(new THREE.Color(0xffffff), 0.68),
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
    const focusBody = (body: THREE.Object3D, revealDetails = true) => {
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
      flying = true;
      lastFocusPosition.copy(body.position);
      // While inspecting a body, zoom around that body's centre. Combining
      // zoomToCursor's moving target with the focus lock below can push the camera
      // back toward the preset focus distance after a wheel-in gesture.
      controls.zoomToCursor = false;
      controls.target.copy(body.position);
      if (revealDetails) {
        reportMarketOrbitEvent({
          action: "detail_open",
          market: trackingMarket,
          sector: stock.sector,
          code: stock.code,
          name: stock.name,
        });
        onSelect(stock);
      }
      else onSelect(null);
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
            string | { code: string; revealDetails?: boolean }
          >
        ).detail,
        code = typeof detail === "string" ? detail : detail.code,
        revealDetails =
          typeof detail === "string" ? true : detail.revealDetails !== false,
        body = hit.find(
          (item) =>
            (item.userData.stock as MarketMapItem | undefined)?.code === code,
        );
      if (body) focusBody(body, revealDetails);
    };
    window.addEventListener("kospi-orbit-focus", externalFocus);
    const resetView = () => {
      focusTarget = null;
      flying = false;
      resettingView = true;
      controls.enabled = true;
      controls.zoomToCursor = true;
      onSelect(null);
    };
    window.addEventListener("kospi-orbit-reset-view", resetView);
    const labelEntries = hit.slice(0, innerWidth < 700 ? 8 : 18).map((o) => {
      const s = o.userData.stock as MarketMapItem,
        isStar = o === centralStar,
        el = document.createElement("button");
      el.type = "button";
      el.className = `orbit-body-label ${isStar ? "orbit-star-label " : "orbit-planet-label "}${s.change_pct >= 0 ? "up" : "down"}`;
      el.innerHTML = `<span class="orbit-body-name"><img src="${logoUrl(s.code)}" alt=""><b>${s.name}</b></span><span class="orbit-body-change">${pct(s.change_pct)}</span>`;
      el.onclick = (event) => {
        event.stopPropagation();
        if (o === centralStar) focusStarByTap(o);
        else focusBody(o);
      };
      labels.appendChild(el);
      return { o, el, p: new THREE.Vector3() };
    });
    const updateLabels = () => {
      for (const entry of labelEntries) {
        entry.p.copy(entry.o.position).project(camera);
        entry.el.style.visibility = entry.p.z < 1 ? "visible" : "hidden";
        if (entry.p.z < 1)
          entry.el.style.transform = `translate3d(${(entry.p.x * 0.5 + 0.5) * host.clientWidth}px,${(-entry.p.y * 0.5 + 0.5) * host.clientHeight}px,0)`;
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
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      movers.forEach((x) => {
        const a = x.angle + t * x.speed,
          ca = Math.cos(a),
          sa = Math.sin(a),
          cn = Math.cos(x.node),
          sn = Math.sin(x.node),
          ci = Math.cos(x.inclination),
          si = Math.sin(x.inclination);
        x.mesh.position.set(
          x.orbit * (ca * cn - sa * ci * sn),
          x.orbit * sa * si,
          x.orbit * (ca * sn + sa * ci * cn),
        );
        x.mesh.rotation.y = t * x.spin;
      });
      if (centralStar) centralStar.rotation.y = t * 0.075;
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
            matchMedia("(pointer: coarse)").matches &&
            host.clientHeight > host.clientWidth,
          focusDistance = portraitFocus
            ? Math.max(radius * 5.8, 8)
            : Math.max(radius * 3.15, 4.2);
        desiredTarget.copy(focusTarget.position);
        if (portraitFocus) desiredTarget.y -= radius * 1.55;
        if (flying) {
          focusOffset.copy(camera.position).sub(controls.target);
          if (focusOffset.lengthSq() < 0.01) focusOffset.set(0.7, 0.3, 1);
          focusOffset.normalize().multiplyScalar(focusDistance);
          desiredCamera.copy(focusTarget.position).add(focusOffset);
          camera.position.lerp(desiredCamera, 0.032);
          controls.target.lerp(desiredTarget, 0.05);
          if (camera.position.distanceTo(desiredCamera) < 0.18) flying = false;
        } else if (distance <= Math.max(110, radius * 18)) {
          controls.target.copy(desiredTarget);
        } else {
          focusTarget = null;
          controls.zoomToCursor = true;
        }
      }
      if (resettingView) {
        camera.position.lerp(defaultCameraPosition, 0.075);
        controls.target.lerp(defaultCameraTarget, 0.09);
        if (
          camera.position.distanceTo(defaultCameraPosition) < 0.12 &&
          controls.target.distanceTo(defaultCameraTarget) < 0.05
        ) {
          camera.position.copy(defaultCameraPosition);
          controls.target.copy(defaultCameraTarget);
          resettingView = false;
        }
      }
      controls.update();
      updateLabels();
      if (composer) composer.render();
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
  }, [systems, mode.sector, onSelect, logoUrl, trackingMarket]);
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
}: {
  stock: MarketMapItem;
  comparisonStock: MarketMapItem;
  rank: number;
  onClose: () => void;
  config: OrbitConfig;
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
            navigate(`/stock/${stock.code}`);
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
    [colors, setColors] = useState<Map<string, number>>(new Map());
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
        setItems(r.items);
        const p = new URLSearchParams(location.search),
          code = p.get("code"),
          sector = p.get("sector");
        const first = [...r.items].sort(
            (a, b) => config.capOf(b) - config.capOf(a),
          )[0],
          initialSector = sector || first?.sector || "기타";
        setMode({ kind: "system", sector: initialSector });
        setExpanded(
          matchMedia("(pointer: coarse)").matches ? "" : initialSector,
        );
        if (code) {
          const s = r.items.find((x) => x.code === code);
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
          await logoColor(stock.code, config.logoUrl),
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
  return (
    <main
      className={`kospi-orbit orbit-market-${market}${selected ? " has-detail" : ""}`}
    >
      {(
        <a
          className="orbit-background-credit"
          href={
            market === "kospi"
              ? "https://science.nasa.gov/asset/webb/cosmic-cliffs-in-the-carina-nebula-nircam-image/"
              : market === "kosdaq"
                ? "https://science.nasa.gov/asset/webb/southern-ring-nebula-nircam-image/"
                : "https://science.nasa.gov/asset/webb/tarantula-nebula-nircam-image/"
          }
          target="_blank"
          rel="noreferrer"
        >
          {market === "kospi"
            ? "JWST Carina Nebula"
            : market === "kosdaq"
              ? "JWST Southern Ring Nebula"
              : "JWST Tarantula Nebula"}{" "}
          · NASA / ESA / CSA / STScI
        </a>
      )}
      <header className="orbit-top">
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
          onReady={() => setReady(true)}
          logoUrl={config.logoUrl}
          trackingMarket={config.label}
        />
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
                    className={selected?.code === stock.code ? "selected" : ""}
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
                    className={selected?.code === stock.code ? "selected" : ""}
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
        <h1>{mode.sector}</h1>
        <p>시가총액 순위가 궤도와 행성의 크기를 결정합니다</p>
        <div className="orbit-hint">
          드래그 회전 · 스크롤 확대 · 오브젝트 클릭
        </div>
      </section>
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
              onClose={() => setSelected(null)}
            />
          );
        })()}
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
