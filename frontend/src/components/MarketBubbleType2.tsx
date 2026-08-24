import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { StockBoard, StockBoardItem, api } from "../api/client";
import { Link, navigate } from "../router";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoProxyUrl, usCompanyLogoUrl } from "../usLogo";
import { useDocumentTitle } from "../useDocumentTitle";
import { reportMarketBubbleEvent } from "../useActivityTracking";
import MarketBubbleIcon from "./MarketBubbleIcon";
import MarketBubbleDiscussion from "./MarketBubbleDiscussion";
import "./marketBubbleType2.css";
import "./marketBubble.css";

type Market = "kospi" | "kosdaq" | "nasdaq";

const BUBBLE_COUNT = 20;
const MAP_RANGE = 780;

const MARKETS: { key: Market; label: string }[] = [
  { key: "kospi", label: "코스피" },
  { key: "kosdaq", label: "코스닥" },
  { key: "nasdaq", label: "나스닥" },
];

type Orb = {
  index: number;
  group: THREE.Group;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  halo: THREE.Sprite;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null;
  labelSprite: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTexture: THREE.CanvasTexture;
  logoImg: HTMLImageElement | null;
  base: THREE.Vector3;
  r: number;
  seed: number;
  bobAmp: number;
  flash: number;
  dim: number;
};

type RingSlot = { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; age: number; life: number; active: boolean; orbR: number };
type BurstSlot = {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  positions: Float32Array;
  velocities: Float32Array;
  ages: Float32Array;
  sizes: Float32Array;
  age: number;
  life: number;
  active: boolean;
};
type Flight = {
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
  start: number; dur: number;
};

type Engine = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  galaxy: THREE.Group;
  constellationGroup: THREE.Group;
  starMatFar: THREE.ShaderMaterial;
  starMatNear: THREE.ShaderMaterial;
  nebulaMat: THREE.ShaderMaterial;
  rings: RingSlot[];
  bursts: BurstSlot[];
};

let CORE_GEO: THREE.SphereGeometry | null = null;
function coreGeometry() {
  if (!CORE_GEO) CORE_GEO = new THREE.SphereGeometry(1, 52, 36);
  return CORE_GEO;
}
let RING_GEO: THREE.RingGeometry | null = null;
function ringGeometry() {
  if (!RING_GEO) RING_GEO = new THREE.RingGeometry(1, 1.14, 80);
  return RING_GEO;
}
let HALO_TEX: THREE.CanvasTexture | null = null;
function haloTexture() {
  if (HALO_TEX) return HALO_TEX;
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, "rgba(255,255,255,.9)");
    grad.addColorStop(.24, "rgba(255,255,255,.34)");
    grad.addColorStop(.55, "rgba(255,255,255,.09)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  HALO_TEX = new THREE.CanvasTexture(canvas);
  return HALO_TEX;
}

function disposeOrbs(orbs: Orb[]) {
  orbs.forEach((orb) => {
    orb.core.material.dispose();
    orb.halo.material.dispose();
    orb.ring?.material.dispose();
    orb.labelTexture.dispose();
    orb.labelSprite.material.dispose();
  });
}

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

const logoPaletteCache = new Map<string, Promise<[string, string]>>();
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
        const pastel = new THREE.Color().setHSL(hsl.h, saturation, .58);
        const shade = new THREE.Color().setHSL(hsl.h, Math.min(.98, saturation * 1.04), .3);
        resolve([`#${pastel.getHexString()}`, `#${shade.getHexString()}`]);
      } catch { resolve(["#8fd6ff", "#2b5f8f"]); }
    };
    image.onerror = () => resolve(["#8fd6ff", "#2b5f8f"]);
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
function formatChangeAbs(item: StockBoardItem) {
  const digits = Math.abs(item.change) >= 100 ? 0 : 2;
  return `${item.change > 0 ? "+" : ""}${item.change.toLocaleString("ko-KR", { minimumFractionDigits: item.change % 1 === 0 ? 0 : digits, maximumFractionDigits: digits })}`;
}
function formatMarketCap(item: StockBoardItem, market: Market): string {
  if (market === "nasdaq") {
    const value = item.market_cap;
    if (!value || value <= 0) return "—";
    if (value >= 1e12) return `$${(value / 1e12).toFixed(value >= 10e12 ? 1 : 2)}T`;
    return `$${(value / 1e9).toFixed(value >= 100e9 ? 0 : 1)}B`;
  }
  if (!item.marcap || item.marcap <= 0) return "—";
  if (item.marcap >= 1e12) return `${(item.marcap / 1e12).toFixed(item.marcap >= 100e12 ? 0 : 1)}조`;
  return `${Math.round(item.marcap / 1e8).toLocaleString("ko-KR")}억`;
}
function formatVolume(item: StockBoardItem): string {
  const v = item.volume;
  if (!v || v <= 0) return "—";
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억주`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString("ko-KR")}만주`;
  return `${v.toLocaleString()}주`;
}
function shortName(item: StockBoardItem, market: Market) {
  const name = market === "nasdaq" ? item.name_ko || item.name : item.name;
  return name.replace(/\s+(Inc\.?|Corporation|Corp\.?|Common Stock).*$/i, "").slice(0, 16);
}
function seeded(i: number, salt = 1) {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
function sectorHue(sector: string) {
  let hash = 0;
  for (let i = 0; i < sector.length; i++) hash = (hash * 31 + sector.charCodeAt(i)) >>> 0;
  return (hash % 360) / 360;
}
function easeInOutCubic(t: number) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

const CORE_VERT = `
uniform float uTime; uniform float uSeed;
varying vec3 vN; varying vec3 vLocal; varying vec3 vWorld;
void main(){
  vN = normalize(normalMatrix * normal);
  float breathe = 1.0 + 0.032*sin(uTime*1.35 + uSeed*6.28318) + 0.018*sin(uTime*2.7 + uSeed*12.56);
  vec3 p = position * breathe;
  vLocal = p;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CORE_FRAG = `
uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uTint;
uniform float uTime; uniform float uSeed; uniform float uPulse; uniform float uDim; uniform float uToneAmt;
varying vec3 vN; varying vec3 vLocal; varying vec3 vWorld;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float noise(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float v=0.0; float a=0.5; for(int k=0;k<4;k++){ v+=a*noise(p); p=p*2.07+7.31; a*=0.52; } return v; }
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 p = normalize(vLocal);
  float rot = uTime*0.055 + uSeed*6.28318;
  float ca = cos(rot), sa = sin(rot);
  vec3 pr = vec3(ca*p.x - sa*p.z, p.y, sa*p.x + ca*p.z);
  float t = uTime*0.15;
  vec3 q = pr*2.35 + uSeed*13.1;
  float w1 = fbm(q + vec3(t, -t*0.7, t*0.45));
  float w2 = fbm(q*1.75 + vec3(-t*0.8, t*0.55, t*0.9) + w1*1.45);
  float swirl = fbm(q + w2*2.15 + vec3(0.0, t*1.15, 0.0));
  float bandsRaw = 0.5 + 0.5*sin((pr.y + w2*0.55)*8.5 + uTime*0.32 + uSeed*19.0);
  float bands = mix(bandsRaw, 0.5, 0.58);
  float grain = fbm(pr*7.4 + w1*1.85 + uSeed*31.0);
  float mask = smoothstep(0.33, 0.86, swirl*0.70 + bands*0.30);
  vec3 base = mix(uColorB, uColorA, mask);
  base *= 0.92 + grain*0.16;
  base = mix(base, uTint, uToneAmt*(0.24 + 0.3*mask));
  vec3 L1 = normalize(vec3(-0.55, 0.78, 0.42));
  vec3 L2 = normalize(vec3(0.66, -0.22, 0.55));
  float wrapd = pow(clamp(dot(N,L1)*0.5+0.5, 0.0, 1.0), 1.7);
  float diff2 = clamp(dot(N,L2), 0.0, 1.0);
  float ang = clamp(dot(N,V), 0.0, 1.0);
  float film = cos((1.0-ang)*7.5 + swirl*3.2 + uTime*0.2 + uSeed*17.0)*0.5+0.5;
  vec3 irid = vec3(
    0.5+0.5*cos(film*6.28318),
    0.5+0.5*cos(film*6.28318 + 2.094),
    0.5+0.5*cos(film*6.28318 + 4.188));
  vec3 H1 = normalize(L1+V);
  float spec = pow(clamp(dot(N,H1), 0.0, 1.0), 52.0);
  vec3 H2 = normalize(L2+V);
  float spec2 = pow(clamp(dot(N,H2), 0.0, 1.0), 22.0)*0.22;
  float fres = pow(1.0-ang, 2.6);
  vec3 col = base*(0.30 + 0.40*wrapd + diff2*0.13);
  col = mix(col, col*irid, 0.14 + 0.12*fres);
  col += base*spec*0.26;
  col += vec3(1.0)*spec2*0.09;
  col += uColorA*fres*0.55;
  col += vec3(1.0)*pow(fres, 3.5)*0.26;
  col += uTint*uPulse*1.0;
  col *= (0.84 + uPulse*0.55);
  col *= mix(0.30, 1.0, uDim);
  gl_FragColor = vec4(col, 0.92);
}`;

const STAR_VERT = `
attribute float aSize; attribute float aSeed;
uniform float uTime; uniform float uWarp; uniform float uPixelRatio;
varying float vAlpha; varying float vSeed;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.36 + 0.26*sin(uTime*(0.9 + aSeed*2.6) + aSeed*43.0);
  vAlpha = tw * (0.62 + uWarp*0.32);
  vSeed = aSeed;
  gl_PointSize = aSize * uPixelRatio * (360.0/max(1.0,-mv.z)) * (1.0 + uWarp*0.65);
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = `
varying float vAlpha; varying float vSeed;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  vec3 tint = mix(vec3(0.72,0.86,1.0), mix(vec3(1.0), vec3(1.0,0.82,0.62), step(0.86,vSeed)), step(0.5,vSeed));
  gl_FragColor = vec4(tint*a*0.78, a);
}`;

