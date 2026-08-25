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
  atmo: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
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
  dustMat: THREE.ShaderMaterial;
  dustGroup: THREE.Group;
  pixelRatioUniforms: { value: number }[];
  rings: RingSlot[];
  bursts: BurstSlot[];
};

let CORE_GEO: THREE.SphereGeometry | null = null;
function coreGeometry() {
  if (!CORE_GEO) CORE_GEO = new THREE.SphereGeometry(1, 72, 50);
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
    grad.addColorStop(0, "rgba(255,255,255,.95)");
    grad.addColorStop(.12, "rgba(255,255,255,.5)");
    grad.addColorStop(.34, "rgba(255,255,255,.15)");
    grad.addColorStop(.68, "rgba(255,255,255,.04)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  HALO_TEX = new THREE.CanvasTexture(canvas);
  return HALO_TEX;
}
let GLOW_TEX: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 4, 128, 128, 126);
    grad.addColorStop(0, "rgba(255,255,255,.9)");
    grad.addColorStop(.18, "rgba(255,255,255,.38)");
    grad.addColorStop(.45, "rgba(255,255,255,.12)");
    grad.addColorStop(.75, "rgba(255,255,255,.03)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  GLOW_TEX = new THREE.CanvasTexture(canvas);
  return GLOW_TEX;
}