const NEBULA_VERT = `
varying vec3 vDir;
void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

const NEBULA_FRAG = `
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float noise(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float v=0.0; float a=0.5; for(int k=0;k<5;k++){ v+=a*noise(p); p=p*2.02+11.3; a*=0.55; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float n = fbm(d*3.1 + vec3(uTime*0.012, 0.0, uTime*0.008));
  float n2 = fbm(d*6.4 - vec3(uTime*0.02, uTime*0.01, 0.0));
  vec3 deep = vec3(0.012, 0.02, 0.05);
  vec3 violet = vec3(0.062, 0.032, 0.128);
  vec3 col = mix(deep, violet, smoothstep(0.38, 0.86, n));
  float cyanBand = smoothstep(0.62, 0.95, n2) * smoothstep(0.9, 0.35, abs(d.y));
  col += vec3(0.04, 0.15, 0.21) * cyanBand * 0.42;
  float magenta = smoothstep(0.70, 0.98, fbm(d*4.4 + 31.7 + uTime*0.006));
  col += vec3(0.14, 0.036, 0.17) * magenta * 0.26;
  float horizon = smoothstep(-0.25, 0.4, d.y);
  col *= 0.5 + 0.5*horizon;
  col += vec3(0.007, 0.012, 0.024);
  gl_FragColor = vec4(col, 1.0);
}`;

const BURST_VERT = `
attribute float aSize; attribute float aAge;
uniform float uPixelRatio;
varying float vFade;
void main(){
  vFade = clamp(1.0 - aAge, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio * (300.0/max(1.0,-mv.z)) * (0.4 + 0.6*vFade);
  gl_Position = projectionMatrix * mv;
}`;

const BURST_FRAG = `
uniform vec3 uColor;
varying float vFade;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.04, d) * vFade;
  vec3 col = mix(vec3(1.0), uColor, 0.55);
  gl_FragColor = vec4(col*a*0.75, a);
}`;

function drawLabel(orb: Orb, item: StockBoardItem, market: Market, palette: [string, string] | null) {
  const { labelCanvas: canvas, labelTexture } = orb;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  const scale = 3.9;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const chipW = 176 * scale, chipH = 74 * scale;
  ctx.fillStyle = "rgba(5,11,24,.78)";
  ctx.strokeStyle = "rgba(126,200,255,.4)";
  ctx.lineWidth = 1.4 * scale;
  const radius = 13 * scale;
  const x0 = -chipW / 2, y0 = -chipH / 2;
  ctx.beginPath();
  ctx.moveTo(x0 + radius, y0);
  ctx.arcTo(x0 + chipW, y0, x0 + chipW, y0 + chipH, radius);
  ctx.arcTo(x0 + chipW, y0 + chipH, x0, y0 + chipH, radius);
  ctx.arcTo(x0, y0 + chipH, x0, y0, radius);
  ctx.arcTo(x0, y0, x0 + chipW, y0, radius);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const accent = palette ? palette[0] : "#8fd6ff";
  ctx.fillStyle = accent;
  ctx.globalAlpha = .85;
  ctx.fillRect(x0 + 8 * scale, y0 + 8 * scale, 3.4 * scale, chipH - 16 * scale);
  ctx.globalAlpha = 1;
  const logoSize = 40 * scale;
  if (orb.logoImg && orb.logoImg.complete && orb.logoImg.naturalWidth > 1) {
    try { ctx.drawImage(orb.logoImg, -chipW / 2 + 17 * scale, -logoSize / 2, logoSize, logoSize); } catch { /* tainted */ }
  } else {
    ctx.fillStyle = accent;
    ctx.font = `900 ${21 * scale}px Pretendard, "Noto Sans KR", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = .8;
    ctx.fillText(item.name.slice(0, 1), -chipW / 2 + 17 * scale + logoSize / 2, 0);
    ctx.globalAlpha = 1;
  }
  const textX = -chipW / 2 + 17 * scale + logoSize + 11 * scale;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${17.5 * scale}px Pretendard, "Noto Sans KR", sans-serif`;
  ctx.fillStyle = "rgba(238,248,255,.96)";
  ctx.shadowColor = accent; ctx.shadowBlur = 7 * scale;
  ctx.fillText(shortName(item, market), textX, -6 * scale);
  ctx.shadowBlur = 0;
  const up = item.change_pct > .04, down = item.change_pct < -.04;
  const priceColor = up ? "#4dffb0" : down ? "#ff6b81" : "#cfdcea";
  ctx.font = `900 ${16 * scale}px Pretendard, "Noto Sans KR", sans-serif`;
  ctx.fillStyle = priceColor;
  ctx.fillText(formatPrice(item, market), textX, 15 * scale);
  ctx.font = `800 ${13 * scale}px Pretendard, "Noto Sans KR", sans-serif`;
  ctx.globalAlpha = .92;
  ctx.fillText(`${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`, textX, 29 * scale);
  ctx.globalAlpha = 1;
  const rankLabel = `#${item.rank}`;
  ctx.font = `900 ${11.5 * scale}px Pretendard, "Noto Sans KR", sans-serif`;
  const rankW = ctx.measureText(rankLabel).width + 10 * scale;
  ctx.fillStyle = "rgba(10,20,38,.85)";
  ctx.strokeStyle = item.rank <= 3 ? "rgba(255,208,102,.85)" : "rgba(126,200,255,.4)";
  ctx.lineWidth = 1.2 * scale;
  const rx = chipW / 2 - rankW - 7 * scale, ry = y0 + 7 * scale, rh = 16 * scale;
  const rr = 8 * scale;
  ctx.beginPath();
  ctx.moveTo(rx + rr, ry);
  ctx.arcTo(rx + rankW, ry, rx + rankW, ry + rh, rr);
  ctx.arcTo(rx + rankW, ry + rh, rx, ry + rh, rr);
  ctx.arcTo(rx, ry + rh, rx, ry, rr);
  ctx.arcTo(rx, ry, rx + rankW, ry, rr);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = item.rank <= 3 ? "#ffd66e" : "#bcdcff";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(rankLabel, rx + rankW / 2, ry + rh / 2 + .5 * scale);
  ctx.restore();
  labelTexture.needsUpdate = true;
}