function disposeOrbs(orbs: Orb[]) {
  orbs.forEach((orb) => {
    orb.core.material.dispose();
    orb.atmo.material.dispose();
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
        const pastel = new THREE.Color().setHSL(hsl.h, saturation, .47);
        const shade = new THREE.Color().setHSL(hsl.h, Math.min(.98, saturation * 1.04), .21);
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
/** Signed change with the currency symbol on the correct side ($ prefix / 원 suffix). */
function formatChangeWithUnit(item: StockBoardItem, market: Market) {
  const sign = item.change < 0 ? "-" : "+";
  const abs = Math.abs(item.change);
  const digits = abs >= 100 ? 0 : 2;
  const num = abs.toLocaleString(market === "nasdaq" ? "en-US" : "ko-KR", {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : digits,
    maximumFractionDigits: digits,
  });
  return market === "nasdaq" ? `${sign}$${num}` : `${sign}${num}원`;
}
function formatClock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
uniform float uTime; uniform float uSeed; uniform float uPulse; uniform float uDim; uniform float uToneAmt; uniform float uType;
varying vec3 vN; varying vec3 vLocal; varying vec3 vWorld;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float noise(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
/* Low-octave fbm only: fewer layers = softer, silkier surface gradients. */
float fbm(vec3 p){ float v=0.0; float a=0.5; for(int k=0;k<3;k++){ v+=a*noise(p); p=p*2.02+11.3; a*=0.55; } return v; }
/* Smooth-gradient surface model. One low-frequency field per planet type drives
   a clean A→B colour blend — no bump mapping, no high-frequency grain, so the
   spheres read as polished gradient worlds instead of rocky lumps.
   g: pattern value · glo: glossiness · emi: self-glow · cap: polar ice whitening */
void surf(in vec3 pr, in float t, out float g, out float glo, out float emi, out float cap){
  g=0.5; glo=0.35; emi=0.0; cap=0.0;
  if(uType<0.5){
    /* banded gas giant: soft latitude bands meandering very slowly */
    float w=fbm(pr*1.15+uSeed*7.7+vec3(t*0.018,0.0,-t*0.012));
    float band=sin(pr.y*8.6+w*2.4+t*0.05);
    g=0.5+0.5*band; g=g*g*(3.0-2.0*g);
    glo=0.36;
  } else if(uType<1.5){
    /* ocean world: broad continents with wide soft shorelines + smooth ice caps */
    float c=fbm(pr*1.30+uSeed*13.1+vec3(t*0.01,0.0,t*0.008));
    float land=smoothstep(0.44,0.62,c);
    cap=smoothstep(0.80,0.96,abs(pr.y)+c*0.05-0.02)*0.85;
    g=clamp(land*0.82+c*0.22+0.06,0.0,1.0);
    glo=mix(0.55,0.22,land);
  } else if(uType<2.5){
    /* marble moon: broad silky patches (former craters, now smooth) */
    float m=fbm(pr*1.05+uSeed*19.3+vec3(0.0,t*0.006,0.0));
    g=smoothstep(0.32,0.70,m);
    glo=0.20;
  } else if(uType<3.5){
    /* frost giant: silky streaks flowing around the sphere */
    vec3 q=vec3(pr.x*1.05,pr.y*2.4,pr.z*1.05);
    float s=fbm(q+uSeed*29.7+vec3(-t*0.025,t*0.012,0.0));
    g=smoothstep(0.34,0.68,s);
    glo=0.66;
  } else if(uType<4.5){
    /* ember world: charcoal-smooth body with soft glowing fissures */
    float v=fbm(pr*1.45+uSeed*23.9+vec3(0.0,t*0.01,0.0));
    float fissure=pow(max(0.0,1.0-abs(v-0.5)*3.0),3.2);
    g=0.20+fissure*0.50;
    emi=fissure*0.85;
    glo=0.26;
  } else {
    /* pale gas world: gentler, wider bands than type 0 */
    float w=fbm(pr*0.95+uSeed*31.3+vec3(0.0,t*0.014,0.0));
    float band=sin(pr.y*4.9+w*2.0+t*0.04);
    g=clamp(0.5+0.44*band,0.0,1.0);
    glo=0.52;
  }
}
void main(){
  vec3 N=normalize(vN);
  vec3 V=normalize(cameraPosition-vWorld);
  vec3 p=normalize(vLocal);
  float rot=uTime*0.045+uSeed*6.2831853;
  float ca=cos(rot), sa=sin(rot);
  vec3 pr=vec3(ca*p.x-sa*p.z, p.y, sa*p.x+ca*p.z);
  float t=uTime*0.5;
  float g,glo,emi,cap;
  surf(pr,t,g,glo,emi,cap);
  float ndv=clamp(dot(N,V),0.0,1.0);
  /* gentle latitude falloff blended under the pattern keeps every planet
     reading as one smooth two-tone gradient sphere */
  float lat=0.5+0.5*sin(pr.y*2.6+uSeed*3.0);
  float m=clamp(g*0.78+lat*0.22,0.0,1.0);
  vec3 Lk=normalize(vec3(-0.52,0.72,0.46));
  vec3 Lf=normalize(vec3(0.62,-0.28,0.5));
  float wrapk=pow(clamp(dot(N,Lk)*0.5+0.5,0.0,1.0),1.5);
  float difff=clamp(dot(N,Lf),0.0,1.0);
  vec3 base=mix(uColorB,uColorA,m);
  base*=0.96+m*0.07;
  if(cap>0.002){ base=mix(base,vec3(0.88,0.93,0.97),cap); }
  base=mix(base,uTint,uToneAmt*(0.16+0.28*m));
  float fr=0.04+0.96*pow(1.0-ndv,5.0);
  vec3 R=reflect(-V,N);
  vec3 env=mix(vec3(0.05,0.07,0.12),vec3(0.17,0.24,0.37),clamp(R.y*0.5+0.5,0.0,1.0));
  env+=vec3(0.95,0.97,1.0)*pow(max(dot(R,Lk),0.0),40.0)*0.55;
  env+=vec3(0.34,0.52,0.72)*pow(max(dot(R,normalize(vec3(0.30,0.82,-0.42))),0.0),16.0)*0.20;
  vec3 H=normalize(Lk+V);
  float ndh=clamp(dot(N,H),0.0,1.0);
  float sglo=glo*(1.0-cap*0.45);
  float spec=pow(ndh,mix(110.0,54.0,sglo))*(0.30+sglo*0.45)+pow(ndh,14.0)*0.06;
  vec3 col=base*(0.38+0.56*wrapk+difff*0.10);
  col+=env*fr*(0.65+glo*0.5);
  col+=spec*mix(vec3(1.0),uColorA,0.30)*(0.30+0.55*fr);
  col+=uColorA*pow(1.0-ndv,3.4)*0.42;
  col+=mix(uColorA,uTint,0.55)*emi*(1.0+uPulse)*(1.0-wrapk*0.5)*1.15;
  col+=uTint*uPulse*0.90;
  col*=0.88+uPulse*0.45;
  float lg=dot(col,vec3(0.299,0.587,0.114));
  col=mix(vec3(lg),col,1.10);
  vec3 scc=col*col*(3.0-2.0*col);
  col=mix(col,scc,0.22);
  /* fine dither stays: it hides banding on the now-smooth gradients */
  col+=(hash(vec3(gl_FragCoord.xy,uTime))-0.5)*0.010;
  col*=mix(0.30,1.0,uDim);
  gl_FragColor=vec4(col,1.0);
}`;

/* Guaranteed-compile fallback for GPUs that reject the heavy core shader —
   keeps planets looking like shaded worlds instead of flat billiard balls. */
const FALLBACK_VERT = `
varying vec3 vN; varying vec3 vLocal; varying vec3 vWorld;
void main(){
  vN = normalize(normalMatrix * normal);
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FALLBACK_FRAG = `
uniform vec3 uColorA; uniform vec3 uColorB; uniform float uDim; uniform float uSeed;
varying vec3 vN; varying vec3 vLocal; varying vec3 vWorld;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 p = normalize(vLocal);
  float rot = uSeed * 6.2831853;
  float ca = cos(rot), sa = sin(rot);
  vec3 pr = vec3(ca*p.x - sa*p.z, p.y, sa*p.x + ca*p.z);
  float band = 0.5 + 0.5*sin(pr.y*7.0 + sin(pr.x*3.0 + uSeed*40.0)*1.4);
  vec3 L = normalize(vec3(-0.52, 0.72, 0.46));
  float diff = clamp(dot(N, L), 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
  vec3 col = mix(uColorB, uColorA, band);
  col *= 0.30 + 0.72*diff;
  col += uColorA * rim * 0.45;
  col *= mix(0.35, 1.0, uDim);
  gl_FragColor = vec4(col, 1.0);
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
float fbm(vec3 p){ float v=0.0; float a=0.5; for(int k=0;k<3;k++){ v+=a*noise(p); p=p*2.02+11.3; a*=0.55; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float n = fbm(d*3.1 + vec3(uTime*0.012, 0.0, uTime*0.008));
  float n2 = fbm(d*5.6 - vec3(uTime*0.02, uTime*0.01, 0.0));
  vec3 deep = vec3(0.012, 0.02, 0.05);
  vec3 violet = vec3(0.062, 0.032, 0.128);
  vec3 col = mix(deep, violet, smoothstep(0.38, 0.86, n));
  float cyanBand = smoothstep(0.60, 0.92, n2) * smoothstep(0.9, 0.35, abs(d.y));
  col += vec3(0.04, 0.15, 0.21) * cyanBand * 0.42;
  float magenta = smoothstep(0.72, 0.98, n) * smoothstep(0.55, 0.9, n2);
  col += vec3(0.14, 0.036, 0.17) * magenta * 0.30;
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

const ATMO_VERT = `
varying vec3 vN; varying vec3 vWorld;
void main(){
  vN = normalize(normalMatrix * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ATMO_FRAG = `
uniform vec3 uColor; uniform float uPulse; uniform float uTime;
varying vec3 vN; varying vec3 vWorld;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - clamp(dot(N,V), 0.0, 1.0), 3.4);
  vec3 L = normalize(vec3(-0.52, 0.72, 0.46));
  float day = clamp(dot(N,L)*0.6 + 0.45, 0.0, 1.0);
  float shimmer = 0.94 + 0.06*sin(uTime*0.9 + N.y*7.0 + N.x*5.0);
  vec3 col = uColor * rim * day * (1.1 + uPulse*1.5) * shimmer;
  gl_FragColor = vec4(col, rim*day*0.55);
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
  const plate = 47 * scale;
  const plateX = -chipW / 2 + 12 * scale;
  const pr2 = 10 * scale;
  const py0 = -plate / 2;
  ctx.beginPath();
  ctx.moveTo(plateX + pr2, py0);
  ctx.arcTo(plateX + plate, py0, plateX + plate, py0 + plate, pr2);
  ctx.arcTo(plateX + plate, py0 + plate, plateX, py0 + plate, pr2);
  ctx.arcTo(plateX, py0 + plate, plateX, py0, pr2);
  ctx.arcTo(plateX, py0, plateX + plate, py0, pr2);
  ctx.closePath();
  ctx.fillStyle = "rgba(240,245,250,.98)";
  ctx.fill();
  ctx.strokeStyle = "rgba(150,205,255,.42)";
  ctx.lineWidth = 1.1 * scale;
  ctx.stroke();
  if (orb.logoImg && orb.logoImg.complete && orb.logoImg.naturalWidth > 1) {
    const iw = orb.logoImg.naturalWidth, ih = orb.logoImg.naturalHeight;
    const box = plate - 9 * scale;
    const fit = Math.min(box / iw, box / ih);
    const dw = iw * fit, dh = ih * fit;
    try {
      ctx.drawImage(orb.logoImg, plateX + (plate - dw) / 2, -dh / 2, dw, dh);
    } catch {
      ctx.fillStyle = "#1c3a5e";
      ctx.font = `900 ${20 * scale}px Pretendard, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(item.name.slice(0, 1), plateX + plate / 2, 0);
    }
  } else {
    ctx.fillStyle = "#1c3a5e";
    ctx.font = `900 ${22 * scale}px Pretendard, "Noto Sans KR", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(item.name.slice(0, 1), plateX + plate / 2, 1 * scale);
  }
  const textX = plateX + plate + 10 * scale;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${17.5 * scale}px Pretendard, "Noto Sans KR", sans-serif`;
  const maxNameW = chipW / 2 - textX - 10 * scale;
  let nameText = shortName(item, market);
  if (ctx.measureText(nameText).width > maxNameW) {
    while (nameText.length > 1 && ctx.measureText(nameText + "…").width > maxNameW) {
      nameText = nameText.slice(0, -1);
    }
    nameText += "…";
  }
  ctx.fillStyle = "#dfeaf4";
  ctx.fillText(nameText, textX, -6 * scale);
  const up = item.change_pct > .04, down = item.change_pct < -.04;
  const priceColor = up ? "#43dfa1" : down ? "#ef5a70" : "#c2cfdd";
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
  ctx.strokeStyle = item.rank <= 3 ? "rgba(230,190,110,.8)" : "rgba(126,200,255,.4)";
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
  ctx.fillStyle = item.rank <= 3 ? "#eec86a" : "#b3cee6";
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
  /** Bumped when the GL context is lost & restored so the whole engine rebuilds. */
  const [glEpoch, setGlEpoch] = useState(0);

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
  const discussionOpenRef = useRef(false);
  const coreFallbackRef = useRef(false);
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
  discussionOpenRef.current = discussionIndex != null;

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

  const makeFallbackCoreMaterial = (index: number) => new THREE.ShaderMaterial({
    vertexShader: FALLBACK_VERT,
    fragmentShader: FALLBACK_FRAG,
    uniforms: {
      uColorA: { value: new THREE.Color(colorsRef.current[index]?.[0] ?? "#8fd6ff") },
      uColorB: { value: new THREE.Color(colorsRef.current[index]?.[1] ?? "#20456e") },
      uDim: { value: 1 },
      uSeed: { value: seeded(index, 11) },
    },
  });

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
    // An unfolded Galaxy Fold in landscape has a tablet-sized viewport but can
    // still fall below the old width-only mobile breakpoint. Keep the full
    // desktop scene/UI quality there; compact only genuinely narrow, portrait,
    // or short phone viewports. This mirrors the CSS media query below.
    const foldLandscapeDesktop =
      window.innerWidth >= 720 &&
      window.innerHeight >= 600 &&
      window.innerWidth > window.innerHeight;
    const mobile = window.innerWidth <= 820 && !foldLandscapeDesktop;
    const baseFov = mobile ? 58 : 50;
    let engine: Engine;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = .88;
      renderer.setClearColor(0x030512, 1);
      renderer.domElement.className = "neo-canvas";
      stage.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(baseFov, 1, 10, 12000);
      camera.position.set(0, 1750, 2750);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = .07;
      controls.enablePan = false;
      controls.rotateSpeed = .55;
      controls.zoomSpeed = .8;
      controls.minDistance = 220;
      controls.maxDistance = 4200;
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
      renderer.debug.onShaderError = (...args: unknown[]) => {
        coreFallbackRef.current = true;
        try {
          const gl = renderer.getContext();
          const parts: string[] = [];
          args.forEach((a) => {
            if (a != null && typeof a === "object") {
              try { const s = gl.getShaderInfoLog(a as WebGLShader); if (s) parts.push(s.slice(0, 900)); } catch { /* not a shader */ }
              try { const s = gl.getProgramInfoLog(a as WebGLProgram); if (s) parts.push("PROG: " + s.slice(0, 500)); } catch { /* not a program */ }
            }
          });
          console.error("[NEO-SHADER-FAIL]", parts.join(" || ") || "no info");
        } catch { /* noop */ }
      };

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
      const starMatFar = makeStars(mobile ? 750 : 1150, 2400, 4300, 1.4, 3.4);
      const starMatNear = makeStars(mobile ? 260 : 430, 750, 1900, 2.2, 5.2);

      const dustCount = mobile ? 320 : 560;
      const dustGeo = new THREE.BufferGeometry();
      const dPos = new Float32Array(dustCount * 3);
      const dSize = new Float32Array(dustCount);
      const dSeed = new Float32Array(dustCount);
      for (let i = 0; i < dustCount; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 140 + Math.pow(Math.random(), .72) * 680;
        dPos[i * 3] = Math.cos(ang) * rad;
        dPos[i * 3 + 1] = (Math.random() - .5) * 42 * (1 - Math.min(1, rad / 1000));
        dPos[i * 3 + 2] = Math.sin(ang) * rad;
        dSize[i] = .9 + Math.random() * 2.1;
        dSeed[i] = Math.random();
      }
      dustGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
      dustGeo.setAttribute("aSize", new THREE.BufferAttribute(dSize, 1));
      dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(dSeed, 1));
      const dustMat = new THREE.ShaderMaterial({
        vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
        uniforms: { uTime: { value: 0 }, uWarp: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const dustPoints = new THREE.Points(dustGeo, dustMat);
      dustPoints.frustumCulled = false;
      const dustGroup = new THREE.Group();
      dustGroup.add(dustPoints);
      scene.add(dustGroup);

      const mkGlowSprite = (color: number, scale: number, opacity: number, pos: [number, number, number], order: number) => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(), color, transparent: true, opacity,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        sp.scale.set(scale, scale, 1);
        sp.position.set(pos[0], pos[1], pos[2]);
        sp.renderOrder = order;
        scene.add(sp);
        return sp;
      };
      mkGlowSprite(0x4f8fd9, 1500, .17, [0, -30, 0], -4);
      mkGlowSprite(0xbfe4ff, 430, .15, [0, -10, 0], -3);
      mkGlowSprite(0x7a5bd9, 3400, .12, [-1900, 380, -2300], -5);
      mkGlowSprite(0x2fa8c9, 2900, .1, [2100, -160, -2000], -5);
      mkGlowSprite(0xc95bb9, 3100, .09, [500, 980, 2400], -5);

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
      const bloom = new UnrealBloomPass(new THREE.Vector2(stage.clientWidth || 1280, stage.clientHeight || 720), .28, .55, .5);
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

      engine = { renderer, scene, camera, controls, composer, bloom, galaxy, constellationGroup, starMatFar, starMatNear, nebulaMat, dustMat, dustGroup, pixelRatioUniforms: [starMatFar.uniforms.uPixelRatio, starMatNear.uniforms.uPixelRatio, dustMat.uniforms.uPixelRatio, ...bursts.map((b) => b.points.material.uniforms.uPixelRatio)], rings, bursts };
      engineRef.current = engine;
      (window as unknown as { __neo?: () => unknown }).__neo = () => ({
        fallback: coreFallbackRef.current,
        orbs: orbsRef.current.length,
        matType: orbsRef.current[0]?.core.material.type ?? "none",
        colorA: (() => {
          const u = (orbsRef.current[0]?.core.material as THREE.ShaderMaterial | undefined)?.uniforms?.uColorA?.value;
          return u && "getHexString" in u ? `#${(u as THREE.Color).getHexString()}` : String(u);
        })(),
        toneAmt: (orbsRef.current[0]?.core.material as THREE.ShaderMaterial | undefined)?.uniforms?.uToneAmt?.value,
      });
    } catch {
      setWebglBroken(true);
      return;
    }
    const { renderer, camera, controls, composer } = engine;

    const raycaster = new THREE.Raycaster();
    const projected = new THREE.Vector3();
    const worldPos = new THREE.Vector3();
    const tmpTarget = new THREE.Vector3();

    /* Dynamic overview framing. The galaxy is a flat disc (anchor clamp 720 +
       radii/bob ≈ 800 bound) seen at ~20° pitch: its on-screen vertical extent
       is the foreshortened tilt, its horizontal extent is the full radius. Fit
       both frustum axes separately so every planet stays framed on any aspect
       ratio without pushing the camera farther than needed. */
    const GALAXY_BOUND = 800;
    const computeOverviewPose = () => {
      const w = stage?.clientWidth || 16;
      const h = Math.max(1, stage?.clientHeight || 9);
      const aspect = Math.max(.55, w / h);
      const vHalf = THREE.MathUtils.degToRad(baseFov / 2);
      const hHalf = Math.atan(Math.tan(vHalf) * aspect);
      const dir = new THREE.Vector3(.06, .34, .94).normalize();
      const pitch = Math.asin(dir.y);
      const vertHalf = GALAXY_BOUND * Math.sin(pitch) + 92;
      const horizHalf = GALAXY_BOUND * 1.08;
      const dist = THREE.MathUtils.clamp(
        Math.max(vertHalf / Math.sin(vHalf), horizHalf / Math.sin(hHalf)) * 1.04,
        900, 3900,
      );
      return {
        pos: dir.multiplyScalar(dist),
        tgt: new THREE.Vector3(0, -10, 0),
      };
    };
    let overviewPose = computeOverviewPose();

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
    const onContextLost = (event: Event) => { event.preventDefault(); };
    const onContextRestored = () => setGlEpoch((v) => v + 1);
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
    dom.addEventListener("webglcontextlost", onContextLost);
    dom.addEventListener("webglcontextrestored", onContextRestored);

    /* Adaptive resolution: step the pixel ratio down when the average frame time
       blows past ~26fps for a while, and back up when there is headroom. Keeps
       weak GPUs away from driver timeouts (which black out the whole galaxy). */
    const basePR = renderer.getPixelRatio();
    const PR_STEPS = [basePR, basePR * .85, basePR * .72, basePR * .6];
    let prLevel = 0;
    let prFrames = 0;
    let prAccum = 0;
    let prCooldown = 0;
    const applyPixelRatio = () => {
      renderer.setPixelRatio(PR_STEPS[prLevel]);
      resize();
      const pr = PR_STEPS[prLevel];
      engine.pixelRatioUniforms.forEach((u) => { u.value = pr; });
    };

    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      overviewPose = computeOverviewPose();
      if (introDone && !flightRef.current && selectedRef.current == null &&
          !tourStateRef.current.on && camera.position.distanceTo(controls.target) > 640) {
        startFlight(overviewPose.pos, overviewPose.tgt, 900);
      }
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
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { previous = now; return; }
      const dt = Math.min(.05, (now - previous) / 1000);
      previous = now;
      const t = now / 1000;
      engine.nebulaMat.uniforms.uTime.value = t;
      engine.starMatFar.uniforms.uTime.value = t;
      engine.starMatNear.uniforms.uTime.value = t * 1.3;
      engine.dustMat.uniforms.uTime.value = t * 1.15;
      consumeNav();

      if (!introDone) {
        const p = easeInOutCubic(Math.min(1, (now - introStart) / 2600));
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
        controls.autoRotate = idle && !reducedMotion;
        controls.update();
      }
      const warp = THREE.MathUtils.clamp(warpEnvRef.current, 0, 1);
      engine.starMatFar.uniforms.uWarp.value = warp;
      engine.starMatNear.uniforms.uWarp.value = warp;
      engine.dustMat.uniforms.uWarp.value = warp;
      engine.bloom.strength = .28 + warp * .38;
      camera.fov = baseFov + warp * 14;
      camera.updateProjectionMatrix();
      stage.style.setProperty("--neo-warp", String(Math.max(0, warp * 1.08 - .06)));

      engine.galaxy.rotation.y = Math.sin(t * .06) * .05;
      engine.dustGroup.rotation.y -= dt * .028;

      /* Swap in the guaranteed-compile fallback material the moment shader
         compilation is reported as failed — per-orb palettes preserved. */
      coreFallbackRef.current && orbsRef.current.forEach((orb) => {
        if ((orb.core.material as THREE.ShaderMaterial).uniforms?.uType) {
          orb.core.material.dispose();
          orb.core.material = makeFallbackCoreMaterial(orb.index);
          orb.flash = 1;
        }
      });

      if (tourStateRef.current.on && !flightRef.current && now - introStart > 2900 && now >= (tourNextAtRef.current ?? 0)) {
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
        const coreMat = orb.core.material as THREE.ShaderMaterial;
        if (coreMat.uniforms?.uType) {
          coreMat.uniforms.uTime.value = t;
          coreMat.uniforms.uPulse.value = pulse;
          coreMat.uniforms.uDim.value = orb.dim;
          orb.atmo.material.uniforms.uTime.value = t;
          orb.atmo.material.uniforms.uPulse.value = pulse;
        } else if (coreMat.uniforms?.uDim) {
          coreMat.uniforms.uDim.value = orb.dim;
        }
        orb.atmo.visible = orb.dim > .35;
        orb.halo.material.opacity = (.13 + pulse * .18) * orb.dim;
        const haloScale = orb.r * (2.05 + Math.sin(t * 1.6 + orb.seed * 6.28) * .07 + pulse * .2);
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
        const goal = target * (.7 + .3 * Math.sin(t * .85 + (line.userData.phase as number)));
        mat.opacity += (goal - mat.opacity) * Math.min(1, dt * 6);
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
      const hovered = hits.length && !flightRef.current && now - introStart > 2700 ? hits[0].object.userData.index as number : null;
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

      prAccum += dt;
      prFrames++;
      if (prCooldown > 0) prCooldown--;
      else if (prFrames >= 75) {
        const avg = prAccum / prFrames;
        if (avg > .026 && prLevel < PR_STEPS.length - 1) { prLevel++; applyPixelRatio(); prCooldown = 240; }
        else if (avg < .0145 && prLevel > 0) { prLevel--; applyPixelRatio(); prCooldown = 300; }
        prAccum = 0; prFrames = 0;
      }

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
      dom.removeEventListener("webglcontextlost", onContextLost);
      dom.removeEventListener("webglcontextrestored", onContextRestored);
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
  }, [webglBroken, glEpoch]);

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
      const radius = 175 + tt * 540 + (seeded(i, 5) - .5) * 52;
      radii.push(i < 2 ? 56 : i < 5 ? 44 : i < 9 ? 34 : i < 15 ? 27 : 21);
      anchors.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(tt * Math.PI * 1.5 + arm * 1.3) * 30 * (1 - tt * .35) + (seeded(i, 7) - .5) * 30,
        Math.sin(angle) * radius,
      ));
    }
    const spread = anchors.map((a) => a.clone());
    {
      const diff = new THREE.Vector3();
      const maxHoriz = 720, maxY = 84;
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
      /* If a previous orb set already proved the heavy shader can't compile on
         this GPU, build with the lightweight fallback right away. */
      const mat = coreFallbackRef.current ? makeFallbackCoreMaterial(i) : new THREE.ShaderMaterial({
        vertexShader: CORE_VERT, fragmentShader: CORE_FRAG,
        uniforms: {
          uTime: { value: seeded(i, 11) * 20 }, uSeed: { value: seeded(i, 11) },
          uColorA: { value: colorA }, uColorB: { value: colorB },
          uTint: { value: tint }, uToneAmt: { value: THREE.MathUtils.clamp(Math.abs(chg) / 5, 0, 1) },
          uPulse: { value: 0 }, uDim: { value: 1 },
          uType: { value: Math.floor(seeded(i, 41) * 6) },
        },
      });
      const core = new THREE.Mesh(coreGeometry(), mat);
      core.userData.index = i;
      core.scale.setScalar(r);
      const group = new THREE.Group();
      group.position.copy(base);
      group.add(core);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTexture(), color: colorA, transparent: true, opacity: .22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.renderOrder = -1;
      group.add(halo);
      const atmoMat = new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
        uniforms: { uColor: { value: colorA.clone() }, uPulse: { value: 0 }, uTime: { value: 0 } },
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const atmo = new THREE.Mesh(coreGeometry(), atmoMat);
      atmo.scale.setScalar(r * 1.14);
      group.add(atmo);
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
        map: labelTexture, transparent: true, depthWrite: false, opacity: .95,
      }));
      const lw = r * 3.0;
      labelSprite.scale.set(lw, lw * (330 / 720), 1);
      labelSprite.position.set(0, -(r * 1.72), 0);
      group.add(labelSprite);
      engine.galaxy.add(group);
      const orb: Orb = {
        index: i, group, core, atmo, halo, ring,
        labelSprite, labelCanvas, labelTexture, logoImg: null,
        base, r, seed: seeded(i, 11),
        bobAmp: 7 + seeded(i, 15) * 9,
        flash: .9, dim: 1,
      };
      drawLabel(orb, items[i], marketRef.current, palette ?? null);
      const logoSrc = marketRef.current === "nasdaq" ? usCompanyLogoProxyUrl(items[i].code) : stockIconUrl(items[i].code);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        orb.logoImg = img;
        drawLabel(orb, itemsRef.current[i] ?? items[i], marketRef.current, colorsRef.current[i] ?? null);
      };
      img.onerror = () => { orb.logoImg = null; drawLabel(orb, itemsRef.current[i] ?? items[i], marketRef.current, colorsRef.current[i] ?? null); };
      img.src = logoSrc;
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
      line.userData.phase = seeded(members[0], 31) * 6.2831853;
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
      const coreMat = orb.core.material as THREE.ShaderMaterial;
      if (!coreMat.uniforms?.uColorA) return;
      const item = items[orb.index];
      if (!item) return;
      const palette = colorsRef.current[orb.index];
      coreMat.uniforms.uColorA.value = new THREE.Color(palette?.[0] ?? "#8fd6ff");
      coreMat.uniforms.uColorB.value = new THREE.Color(palette?.[1] ?? "#20456e");
      orb.atmo.material.uniforms.uColor.value = new THREE.Color(palette?.[0] ?? "#8fd6ff");
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
      if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !discussionOpenRef.current) {
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea")) return;
        const total = itemsRef.current.length;
        if (!total) return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const current = selectedRef.current;
        const next = current == null
          ? (step === 1 ? 0 : total - 1)
          : (current + step + total) % total;
        selectRef.current(next);
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
          <div className="neo-live"><i /> LIVE <span>{board ? formatClock(board.generated_at) : "--:--:--"}</span></div>
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

      <div className="neo-hint">드래그 회전 · 휠 줌 · <b>클릭 = 워프</b> · 더블클릭 = 종목 상세 · ←/→ 종목 탐색 · SPACE 투어 · ESC 닫기</div>

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
              <b className={selectedItem.change_pct > .04 ? "is-up" : selectedItem.change_pct < -.04 ? "is-down" : ""}>{formatChangeWithUnit(selectedItem, market)}</b>
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