export default function MarketBubbleType2() {
  useDocumentTitle("증시버블 NEO · K-Stock Hub");
  const [market, setMarket] = useState<Market>(() => {
    const requested = new URLSearchParams(window.location.search).get("market")?.toLowerCase();
    return requested === "kosdaq" || requested === "nasdaq" || requested === "kospi" ? requested : "kospi";
  });
  const [board, setBoard] = useState<StockBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [bubbleColors, setBubbleColors] = useState<[string, string][]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [discussionIndex, setDiscussionIndex] = useState<number | null>(null);
  const [tourOn, setTourOn] = useState(false);
  const [labelsOn, setLabelsOn] = useState(true);
  const [linesOn, setLinesOn] = useState(true);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [splashGone, setSplashGone] = useState(false);
  const [webglBroken, setWebglBroken] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);

  const engineRef = useRef<Engine | null>(null);
  const orbsRef = useRef<Orb[]>([]);
  const pickMeshesRef = useRef<THREE.Mesh[]>([]);
  const itemsRef = useRef<StockBoardItem[]>([]);
  const colorsRef = useRef<[string, string][]>([]);
  const marketRef = useRef<Market>(market);
  const navRef = useRef({ idx: -2, nonce: 0 });
  const selectedRef = useRef<number | null>(null);
  const tourStateRef = useRef({ on: false, idx: null as number | null });
  const labelsOnRef = useRef(true);
  const linesOnRef = useRef(true);
  const flightRef = useRef<Flight | null>(null);
  const warpEnvRef = useRef(0);
  const pointerNdcRef = useRef(new THREE.Vector2(9999, 9999));
  const pointerDownRef = useRef({ x: 0, y: 0, t: 0, moved: false });
  const lastInteractRef = useRef(performance.now());
  const hoverIdxRef = useRef<number | null>(null);
  const prevClosesRef = useRef<Map<string, number>>(new Map());
  const mmAccRef = useRef(1);
  const sectorFilterRef = useRef<string | null>(null);
  const selectRef = useRef<(idx: number, fromTour?: boolean) => void>(() => {});
  const eruptionRef = useRef<(orb: Orb) => void>(() => {});
  const applyFilterRef = useRef(() => {});
  const stopTourRef = useRef(() => {});

  itemsRef.current = board?.items.slice().sort((a, b) => a.rank - b.rank).slice(0, BUBBLE_COUNT) ?? [];
  colorsRef.current = bubbleColors;
  marketRef.current = market;
  selectedRef.current = selectedIndex;
  labelsOnRef.current = labelsOn;
  linesOnRef.current = linesOn;
  sectorFilterRef.current = sectorFilter;

  const codesKey = useMemo(() => itemsRef.current.map((it) => it.code).join(","), [board]);
  const sectorChips = useMemo(() => {
    void codesKey;
    const counts = new Map<string, number>();
    itemsRef.current.forEach((it) => counts.set(it.sector, (counts.get(it.sector) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([s]) => s);
  }, [codesKey]);

  const stopTour = useCallback(() => {
    if (!tourStateRef.current.on) return;
    tourStateRef.current = { on: false, idx: null };
    setTourOn(false);
  }, []);
  stopTourRef.current = stopTour;

  selectRef.current = (idx: number, fromTour = false) => {
    if (!fromTour) stopTour();
    setSelectedIndex(idx);
    navRef.current = { idx, nonce: navRef.current.nonce + 1 };
    const item = itemsRef.current[idx];
    if (item && !fromTour) reportMarketBubbleEvent({ action: "bubble_click", market: marketRef.current, code: item.code, name: item.name });
  };

  eruptionRef.current = (orb: Orb) => {
    const engine = engineRef.current;
    if (!engine) return;
    const world = new THREE.Vector3();
    orb.group.getWorldPosition(world);
    const slot = engine.rings.find((s) => !s.active) ?? engine.rings[0];
    slot.active = true; slot.age = 0; slot.orbR = orb.r;
    slot.mesh.position.copy(world);
    slot.mesh.visible = true;
    const burst = engine.bursts.find((s) => !s.active) ?? engine.bursts[0];
    burst.active = true; burst.age = 0;
    burst.points.visible = true;
    (burst.points.material.uniforms.uColor.value as THREE.Color).set(colorsRef.current[orb.index]?.[0] ?? "#9fe8ff");
    for (let i = 0; i < burst.positions.length / 3; i++) {
      burst.positions[i * 3] = world.x;
      burst.positions[i * 3 + 1] = world.y;
      burst.positions[i * 3 + 2] = world.z;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 1.7 - .85);
      const speed = 80 + Math.random() * 200;
      burst.velocities[i * 3] = Math.sin(ph) * Math.cos(th) * speed;
      burst.velocities[i * 3 + 1] = Math.cos(ph) * speed * .5;
      burst.velocities[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * speed;
      burst.ages[i] = 0;
      burst.sizes[i] = orb.r * (.09 + Math.random() * .13);
    }
    burst.points.geometry.attributes.position.needsUpdate = true;
    burst.points.geometry.attributes.aSize.needsUpdate = true;
    burst.points.geometry.attributes.aAge.needsUpdate = true;
    orb.flash = 1;
  };

  applyFilterRef.current = () => {
    const filter = sectorFilterRef.current;
    engineRef.current?.constellationGroup.children.forEach((line) => {
      line.userData.targetOpacity = filter ? (line.userData.sector === filter ? .55 : .045) : .22;
    });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSelectedIndex(null);
    setDiscussionIndex(null);
    setSectorFilter(null);
    setTourOn(false);
    api.stockBoard(market).then((next) => {
      if (!alive) return;
      setBoard(next);
      setLoading(false);
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
    let alive = true;
    const items = itemsRef.current;
    if (!items.length) { setBubbleColors([]); return () => { alive = false; }; }
    Promise.all(items.map((item) => {
      const logo = market === "nasdaq" ? usCompanyLogoProxyUrl(item.code) : stockIconUrl(item.code);
      return logoPastelPalette(logo, `${market}:${item.code}`);
    })).then((colors) => { if (alive) setBubbleColors(colors); });
    return () => { alive = false; };
  }, [market, codesKey]);

  useEffect(() => () => { prevClosesRef.current.clear(); }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || webglBroken) return;
    const mobile = window.innerWidth <= 820;
    let engine: Engine;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = .72;
      renderer.setClearColor(0x030512, 1);
      renderer.domElement.className = "neo-canvas";
      stage.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 10, 12000);
      camera.position.set(0, 1750, 2750);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = .07;
      controls.enablePan = false;
      controls.rotateSpeed = .55;
      controls.zoomSpeed = .8;
      controls.minDistance = 220;
      controls.maxDistance = 3200;
      controls.maxPolarAngle = Math.PI * .88;
      controls.autoRotateSpeed = .45;
      controls.enabled = false;
      controls.target.set(0, -60, 0);

      const nebulaMat = new THREE.ShaderMaterial({
        vertexShader: NEBULA_VERT, fragmentShader: NEBULA_FRAG,
        uniforms: { uTime: { value: 0 } },
        side: THREE.BackSide, depthWrite: false,
      });
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(5200, 40, 26), nebulaMat));

      const makeStars = (count: number, rMin: number, rMax: number, sizeMin: number, sizeMax: number) => {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3), sizes = new Float32Array(count), seeds = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
          const rad = rMin + Math.random() * (rMax - rMin);
          pos[i * 3] = rad * Math.sin(ph) * Math.cos(th);
          pos[i * 3 + 1] = rad * Math.cos(ph);
          pos[i * 3 + 2] = rad * Math.sin(ph) * Math.sin(th);
          sizes[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
          seeds[i] = Math.random();
        }
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
        const mat = new THREE.ShaderMaterial({
          vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
          uniforms: { uTime: { value: 0 }, uWarp: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        scene.add(points);
        return mat;
      };
      const starMatFar = makeStars(mobile ? 850 : 1500, 2400, 4300, 1.4, 3.4);
      const starMatNear = makeStars(mobile ? 260 : 520, 750, 1900, 2.2, 5.2);

      const grid = new THREE.PolarGridHelper(900, 12, 7, 108, 0x1e4a7a, 0x143055);
      grid.position.y = -170;
      const gridMat = grid.material as THREE.LineBasicMaterial;
      gridMat.transparent = true;
      gridMat.opacity = .07;
      gridMat.blending = THREE.AdditiveBlending;
      gridMat.depthWrite = false;
      scene.add(grid);

      const galaxy = new THREE.Group();
      scene.add(galaxy);
      const constellationGroup = new THREE.Group();
      galaxy.add(constellationGroup);

      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(stage.clientWidth || 1280, stage.clientHeight || 720), .3, .45, .68);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());

      const rings: RingSlot[] = [];
      for (let i = 0; i < 5; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
        const mesh = new THREE.Mesh(ringGeometry(), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.visible = false;
        galaxy.add(mesh);
        rings.push({ mesh, age: 0, life: 1.15, active: false, orbR: 20 });
      }
      const bursts: BurstSlot[] = [];
      for (let i = 0; i < 3; i++) {
        const count = 150;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const ages = new Float32Array(count);
        const sizes = new Float32Array(count);
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute("aAge", new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage));
        const mat = new THREE.ShaderMaterial({
          vertexShader: BURST_VERT, fragmentShader: BURST_FRAG,
          uniforms: { uColor: { value: new THREE.Color(0x9fe8ff) }, uPixelRatio: { value: renderer.getPixelRatio() } },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.visible = false;
        galaxy.add(points);
        bursts.push({ points, positions, velocities, ages, sizes, age: 0, life: 1.35, active: false });
      }

      engine = { renderer, scene, camera, controls, composer, bloom, galaxy, constellationGroup, starMatFar, starMatNear, nebulaMat, rings, bursts };
      engineRef.current = engine;
    } catch {
      setWebglBroken(true);
      return;
    }
    const { renderer, camera, controls, composer } = engine;

    const raycaster = new THREE.Raycaster();
    const projected = new THREE.Vector3();
    const worldPos = new THREE.Vector3();
    const tmpTarget = new THREE.Vector3();
    const overviewPose = { pos: new THREE.Vector3(60, 430, 1180), tgt: new THREE.Vector3(0, -10, 0) };

    const introStart = performance.now();
    const introFrom = camera.position.clone();
    const introTo = overviewPose.pos.clone();
    let introDone = false;

    const startFlight = (toPos: THREE.Vector3, toTgt: THREE.Vector3, dur: number) => {
      flightRef.current = {
        fromPos: camera.position.clone(), toPos: toPos.clone(),
        fromTgt: controls.target.clone(), toTgt: toTgt.clone(),
        start: performance.now(), dur,
      };
      controls.enabled = false;
      lastInteractRef.current = performance.now();
    };
    const flyToOverview = () => startFlight(overviewPose.pos, overviewPose.tgt, 1600);

    let handledNav = navRef.current.nonce;
    const consumeNav = () => {
      if (navRef.current.nonce === handledNav) return;
      handledNav = navRef.current.nonce;
      const idx = navRef.current.idx;
      if (idx < 0) { flyToOverview(); return; }
      const orb = orbsRef.current[idx];
      if (!orb) return;
      orb.group.getWorldPosition(worldPos);
      const dir = camera.position.clone().sub(worldPos);
      dir.y = Math.max(dir.length() * .38, 150);
      if (dir.lengthSq() < 1) dir.set(0, 1, 1);
      dir.normalize();
      const dist = THREE.MathUtils.clamp(orb.r * 7.4, 250, 560);
      startFlight(
        worldPos.clone().add(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, dist * .14, 0)),
        worldPos.clone(),
        1750,
      );
    };

    const dom = renderer.domElement;
    const ndcFromEvent = (clientX: number, clientY: number) => {
      const rect = dom.getBoundingClientRect();
      pointerNdcRef.current.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    };
    const onPointerMove = (event: PointerEvent) => ndcFromEvent(event.clientX, event.clientY);
    const onPointerMoveTrack = (event: PointerEvent) => {
      const down = pointerDownRef.current;
      if (down.t && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) down.moved = true;
    };
    const onPointerDown = (event: PointerEvent) => {
      lastInteractRef.current = performance.now();
      pointerDownRef.current = { x: event.clientX, y: event.clientY, t: performance.now(), moved: false };
      stopTourRef.current();
    };
    const onPointerUp = (event: PointerEvent) => {
      const down = pointerDownRef.current;
      if (!down.t) return;
      const quick = performance.now() - down.t < 420 && !down.moved &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) < 7;
      pointerDownRef.current = { x: down.x, y: down.y, t: 0, moved: false };
      if (!quick) return;
      ndcFromEvent(event.clientX, event.clientY);
      raycaster.setFromCamera(pointerNdcRef.current, camera);
      const hits = raycaster.intersectObjects(pickMeshesRef.current, false);
      if (hits.length) selectRef.current(hits[0].object.userData.index as number);
    };
    const onWheel = () => { lastInteractRef.current = performance.now(); stopTourRef.current(); };
    const onDblClick = (event: MouseEvent) => {
      ndcFromEvent(event.clientX, event.clientY);
      raycaster.setFromCamera(pointerNdcRef.current, camera);
      const hits = raycaster.intersectObjects(pickMeshesRef.current, false);
      if (!hits.length) return;
      const idx = hits[0].object.userData.index as number;
      const item = itemsRef.current[idx];
      const m = marketRef.current;
      if (item) {
        reportMarketBubbleEvent({ action: "stock_detail", market: m, code: item.code, name: item.name });
        navigate(m === "nasdaq" ? `/global?code=${item.code}` : `/stock/${item.code}`);
      }
    };
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointermove", onPointerMoveTrack);
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: true });
    dom.addEventListener("dblclick", onDblClick);

    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    resize();

    const minimapCtx = minimapRef.current?.getContext("2d") ?? null;
    const drawMinimap = (time: number) => {
      const canvas = minimapRef.current;
      if (!canvas || !minimapCtx) return;
      const size = canvas.width;
      const c = size / 2;
      const R = size / 2 - 6;
      const ctx = minimapCtx;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "rgba(6,12,26,.72)";
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "rgba(110,180,240,.14)";
      ctx.lineWidth = 1;
      [.33, .66].forEach((f) => { ctx.beginPath(); ctx.arc(c, c, R * f, 0, Math.PI * 2); ctx.stroke(); });
      ctx.beginPath();
      ctx.moveTo(c - R, c); ctx.lineTo(c + R, c);
      ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
      ctx.stroke();
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(time * .0009);
      const sweepGrad = ctx.createLinearGradient(0, 0, R, 0);
      sweepGrad.addColorStop(0, "rgba(120,220,255,.30)");
      sweepGrad.addColorStop(1, "rgba(120,220,255,0)");
      ctx.fillStyle = sweepGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, -.17, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const rotY = engine.galaxy.rotation.y;
      const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
      orbsRef.current.forEach((orb, i) => {
        const x = orb.base.x * cosR + orb.base.z * sinR;
        const z = -orb.base.x * sinR + orb.base.z * cosR;
        const px = c + (x / MAP_RANGE) * R;
        const py = c + (z / MAP_RANGE) * R;
        const item = itemsRef.current[i];
        const up = item ? item.change_pct > .04 : false;
        const dn = item ? item.change_pct < -.04 : false;
        const dimmed = sectorFilterRef.current != null && item?.sector !== sectorFilterRef.current;
        ctx.globalAlpha = dimmed ? .26 : 1;
        ctx.fillStyle = up ? "#41e6b4" : dn ? "#ff5d73" : "#93a8c4";
        ctx.beginPath();
        ctx.arc(px, py, THREE.MathUtils.clamp(1.6 + orb.r * .045, 1.8, 4.4), 0, Math.PI * 2);
        ctx.fill();
        if (selectedRef.current === i) {
          ctx.strokeStyle = "#ffd66e";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(px, py, 6.5 + Math.sin(time * .006) * 1.6, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });
      ctx.restore();
      ctx.strokeStyle = "rgba(130,205,255,.4)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
    };

    let raf = 0;
    let previous = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { previous = now; return; }
      const dt = Math.min(.05, (now - previous) / 1000);
      previous = now;
      const t = now / 1000;
      engine.nebulaMat.uniforms.uTime.value = t;
      engine.starMatFar.uniforms.uTime.value = t;
      engine.starMatNear.uniforms.uTime.value = t * 1.3;
      consumeNav();

      if (!introDone) {
        const p = easeInOutCubic(Math.min(1, (now - introStart) / 3200));
        camera.position.lerpVectors(introFrom, introTo, p);
        tmpTarget.set(0, -60, 0).lerp(overviewPose.tgt, p);
        controls.target.copy(tmpTarget);
        camera.lookAt(controls.target);
        if (p >= 1) { introDone = true; controls.enabled = true; }
      } else if (flightRef.current) {
        const fl = flightRef.current;
        const p = Math.min(1, (now - fl.start) / fl.dur);
        const e = easeInOutCubic(p);
        camera.position.lerpVectors(fl.fromPos, fl.toPos, e);
        controls.target.lerpVectors(fl.fromTgt, fl.toTgt, e);
        camera.lookAt(controls.target);
        warpEnvRef.current = Math.pow(Math.sin(Math.PI * p), 1.15);
        if (p >= 1) { flightRef.current = null; controls.enabled = true; lastInteractRef.current = now; }
      } else {
        warpEnvRef.current *= Math.pow(.045, dt);
        const idle = now - lastInteractRef.current > 9000 && selectedRef.current == null && !tourStateRef.current.on;
        controls.autoRotate = idle;
        controls.update();
      }
      const warp = THREE.MathUtils.clamp(warpEnvRef.current, 0, 1);
      engine.starMatFar.uniforms.uWarp.value = warp;
      engine.starMatNear.uniforms.uWarp.value = warp;
      engine.bloom.strength = .2 + warp * .38;
      camera.fov = 50 + warp * 15;
      camera.updateProjectionMatrix();
      stage.style.setProperty("--neo-warp", String(Math.max(0, warp * 1.08 - .06)));

      engine.galaxy.rotation.y += dt * .012;

      if (tourStateRef.current.on && !flightRef.current && now - introStart > 3400 && now >= (tourNextAtRef.current ?? 0)) {
        const count = orbsRef.current.length;
        if (count) {
          const next = ((tourStateRef.current.idx ?? selectedRef.current ?? -1) + 1) % count;
          tourStateRef.current.idx = next;
          selectRef.current(next, true);
          tourNextAtRef.current = now + 8200;
        }
      }

      const filter = sectorFilterRef.current;
      orbsRef.current.forEach((orb) => {
        const item = itemsRef.current[orb.index];
        const dimTarget = filter && item && item.sector !== filter ? .16 : 1;
        orb.dim += (dimTarget - orb.dim) * Math.min(1, dt * 7);
        orb.flash *= Math.pow(.22, dt);
        orb.group.position.set(
          orb.base.x + Math.sin(t * .32 + orb.seed * 9.4) * 9,
          orb.base.y + Math.sin(t * .47 + orb.seed * 17.3) * orb.bobAmp,
          orb.base.z + Math.cos(t * .27 + orb.seed * 5.1) * 9,
        );
        const pulse = orb.flash;
        orb.core.material.uniforms.uTime.value = t;
        orb.core.material.uniforms.uPulse.value = pulse;
        orb.core.material.uniforms.uDim.value = orb.dim;
        orb.halo.material.opacity = (.13 + pulse * .2) * orb.dim;
        const haloScale = orb.r * (2.55 + Math.sin(t * 1.6 + orb.seed * 6.28) * .1 + pulse * .35);
        orb.halo.scale.set(haloScale, haloScale, 1);
        orb.labelSprite.visible = labelsOnRef.current && orb.dim > .5;
        if (orb.ring) {
          orb.ring.rotation.z += dt * .5;
          orb.ring.rotation.x = Math.PI / 2.6 + Math.sin(t * .4 + orb.seed) * .12;
        }
      });

      engine.constellationGroup.children.forEach((line) => {
        const target = line.userData.targetOpacity as number;
        const mat = (line as THREE.Line).material as THREE.LineBasicMaterial;
        mat.opacity += (target - mat.opacity) * Math.min(1, dt * 6);
      });

      engine.rings.forEach((slot) => {
        if (!slot.active) return;
        slot.age += dt / slot.life;
        if (slot.age >= 1) { slot.active = false; slot.mesh.visible = false; return; }
        const s = slot.orbR * (1.3 + slot.age * 3.6);
        slot.mesh.scale.setScalar(s);
        slot.mesh.material.opacity = Math.pow(1 - slot.age, 1.6) * .42;
      });
      engine.bursts.forEach((burst) => {
        if (!burst.active) return;
        burst.age += dt / burst.life;
        if (burst.age >= 1) { burst.active = false; burst.points.visible = false; return; }
        const damp = Math.pow(.5, dt * 1.6);
        const n = burst.positions.length / 3;
        for (let i = 0; i < n; i++) {
          burst.velocities[i * 3] *= damp;
          burst.velocities[i * 3 + 1] *= damp;
          burst.velocities[i * 3 + 2] *= damp;
          burst.positions[i * 3] += burst.velocities[i * 3] * dt;
          burst.positions[i * 3 + 1] += burst.velocities[i * 3 + 1] * dt;
          burst.positions[i * 3 + 2] += burst.velocities[i * 3 + 2] * dt;
          burst.ages[i] = burst.age;
        }
        burst.points.geometry.attributes.position.needsUpdate = true;
        burst.points.geometry.attributes.aAge.needsUpdate = true;
      });

      raycaster.setFromCamera(pointerNdcRef.current, camera);
      const hits = raycaster.intersectObjects(pickMeshesRef.current, false);
      const hovered = hits.length && !flightRef.current && now - introStart > 3300 ? hits[0].object.userData.index as number : null;
      if (hovered !== hoverIdxRef.current) {
        hoverIdxRef.current = hovered;
        const reticle = reticleRef.current;
        if (reticle) {
          if (hovered == null) reticle.dataset.on = "0";
          else {
            const item = itemsRef.current[hovered];
            const tag = reticle.querySelector<HTMLElement>(".neo-reticle-tag");
            if (tag && item) tag.textContent = `${shortName(item, marketRef.current)} ${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`;
            reticle.dataset.on = "1";
          }
          dom.style.cursor = hovered != null ? "pointer" : "grab";
        }
      }
      const reticle = reticleRef.current;
      if (reticle && hoverIdxRef.current != null) {
        const orb = orbsRef.current[hoverIdxRef.current];
        if (orb) {
          orb.group.getWorldPosition(worldPos);
          projected.copy(worldPos).project(camera);
          const w = stage.clientWidth, h = stage.clientHeight;
          const px = (projected.x * .5 + .5) * w;
          const py = (-projected.y * .5 + .5) * h;
          const dist = camera.position.distanceTo(worldPos);
          const sizePx = THREE.MathUtils.clamp((orb.r * 2.9 / dist) * 900, 46, 210);
          reticle.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%,-50%)`;
          reticle.style.width = `${sizePx.toFixed(0)}px`;
          reticle.style.height = `${sizePx.toFixed(0)}px`;
        }
      }

      mmAccRef.current += dt;
      if (mmAccRef.current > .12) { mmAccRef.current = 0; drawMinimap(now); }

      engine.composer.render();
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointermove", onPointerMoveTrack);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("dblclick", onDblClick);
      controls.dispose();
      disposeOrbs(orbsRef.current);
      orbsRef.current = [];
      pickMeshesRef.current = [];
      flightRef.current = null;
      engine.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry && mesh.geometry !== CORE_GEO && mesh.geometry !== RING_GEO) mesh.geometry.dispose();
        const owner = mesh as unknown as { material?: THREE.Material | THREE.Material[] };
        if (Array.isArray(owner.material)) owner.material.forEach((m) => m.dispose());
        else if (owner.material) owner.material.dispose();
      });
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === stage) stage.removeChild(renderer.domElement);
      engineRef.current = null;
    };
  }, [webglBroken]);

  useEffect(() => {
    const engine = engineRef.current;
    const items = itemsRef.current;
    const teardownOrbs = () => {
      const eng = engineRef.current;
      orbsRef.current.forEach((orb) => {
        if (orb.group.parent) orb.group.parent.remove(orb.group);
      });
      void eng;
      disposeOrbs(orbsRef.current);
      orbsRef.current = [];
      pickMeshesRef.current = [];
    };
    if (!engine || loading || items.length === 0) {
      teardownOrbs();
      return;
    }
    teardownOrbs();
    engine.constellationGroup.clear();
    const count = items.length;
    const anchors: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let i = 0; i < count; i++) {
      const arm = i % 2;
      const k = Math.floor(i / 2);
      const half = Math.ceil(count / 2) - 1;
      const tt = half ? k / half : 0;
      const angle = arm * Math.PI + tt * Math.PI * 2.12 + (seeded(i, 3) - .5) * .42;
      const radius = 190 + tt * 600 + (seeded(i, 5) - .5) * 56;
      radii.push(i < 2 ? 52 : i < 5 ? 40 : i < 9 ? 31 : i < 15 ? 25 : 20);
      anchors.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(tt * Math.PI * 1.5 + arm * 1.3) * 30 * (1 - tt * .35) + (seeded(i, 7) - .5) * 30,
        Math.sin(angle) * radius,
      ));
    }
    const spread = anchors.map((a) => a.clone());
    {
      const diff = new THREE.Vector3();
      const maxHoriz = 800, maxY = 78;
      const rotateXZ = (v: THREE.Vector3, ang: number) => {
        const c = Math.cos(ang), s = Math.sin(ang);
        const x = v.x, z = v.z;
        v.x = c * x + s * z;
        v.z = -s * x + c * z;
      };
      const pairPass = () => {
        let conflicts = 0;
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) {
            diff.copy(spread[i]).sub(spread[j]);
            let d = diff.length();
            if (d <= 1e-4) { diff.copy(anchors[i]).sub(anchors[j]); d = diff.length() || 1; }
            const minDist = (radii[i] + radii[j]) * 1.85 + 48;
            if (d < minDist) {
              const push = (minDist - d) * .5;
              diff.divideScalar(d || 1);
              spread[i].addScaledVector(diff, push);
              spread[j].addScaledVector(diff, -push);
              conflicts++;
            }
            const riH = Math.hypot(spread[i].x, spread[i].z);
            const rjH = Math.hypot(spread[j].x, spread[j].z);
            if (riH > 50 && rjH > 50 && Math.abs(riH - rjH) < (radii[i] + radii[j]) * 2.8) {
              let dAz = Math.atan2(spread[j].z, spread[j].x) - Math.atan2(spread[i].z, spread[i].x);
              while (dAz > Math.PI) dAz -= Math.PI * 2;
              while (dAz < -Math.PI) dAz += Math.PI * 2;
              const needAz = Math.min(Math.PI * .45, ((radii[i] + radii[j]) * 1.3 + 55) / Math.min(riH, rjH));
              if (Math.abs(dAz) < needAz) {
                const rot = (needAz - Math.abs(dAz)) * .38 * (dAz >= 0 ? 1 : -1);
                rotateXZ(spread[i], rot);
                rotateXZ(spread[j], -rot);
                conflicts++;
              }
            }
          }
        }
        return conflicts;
      };
      for (let iter = 0; iter < 150; iter++) {
        const conflicts = pairPass();
        for (let i = 0; i < count; i++) {
          spread[i].lerp(anchors[i], .03);
          const horiz = Math.hypot(spread[i].x, spread[i].z);
          if (horiz > maxHoriz) spread[i].x *= maxHoriz / horiz, spread[i].z *= maxHoriz / horiz;
          spread[i].y = THREE.MathUtils.clamp(spread[i].y, -maxY, maxY);
        }
        if (conflicts === 0 && iter > 12) break;
      }
      for (let pass = 0; pass < 120 && pairPass() > 0; pass++);
    }
    const orbits: Orb[] = [];
    for (let i = 0; i < count; i++) {
      const base = spread[i];
      const r = radii[i];
      const palette = colorsRef.current[i];
      const colorA = new THREE.Color(palette?.[0] ?? "#8fd6ff");
      const colorB = new THREE.Color(palette?.[1] ?? "#20456e");
      const chg = items[i].change_pct;
      const tint = new THREE.Color(chg < -.04 ? 0xff4d67 : chg > .04 ? 0x2effb0 : 0xbfd8ee);
      const mat = new THREE.ShaderMaterial({
        vertexShader: CORE_VERT, fragmentShader: CORE_FRAG,
        uniforms: {
          uTime: { value: seeded(i, 11) * 20 }, uSeed: { value: seeded(i, 11) },
          uColorA: { value: colorA }, uColorB: { value: colorB },
          uTint: { value: tint }, uToneAmt: { value: THREE.MathUtils.clamp(Math.abs(chg) / 5, 0, 1) },
          uPulse: { value: 0 }, uDim: { value: 1 },
        },
        transparent: true,
      });
      const core = new THREE.Mesh(coreGeometry(), mat);
      core.userData.index = i;
      core.scale.setScalar(r);
      const group = new THREE.Group();
      group.position.copy(base);
      group.add(core);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTexture(), color: colorA, transparent: true, opacity: .16,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.renderOrder = -1;
      group.add(halo);
      let ring: Orb["ring"] = null;
      if (i === 0) {
        ring = new THREE.Mesh(ringGeometry(), new THREE.MeshBasicMaterial({
          color: 0xffd66e, transparent: true, opacity: .5,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        }));
        ring.scale.setScalar(r * 1.55);
        group.add(ring);
      }
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 720; labelCanvas.height = 330;
      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      labelTexture.colorSpace = THREE.SRGBColorSpace;
      labelTexture.anisotropy = 8;
      labelTexture.minFilter = THREE.LinearMipmapLinearFilter;
      const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: labelTexture, transparent: true, depthWrite: false,
      }));
      const lw = r * 3.0;
      labelSprite.scale.set(lw, lw * (330 / 720), 1);
      labelSprite.position.set(0, -(r * 1.72), 0);
      group.add(labelSprite);
      engine.galaxy.add(group);
      const orb: Orb = {
        index: i, group, core, halo, ring,
        labelSprite, labelCanvas, labelTexture, logoImg: null,
        base, r, seed: seeded(i, 11),
        bobAmp: 7 + seeded(i, 15) * 9,
        flash: .9, dim: 1,
      };
      drawLabel(orb, items[i], marketRef.current, palette ?? null);
      const logoSrc = marketRef.current === "nasdaq" ? usCompanyLogoProxyUrl(items[i].code) : stockIconUrl(items[i].code);
      transparentBubbleLogo(logoSrc).then((url) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          orb.logoImg = img;
          drawLabel(orb, itemsRef.current[i] ?? items[i], marketRef.current, colorsRef.current[i] ?? null);
        };
        img.src = url;
      }).catch(() => undefined);
      orbits.push(orb);
    }
    const bySector = new Map<string, number[]>();
    items.forEach((it, i) => {
      const list = bySector.get(it.sector) ?? [];
      list.push(i);
      bySector.set(it.sector, list);
    });
    bySector.forEach((members, sector) => {
      if (members.length < 2) return;
      const color = new THREE.Color().setHSL(sectorHue(sector), .85, .62);
      const ordered = members.slice().sort((a, b) => items[a].rank - items[b].rank);
      const geo = new THREE.BufferGeometry().setFromPoints(ordered.map((idx) => orbits[idx].base.clone()));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      line.userData.sector = sector;
      line.userData.targetOpacity = sectorFilterRef.current
        ? (sector === sectorFilterRef.current ? .55 : .045)
        : .22;
      engine.constellationGroup.add(line);
    });
    engine.constellationGroup.visible = linesOnRef.current;
    orbsRef.current = orbits;
    pickMeshesRef.current = orbits.map((o) => o.core);
    prevClosesRef.current = new Map(items.map((it) => [it.code, it.close]));
    navRef.current = { idx: -1, nonce: navRef.current.nonce + 1 };
    return () => {
      const eng = engineRef.current;
      orbsRef.current.forEach((orb) => {
        if (orb.group.parent) orb.group.parent.remove(orb.group);
      });
      void eng;
      disposeOrbs(orbsRef.current);
      orbsRef.current = [];
      pickMeshesRef.current = [];
    };
  }, [loading, market, codesKey]);

  useEffect(() => {
    applyFilterRef.current();
    const engine = engineRef.current;
    if (!engine) return;
    const items = itemsRef.current;
    orbsRef.current.forEach((orb) => {
      const item = items[orb.index];
      if (!item) return;
      const palette = colorsRef.current[orb.index];
      orb.core.material.uniforms.uColorA.value = new THREE.Color(palette?.[0] ?? "#8fd6ff");
      orb.core.material.uniforms.uColorB.value = new THREE.Color(palette?.[1] ?? "#20456e");
      orb.halo.material.color = new THREE.Color(palette?.[0] ?? "#8fd6ff");
      drawLabel(orb, item, marketRef.current, palette ?? null);
      const prevClose = prevClosesRef.current.get(item.code);
      if (prevClose != null && Math.abs(prevClose - item.close) > 1e-9) orb.flash = Math.min(1, orb.flash + .55);
      if (Math.abs(item.change_pct) >= 2.5 && prevClose != null && prevClose !== item.close) eruptionRef.current(orb);
      prevClosesRef.current.set(item.code, item.close);
    });
  }, [board, bubbleColors]);

  useEffect(() => {
    const canvas = sparkRef.current;
    const item = selectedIndex != null ? itemsRef.current[selectedIndex] : null;
    if (!canvas || !item || item.points.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const pts = item.points;
    const min = Math.min(...pts), max = Math.max(...pts);
    const span = max - min || 1;
    const px = (i: number) => 4 + (i / (pts.length - 1)) * (W - 8);
    const py = (v: number) => H - 6 - ((v - min) / span) * (H - 12);
    const up = item.change_pct >= 0;
    const stroke = up ? "#37e8a9" : "#ff5d73";
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, up ? "rgba(55,232,169,.34)" : "rgba(255,93,115,.34)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    pts.forEach((v, i) => { if (i === 0) ctx.moveTo(px(0), py(v)); else ctx.lineTo(px(i), py(v)); });
    ctx.lineTo(px(pts.length - 1), H);
    ctx.lineTo(px(0), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    pts.forEach((v, i) => { if (i === 0) ctx.moveTo(px(0), py(v)); else ctx.lineTo(px(i), py(v)); });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.shadowColor = stroke;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(px(pts.length - 1), py(pts[pts.length - 1]), 3, 0, Math.PI * 2);
    ctx.fill();
  }, [selectedIndex, board]);

  useEffect(() => {
    if (linesOn && engineRef.current) engineRef.current.constellationGroup.visible = true;
    else if (engineRef.current) engineRef.current.constellationGroup.visible = linesOn;
  }, [linesOn]);

  const tourNextAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (tourOn) {
      tourStateRef.current = { on: true, idx: null };
      tourNextAtRef.current = performance.now() + 500;
    } else {
      tourStateRef.current = { on: false, idx: null };
      tourNextAtRef.current = null;
    }
  }, [tourOn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDiscussionIndex(null);
        if (selectedRef.current != null) {
          setSelectedIndex(null);
          navRef.current = { idx: -1, nonce: navRef.current.nonce + 1 };
        }
        stopTour();
      }
      if (event.key === " " && !event.repeat) {
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea")) return;
        event.preventDefault();
        setTourOn((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopTour]);

  useEffect(() => {
    if (board && !splashGone) {
      const id = window.setTimeout(() => setSplashGone(true), 1900);
      return () => window.clearTimeout(id);
    }
  }, [board, splashGone]);

  const openDetail = useCallback((index: number) => {
    const item = itemsRef.current[index];
    if (!item) return;
    reportMarketBubbleEvent({ action: "stock_detail", market, code: item.code, name: item.name });
    navigate(market === "nasdaq" ? `/global?code=${item.code}` : `/stock/${item.code}`);
  }, [market]);

  const resetView = useCallback(() => {
    stopTour();
    setSelectedIndex(null);
    navRef.current = { idx: -1, nonce: navRef.current.nonce + 1 };
  }, [stopTour]);

  const minimapClick = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const wx = ((event.clientX - rect.left) / rect.width - .5) * 2 * MAP_RANGE;
    const wz = ((event.clientY - rect.top) / rect.height - .5) * 2 * MAP_RANGE;
    const rotY = engineRef.current?.galaxy.rotation.y ?? 0;
    const bx = wx * Math.cos(rotY) - wz * Math.sin(rotY);
    const bz = wx * Math.sin(rotY) + wz * Math.cos(rotY);
    let best = -1, bestDist = 140;
    orbsRef.current.forEach((orb, i) => {
      const d = Math.hypot(orb.base.x - bx, orb.base.z - bz);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    if (best >= 0) selectRef.current(best);
  }, []);

  const items = itemsRef.current;
  const breadth = board?.breadth;
  const selectedItem = selectedIndex != null ? items[selectedIndex] : null;
  const selectedColors = selectedIndex != null ? bubbleColors[selectedIndex] : undefined;
  const sessionBadge = board && market === "nasdaq" && board.session !== "regular"
    ? board.session === "pre" ? "장전 거래" : "시간외 거래"
    : null;

  return (
    <main className={`neo-page${splashGone ? " is-ready" : ""}`} ref={stageRef}>
      <div className="neo-warp-overlay" aria-hidden="true" />
      <div className="neo-vignette" aria-hidden="true" />

      <header className="neo-header">
        <div className="neo-header-side">
          <Link to="/desk" className="neo-back" aria-label="메인 대시보드로 돌아가기"><span>←</span></Link>
          <Link to="/desk" className="neo-brand">
            <span className="neo-brand-mark"><MarketBubbleIcon /></span>
            <span className="neo-brand-copy">
              <strong>증시버블 <em>NEO</em></strong>
              <small>DEEP-SPACE GALAXY · TYPE 2</small>
            </span>
          </Link>
          <button type="button" className="neo-classic-chip" onClick={() => navigate("/market-bubbles")}>클래식 ver</button>
        </div>
        <nav className="neo-market-tabs" role="tablist" aria-label="시장 선택">
          {MARKETS.map((entry) => (
            <button key={entry.key} role="tab" aria-selected={market === entry.key}
              className={market === entry.key ? "is-active" : ""}
              onClick={() => { if (market !== entry.key) { reportMarketBubbleEvent({ action: "market_switch", market: entry.key }); setMarket(entry.key); } }}>
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="neo-header-side neo-header-right">
          {breadth && (
            <div className="neo-breadth" aria-label="시장 등락 요약">
              <b className="is-up">▲ {breadth.up}</b>
              <b className="is-down">▼ {breadth.down}</b>
              <span className={breadth.avg_change_pct >= 0 ? "is-up" : "is-down"}>
                평균 {breadth.avg_change_pct > 0 ? "+" : ""}{breadth.avg_change_pct.toFixed(2)}%
              </span>
            </div>
          )}
          <div className="neo-live"><i /> LIVE <span>{board ? new Date(board.generated_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}</span></div>
        </div>
      </header>

      <aside className="neo-rail" aria-label="시가총액 순위 탐색">
        <div className="neo-rail-head"><b>RANK INDEX</b><span>시총 TOP {items.length}</span></div>
        <div className="neo-sector-chips" role="group" aria-label="업종 필터">
          <button type="button" className={sectorFilter == null ? "is-active" : ""} onClick={() => setSectorFilter(null)}>전체</button>
          {sectorChips.map((sector) => (
            <button key={sector} type="button" className={sectorFilter === sector ? "is-active" : ""}
              onClick={() => setSectorFilter((prev) => prev === sector ? null : sector)}>{sector || "기타"}</button>
          ))}
        </div>
        <div className="neo-rail-list">
          {items.map((item, index) => (
            <button key={`${market}-${item.code}`} type="button"
              className={`neo-rail-row${selectedIndex === index ? " is-selected" : ""}`}
              onClick={() => selectRef.current(index)}>
              <span className={`neo-rank-badge${item.rank <= 3 ? " is-top" : ""}`}>{item.rank}</span>
              <img src={market === "nasdaq" ? usCompanyLogoUrl(item.code) : stockIconUrl(item.code)} alt="" loading="lazy"
                onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              <span className="neo-rail-name">{shortName(item, market)}</span>
              <b className={item.change_pct > .04 ? "is-up" : item.change_pct < -.04 ? "is-down" : ""}>
                {item.change_pct > 0 ? "+" : ""}{item.change_pct.toFixed(2)}%
              </b>
            </button>
          ))}
          {!loading && items.length === 0 && <div className="neo-rail-empty">데이터를 불러오지 못했습니다</div>}
        </div>
      </aside>

      <div className="neo-dock" role="toolbar" aria-label="탐색 컨트롤">
        <button type="button" className="neo-dock-btn" onClick={resetView}><span>⌂</span>전체 보기</button>
        <button type="button" className={`neo-dock-btn${tourOn ? " is-active" : ""}`} onClick={() => setTourOn((v) => !v)}>
          <span>{tourOn ? "■" : "▶"}</span>{tourOn ? "투어 정지" : "시네마 투어"}
        </button>
        <button type="button" className={`neo-dock-btn${labelsOn ? " is-active" : ""}`} onClick={() => setLabelsOn((v) => !v)}><span>◈</span>라벨</button>
        <button type="button" className={`neo-dock-btn${linesOn ? " is-active" : ""}`} onClick={() => setLinesOn((v) => !v)}><span>✶</span>별자리</button>
      </div>

      <div className="neo-hint">드래그 회전 · 휠 줌 · <b>클릭 = 워프</b> · 더블클릭 = 종목 상세 · ESC 닫기 · SPACE 투어</div>

      <div className="neo-radar-wrap">
        <span className="neo-radar-caption">RADAR · 클릭 탐색</span>
        <canvas ref={minimapRef} width={168} height={168} onClick={minimapClick} aria-label="은하 레이더" />
      </div>

      {selectedItem && (
        <aside className="neo-holo" style={{ "--holo-a": selectedColors?.[0] ?? "#8fd6ff", "--holo-b": selectedColors?.[1] ?? "#20456e" } as CSSProperties} aria-label={`${shortName(selectedItem, market)} 정보`}>
          <i className="neo-holo-corner tl" /><i className="neo-holo-corner tr" /><i className="neo-holo-corner bl" /><i className="neo-holo-corner br" />
          <header className="neo-holo-head">
            <img src={market === "nasdaq" ? usCompanyLogoUrl(selectedItem.code) : stockIconUrl(selectedItem.code)} alt=""
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <div className="neo-holo-id">
              <h2>{shortName(selectedItem, market)}</h2>
              <p><span className="neo-sector-tag">{selectedItem.sector || "—"}</span>#{selectedItem.rank}{sessionBadge ? ` · ${sessionBadge}` : ""}</p>
            </div>
            <div className="neo-holo-hop">
              <button type="button" aria-label="이전 종목" disabled={selectedIndex === 0} onClick={() => selectedIndex != null && selectRef.current(selectedIndex - 1)}>‹</button>
              <button type="button" aria-label="다음 종목" disabled={selectedIndex == null || selectedIndex >= items.length - 1} onClick={() => selectedIndex != null && selectRef.current(selectedIndex + 1)}>›</button>
            </div>
            <button type="button" className="neo-holo-close" aria-label="정보 패널 닫기" onClick={resetView}>×</button>
          </header>
          <div className="neo-holo-quote">
            <strong>{formatPrice(selectedItem, market)}</strong>
            <div className="neo-quote-pills">
              <b className={selectedItem.change_pct > .04 ? "is-up" : selectedItem.change_pct < -.04 ? "is-down" : ""}>{formatChangeAbs(selectedItem)}{market === "nasdaq" ? "$" : "원"}</b>
              <b className={selectedItem.change_pct > .04 ? "is-up" : selectedItem.change_pct < -.04 ? "is-down" : ""}>
                {selectedItem.change_pct > 0 ? "+" : ""}{selectedItem.change_pct.toFixed(2)}%
              </b>
            </div>
          </div>
          <canvas ref={sparkRef} width={288} height={62} className="neo-spark" aria-hidden="true" />
          <div className="neo-range">
            <span>{selectedItem.week52_low != null ? Math.round(selectedItem.week52_low).toLocaleString("ko-KR") : "—"}</span>
            <div className="neo-range-bar"><i style={{ left: `${((selectedItem.week52_pos ?? .5) * 100).toFixed(1)}%` }} /></div>
            <span>{selectedItem.week52_high != null ? Math.round(selectedItem.week52_high).toLocaleString("ko-KR") : "—"}</span>
          </div>
          <dl className="neo-stat-grid">
            <div><dt>시가총액</dt><dd>{formatMarketCap(selectedItem, market)}</dd></div>
            <div><dt>거래량</dt><dd>{formatVolume(selectedItem)}</dd></div>
            <div><dt>PER</dt><dd>{selectedItem.per != null ? selectedItem.per.toFixed(1) : "—"}</dd></div>
            <div><dt>ROE</dt><dd>{selectedItem.roe != null ? `${selectedItem.roe.toFixed(1)}%` : "—"}</dd></div>
            <div><dt>외국인</dt><dd>{selectedItem.foreign_ratio != null ? `${selectedItem.foreign_ratio.toFixed(1)}%` : "—"}</dd></div>
            <div><dt>1M 수익</dt><dd>{selectedItem.returns.m1 != null ? `${selectedItem.returns.m1 > 0 ? "+" : ""}${(selectedItem.returns.m1 * 100).toFixed(1)}%` : "—"}</dd></div>
          </dl>
          <div className="neo-holo-actions">
            <button type="button" className="neo-action primary" onClick={() => setDiscussionIndex(selectedIndex)}>토론 보기</button>
            <button type="button" className="neo-action" onClick={() => selectedIndex != null && openDetail(selectedIndex)}>종목 상세 ›</button>
          </div>
        </aside>
      )}

      <div className="neo-reticle" ref={reticleRef} data-on="0" aria-hidden="true">
        <i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" />
        <span className="neo-reticle-tag" />
      </div>

      {discussionIndex != null && items[discussionIndex] && (
        <>
          <button className="neo-scrim" type="button" aria-label="종목토론 닫기" onClick={() => setDiscussionIndex(null)} />
          <MarketBubbleDiscussion
            item={items[discussionIndex]}
            market={market}
            colors={(bubbleColors[discussionIndex] ?? ["#8fd6ff", "#20456e"]) as [string, string]}
            onClose={() => setDiscussionIndex(null)}
          />
        </>
      )}

      {(loading || !splashGone) && (
        <div className={`neo-splash${board ? " is-done" : ""}`}>
          <div className="neo-splash-inner">
            <span className="neo-splash-mark"><MarketBubbleIcon /></span>
            <strong>증시버블 <em>NEO</em></strong>
            <small>TYPE-2 · DEEP SPACE EDITION</small>
            <div className="neo-splash-bar"><i /></div>
            <span className="neo-splash-status">{loading ? "시장 데이터 수신 중" : "은하 진입 중"}</span>
          </div>
        </div>
      )}
      {webglBroken && <div className="neo-webgl-error">이 브라우저는 WebGL을 지원하지 않아 은하 항해을 시작할 수 없습니다.</div>}
    </main>
  );
}
