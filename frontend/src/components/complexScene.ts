import * as THREE from "three";
import { RealEstateBuildingsResponse } from "../api/client";
import { ringIndex, sidewalkWidth } from "./sceneSidewalk";
import { coveredStream } from "./sceneWater";
import { normalRows } from "./normalKernel";
import { cdn } from "../staticCdn";

const WATER_KINDS = new Set(["천", "구", "유", "양"]);
const coveredMemo = new WeakMap<object, boolean[]>();
/** Per parcel: a water parcel that is really road or built over (not open water). */
export function waterCovered(data: RealEstateBuildingsResponse): boolean[] {
  const parcels = data.parcels ?? [];
  const hit = coveredMemo.get(parcels);
  if (hit) return hit;
  const lines = [...(data.roads ?? []).map(r => r.line), ...(data.streets ?? [])];
  const onBuilding = ringIndex([...data.buildings, ...data.context].map(b => b.rings[0]));
  const out = parcels.map(p => WATER_KINDS.has(p.kind) && coveredStream(p.ring, lines, onBuilding));
  coveredMemo.set(parcels, out);
  return out;
}

/* The natural-light scene around one complex (components/ComplexHologram.tsx):
 * facades, ground and the time-of-day looks. Footprints, heights and the parcel are
 * real; facade paint, glazing and the flat landscaping on the parcel are drawn. No
 * streets or trees are invented. */

export type Ring = [number, number][];

export interface Palette { wall: string; wall2: string; accent: string; glass: [string, string]; roof: string }

// Brand-inspired schemes (colour only, never a mark), matched on the complex name.
const BRANDS: [RegExp, Palette][] = [
  [/래미안|raemian/i, { wall: "#ecebe6", wall2: "#c9cbc4", accent: "#2f6b57", glass: ["#9cc3d6", "#27414f"], roof: "#6f7771" }],
  [/자이|xi\b/i, { wall: "#e7e5e1", wall2: "#3c3f45", accent: "#8b1d2c", glass: ["#a9c4d8", "#1f2c3a"], roof: "#4a4d52" }],
  [/힐스테이트|hillstate/i, { wall: "#efe9e0", wall2: "#7a5a48", accent: "#5a3a2e", glass: ["#b3cad6", "#2c3b45"], roof: "#6b5347" }],
  [/아이파크|ipark/i, { wall: "#f2f1ee", wall2: "#d8d6d0", accent: "#d1492e", glass: ["#a4c9e0", "#233a4d"], roof: "#8a8d90" }],
  [/푸르지오|prugio/i, { wall: "#eeeae0", wall2: "#b9c3a4", accent: "#4f7a3a", glass: ["#aecbd2", "#28413f"], roof: "#6f7865" }],
  [/롯데캐슬|캐슬/i, { wall: "#f0ebe4", wall2: "#9c6b5d", accent: "#8c2230", glass: ["#b5c9d4", "#2e3a44"], roof: "#6e4c47" }],
  [/e편한|이편한|편한세상/i, { wall: "#f3f2ef", wall2: "#cfd3d6", accent: "#c8102e", glass: ["#a8cde3", "#20384c"], roof: "#8d9296" }],
  [/더샵|the ?sharp/i, { wall: "#eceef0", wall2: "#304a63", accent: "#1d7a8c", glass: ["#9fc9dc", "#1b3244"], roof: "#4c5c6a" }],
  [/아크로|acro/i, { wall: "#e9e3d6", wall2: "#3a3631", accent: "#b08d57", glass: ["#b9c6cc", "#262a2e"], roof: "#4b463f" }],
  [/디에이치|the ?h\b/i, { wall: "#2f2f31", wall2: "#1d1d1f", accent: "#c4a05a", glass: ["#9fb0bd", "#15191d"], roof: "#2a2a2c" }],
  [/sk ?뷰|sk ?view|에스케이/i, { wall: "#f1efeb", wall2: "#d6d2ca", accent: "#e8661c", glass: ["#a6c8dc", "#22384a"], roof: "#8c8a86" }],
  [/써밋|summit|호반/i, { wall: "#ebedf0", wall2: "#26344d", accent: "#3d5a8c", glass: ["#a2c1dc", "#1a2a40"], roof: "#46526a" }],
  [/위브|weve|두산/i, { wall: "#f0eee9", wall2: "#5b6f86", accent: "#2f5d8a", glass: ["#a8c6db", "#213448"], roof: "#5f6b78" }],
  [/센트레빌|centreville|동부/i, { wall: "#f1eee6", wall2: "#8aa36b", accent: "#3d6b3a", glass: ["#afcbd0", "#27403a"], roof: "#6c775f" }],
];
const FALLBACKS: Palette[] = [
  { wall: "#eeebe4", wall2: "#b8b3a8", accent: "#6d5d4b", glass: ["#aac5d4", "#26394a"], roof: "#77716a" },
  { wall: "#e8ecef", wall2: "#8a9bab", accent: "#34566f", glass: ["#9fc4dc", "#1c3246"], roof: "#5d6a76" },
  { wall: "#f0ece6", wall2: "#c2a38c", accent: "#9a5b3c", glass: ["#b1c8d2", "#2d3b43"], roof: "#806a5c" },
  { wall: "#eceee9", wall2: "#9fae9a", accent: "#48644a", glass: ["#a9cbcd", "#243f3c"], roof: "#697663" },
  { wall: "#efedf0", wall2: "#a69bb3", accent: "#5b4a78", glass: ["#adc2dc", "#252f47"], roof: "#6f6879" },
];

export function paletteFor(name: string): Palette {
  const brand = BRANDS.find(([re]) => re.test(name));
  if (brand) return brand[1];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length];
}

export const rng = (seed: number) => {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

/** Long paints are generators that yield between steps: run at once (runNow), or in
 * slices between which the page gets the main thread (runSliced). A step may yield a
 * promise: runSliced waits for it (work done in a worker meanwhile); a step asking
 * `yield` for permission gets true from runSliced, undefined from runNow. */
export type Steps<T> = Generator<void | Promise<unknown>, T, boolean | undefined>;
export function runNow<T>(g: Steps<T>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
export async function runSliced<T>(g: Steps<T>, pace: () => Promise<boolean>): Promise<T | null> {
  let r = g.next();
  while (!r.done) {
    if (r.value instanceof Promise) await r.value;
    if (!await pace()) return null;
    r = g.next(true);
  }
  return r.value;
}

/** A canvas to paint on. Drawn by the GPU (the browser's default): drawn by the CPU instead
 * (willReadFrequently, ?cpucanvas=1) the painting's slices ran several times longer on the
 * page and the view stuttered more after its first frame (measured: 0.9 s against 1.3 s of
 * late frames over 12 s), though the browser's GPU process then had less to do. */
const CPU_CANVAS = typeof location !== "undefined" && new URLSearchParams(location.search).get("cpucanvas") === "1";
const canvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; if (CPU_CANVAS) c.getContext("2d", { willReadFrequently: true }); return c; };

// A few workers: a complex asks for a normal map per texture set (two facades, the base,
// the ground, the neighbourhood's styles), and one worker made them queue — the page sat
// idle for hundreds of ms while each waited its turn.
let normalPool: { w: Worker; busy: number }[] | null | undefined;
let normalJob = 0;
const normalJobs = new Map<number, (bitmap: ImageBitmap | null) => void>();
/** Height canvas -> normal map in a worker: the pixel readback and loop both leave the
 * page (together a few hundred ms per complex). Null where workers can't do it. */
function normalsOffThread(height: HTMLCanvasElement, strength: number): Promise<ImageBitmap | null> | null {
  if (normalPool === undefined) {
    normalPool = null;
    try {
      if (typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined") {
        const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
        normalPool = Array.from({ length: n }, () => {
          const w = new Worker(new URL("./normalWorker.ts", import.meta.url), { type: "module" });
          w.onmessage = (e: MessageEvent<{ id: number; bitmap: ImageBitmap | null }>) => { normalJobs.get(e.data.id)?.(e.data.bitmap); normalJobs.delete(e.data.id); };
          return { w, busy: 0 };
        });
      }
    } catch { normalPool = null; }
  }
  if (!normalPool) return null;
  const slot = normalPool.reduce((a, b) => (b.busy < a.busy ? b : a));
  slot.busy++;
  const id = ++normalJob;
  return createImageBitmap(height).then(src => new Promise<ImageBitmap | null>(resolve => {
    normalJobs.set(id, bitmap => { slot.busy--; resolve(bitmap); });
    slot.w.postMessage({ id, src, strength }, [src]);
  })).catch(() => { slot.busy--; return null; });
}

/** Tangent-space normals from a height canvas (brighter = further out). Sliced: in a
 * worker; at once (or without one): here. */
function* normalCanvas(height: HTMLCanvasElement, strength: number): Steps<HTMLCanvasElement> {
  const { width: W, height: H } = height;
  const out = canvas(W, H);
  const ctx = out.getContext("2d")!;
  const sliced = yield;
  const job = sliced ? normalsOffThread(height, strength) : null;
  if (job) {
    let bitmap: ImageBitmap | null = null;
    yield job.then(b => { bitmap = b; });
    const got = bitmap as ImageBitmap | null;
    if (got) { ctx.drawImage(got, 0, 0); got.close(); return out; }
  }
  const src = height.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const img = ctx.createImageData(W, H), d = img.data;
  // Tight loop over the red channel; ~5x the closure version.
  for (let y = 0; y < H; y += 96) {
    if (y) yield;
    normalRows(src, d, W, H, strength, y, Math.min(H, y + 96));
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function mixHex(a: string, b: string, k: number) {
  return "#" + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
}

function worldTexture(c: HTMLCanvasElement, srgb: boolean, tileW: number, tileH: number, groundOffset = 0) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = false;
  t.repeat.set(1 / tileW, 1 / tileH);
  // WorldUVGenerator gives v = 1 - z: shift so floor lines start above the ground floor.
  t.offset.set(0, (1 - groundOffset) / tileH);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

// One facade tile: BAYS windows across, ROWS floors up; world scale set by the texture repeat.
export const BAY_M = 3.2, FLOOR_M = 2.9, GROUND_M = 1.5;
const BAYS = 8, ROWS = 8;

/** A Korean apartment facade: expanded-balcony glazing with glass rails, slab bands,
 * AC louvres and pilasters. Colour, normals, roughness (G) / metalness (B) and the
 * lit windows for the evening. */
export const facadeTextures = (p: Palette, seed: number) => runNow(facadeSteps(p, seed));
export function* facadeSteps(p: Palette, seed: number, scale = 1) {
  // (scale: the same drawing on larger canvases — the complex being viewed gets 2x)
  const W = 1024, H = 928, cw = W / BAYS, ch = H / ROWS, k = scale;
  const color = canvas(W * k, H * k), height = canvas(W * k, H * k), rm = canvas(W * k, H * k), glow = canvas(W * k, H * k), open = canvas(W * k, H * k);
  const g = color.getContext("2d")!, hh = height.getContext("2d")!, r = rm.getContext("2d")!, e = glow.getContext("2d")!;
  for (const c of [g, hh, r, e]) c.scale(k, k);
  // Where the glass shows the room behind it (the lit-window map's alpha): clear glass,
  // not the curtains, frames or rail. The WebGPU view draws a room there (interior
  // mapping); everything else ignores it.
  // (rectangles collected, drawn in two batches: switching the composite mode per window
  // tripled the painting time)
  const glassRects: number[][] = [], cuts: number[][] = [];
  const rnd = rng(seed);
  const slab = mixHex(p.wall, p.wall2, 0.25);

  g.fillStyle = p.wall; g.fillRect(0, 0, W, H);
  hh.fillStyle = "rgb(140,140,140)"; hh.fillRect(0, 0, W, H);
  r.fillStyle = "rgb(0,210,0)"; r.fillRect(0, 0, W, H);
  e.fillStyle = "#000"; e.fillRect(0, 0, W, H);
  // Paint texture and rain streaks running down from each slab.
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${rnd() * 0.03})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 18, 1 + rnd() * 2);
  }
  for (let i = 0; i < 180; i++) {
    const x = rnd() * W, y = Math.floor(rnd() * ROWS) * ch + ch * 0.92;
    const grad = g.createLinearGradient(0, y, 0, y + 30 + rnd() * 90);
    grad.addColorStop(0, `rgba(70,62,52,${0.05 + rnd() * 0.06})`); grad.addColorStop(1, "rgba(70,62,52,0)");
    g.fillStyle = grad; g.fillRect(x, y, 1 + rnd() * 4, 120);
  }

  const lit = [[255, 196, 128], [255, 214, 160], [255, 228, 196], [226, 236, 255]];
  const curtains = ["#ece4d4", "#ddd5c6", "#d3d9dd", "#efe7d8", "#c9c0b0"];
  for (let row = 0; row < ROWS; row++) {
    if (row % 2 === 0) yield;
    const y = row * ch;
    for (let bay = 0; bay < BAYS; bay++) {
      const x = bay * cw;
      if (bay % 4 === 3) {
        // Pilaster with the outdoor-unit louvre beside it.
        g.fillStyle = p.wall2; g.fillRect(x + cw * 0.62, y, cw * 0.38, ch);
        hh.fillStyle = "rgb(175,175,175)"; hh.fillRect(x + cw * 0.62, y, cw * 0.38, ch);
        const lx = x + cw * 0.08, ly = y + ch * 0.16, lw = cw * 0.48, lh = ch * 0.66;
        g.fillStyle = "#4a4e52"; g.fillRect(lx, ly, lw, lh);
        hh.fillStyle = "rgb(80,80,80)"; hh.fillRect(lx, ly, lw, lh);
        r.fillStyle = "rgb(0,120,150)"; r.fillRect(lx, ly, lw, lh);
        for (let s = ly + 3; s < ly + lh - 3; s += 7) {
          g.fillStyle = "#8d9296"; g.fillRect(lx + 3, s, lw - 6, 3);
          hh.fillStyle = "rgb(125,125,125)"; hh.fillRect(lx + 3, s, lw - 6, 3);
        }
        g.strokeStyle = "#d8dadb"; g.lineWidth = 3; g.strokeRect(lx, ly, lw, lh);
        continue;
      }
      const wx = x + cw * 0.06, ww = cw * 0.88, wy = y + ch * 0.1, wh = ch * 0.74;
      // Glass: the room behind, darker low, catching sky high.
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, p.glass[0]); grad.addColorStop(0.45, p.glass[1]); grad.addColorStop(1, mixHex(p.glass[1], "#000000", 0.3));
      g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
      glassRects.push([wx, wy, ww, wh]);
      if (rnd() < 0.55) {
        g.fillStyle = curtains[Math.floor(rnd() * curtains.length)];
        g.globalAlpha = 0.55 + rnd() * 0.3;
        const cut = Math.min(1, g.globalAlpha + 0.15);
        const cwid = ww * (0.18 + rnd() * 0.3);
        if (rnd() < 0.5) { g.fillRect(wx, wy + 2, cwid, wh * 0.95); cuts.push([wx, wy + 2, cwid, wh * 0.95, cut]); }
        if (rnd() < 0.6) { g.fillRect(wx + ww - cwid, wy + 2, cwid, wh * 0.95); cuts.push([wx + ww - cwid, wy + 2, cwid, wh * 0.95, cut]); }
        g.globalAlpha = 1;
      }
      // Recess shadow under the lintel.
      const sh = g.createLinearGradient(0, wy, 0, wy + 16);
      sh.addColorStop(0, "rgba(0,0,0,0.45)"); sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh; g.fillRect(wx, wy, ww, 16);
      hh.fillStyle = "rgb(35,35,35)"; hh.fillRect(wx, wy, ww, wh);
      r.fillStyle = "rgb(0,14,150)"; r.fillRect(wx, wy, ww, wh);
      if (rnd() < 0.42) {
        const [lr, lg, lb] = lit[Math.floor(rnd() * lit.length)];
        const a = 0.45 + rnd() * 0.55;
        const lgGrad = e.createLinearGradient(0, wy, 0, wy + wh);
        lgGrad.addColorStop(0, `rgba(${lr},${lg},${lb},${a})`);
        lgGrad.addColorStop(1, `rgba(${lr},${lg},${lb},${a * 0.55})`);
        e.fillStyle = lgGrad; e.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
      }
      // Frames: white aluminium outline, sliding-sash mullion, fixed upper light.
      g.strokeStyle = "#e3e5e4"; g.lineWidth = 4; g.strokeRect(wx + 2, wy + 2, ww - 4, wh - 4);
      g.fillStyle = "#e3e5e4";
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      g.fillRect(wx, wy + wh * 0.24, ww, 3);
      cuts.push([wx - 1, wy - 1, ww + 2, 7, 1], [wx - 1, wy + wh - 6, ww + 2, 7, 1], [wx - 1, wy, 7, wh, 1], [wx + ww - 6, wy, 7, wh, 1],
        [wx + ww / 2 - 3, wy, 6, wh, 1], [wx, wy + wh * 0.24 - 1, ww, 5, 1]);
      hh.fillStyle = "rgb(120,120,120)";
      hh.fillRect(wx + ww / 2 - 2, wy, 4, wh); hh.fillRect(wx, wy + wh * 0.24, ww, 3);
      hh.strokeStyle = "rgb(120,120,120)"; hh.lineWidth = 4; hh.strokeRect(wx + 2, wy + 2, ww - 4, wh - 4);
      // Glass balcony rail across the lower third.
      const ry = wy + wh * 0.64;
      g.fillStyle = "rgba(190,210,220,0.22)"; g.fillRect(wx, ry, ww, wy + wh - ry);
      g.fillStyle = "#f2f4f4"; g.fillRect(wx - 2, ry - 2, ww + 4, 4);
      for (let px = wx + 6; px < wx + ww; px += ww / 4) g.fillRect(px, ry, 2, wy + wh - ry);
      cuts.push([wx - 2, ry - 3, ww + 4, 6, 1]);
      for (let px = wx + 6; px < wx + ww; px += ww / 4) cuts.push([px - 1, ry, 4, wy + wh - ry, 1]);
      // (the rail's tinted glass: the room a little dimmer through it)
      cuts.push([wx, ry + 3, ww, wy + wh - ry - 3, 0.2]);
      hh.fillStyle = "rgb(200,200,200)"; hh.fillRect(wx - 2, ry - 2, ww + 4, 4);
      r.fillStyle = "rgb(0,90,40)"; r.fillRect(wx - 2, ry - 2, ww + 4, 4);
    }
    // Floor slab band, the strongest horizontal line of a Korean apartment facade.
    g.fillStyle = slab; g.fillRect(0, y + ch * 0.9, W, ch * 0.1);
    g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(0, y + ch, W, 3);
    hh.fillStyle = "rgb(205,205,205)"; hh.fillRect(0, y + ch * 0.9, W, ch * 0.1);
    r.fillStyle = "rgb(0,190,0)"; r.fillRect(0, y + ch * 0.9, W, ch * 0.1);
  }
  yield;
  // The lit-window map keeps its colour and takes the glass mask as its alpha.
  const o = open.getContext("2d")!;
  o.scale(k, k);
  o.fillStyle = "#fff";
  for (const [x, y, w, h] of glassRects) o.fillRect(x, y, w, h);
  o.globalCompositeOperation = "destination-out";
  for (const [x, y, w, h, a] of cuts) { o.globalAlpha = a; o.fillRect(x, y, w, h); }
  e.setTransform(1, 0, 0, 1, 0, 0);
  e.globalCompositeOperation = "destination-in"; e.drawImage(open, 0, 0); e.globalCompositeOperation = "source-over";
  // Soften the height steps into bevels before taking normals.
  const soft = canvas(W * k, H * k);
  const sctx = soft.getContext("2d")!;
  sctx.filter = `blur(${1.2 * k}px)`;
  sctx.drawImage(height, 0, 0);
  // (the same slopes at twice the texels: twice the strength per texel step)
  const normal = yield* normalCanvas(soft, 5 * k);
  const tile = (c: HTMLCanvasElement, srgb: boolean) => worldTexture(c, srgb, BAYS * BAY_M, ROWS * FLOOR_M, GROUND_M);
  return { map: tile(color, true), normalMap: tile(normal, false), rmMap: tile(rm, false), emissiveMap: tile(glow, true) };
}

export type ContextStyle = "villa" | "office" | "shop" | "apt";

/** Neighbouring apartment towers: the apartment facade in a neutral scheme (no brand colour). */
export const NEIGHBOUR_PALETTE: Palette = { wall: "#eeebe5", wall2: "#c3beb4", accent: "#7a7266", glass: ["#a9c3d2", "#28394a"], roof: "#77716a" };

/** Which facade a neighbouring building gets, from its registered use (건축물 용도) and height. */
export function contextStyle(use: string | null, height: number, r: number): ContextStyle {
  // VWorld gives the 건축물 주용도 code (01000 단독주택, 02000 공동주택, 03000/04000
  // 근린생활, 07000 판매, 09000 의료, 14000 업무, 15000 숙박 …); OSM gives words.
  const CODES: Record<string, string> = { "01": "주택", "02": "공동주택", "03": "근린", "04": "근린", "07": "판매", "09": "의료",
    "10": "연구", "14": "업무", "15": "숙박", "16": "위락", "13": "운동", "24": "방송" };
  const code = /^\d{5}$/.test(use ?? "") ? CODES[(use ?? "").slice(0, 2)] : undefined;
  const u = code ?? (/^(apartments|residential)$/.test(use ?? "") ? "공동주택" : /^(house|detached)$/.test(use ?? "") ? "주택"
    : /^(office|commercial)$/.test(use ?? "") ? "업무" : /^(retail|shop)$/.test(use ?? "") ? "판매" : use ?? "");
  if (/업무|오피스|방송|연구|의료|숙박/.test(u)) return "office";
  if (/근린|판매|상가|음식|위락|운동/.test(u)) return height > 36 ? "office" : "shop";
  if (/공동주택|아파트/.test(u) && height > 16) return "apt";
  if (/주택|기숙/.test(u)) return height > 24 ? "apt" : "villa";
  return height > 36 ? "office" : r < 0.5 ? "shop" : "villa";
}

/** The name a neighbouring building is known by, for the hover label — only the landmarks:
 * apartment blocks (5 storeys and up: 아파트, not 빌라), department stores and marts,
 * schools, hospitals, stations, public offices, culture and sports halls. Houses, villas
 * and neighbourhood shops (근린생활) get none. Null when it has no registered name. */
export function landmarkLabel(b: { use: string | null; title?: string | null; name: string | null; floors: number; height: number }): string | null {
  const title = (b.title ?? "").trim();
  if (!title) return null;
  const use = b.use ?? "", code = /^\d{5}$/.test(use) ? use.slice(0, 2) : null;
  const PUBLIC = /(청|센터|주민|우체국|경찰|파출소|지구대|소방|세무서|법원|검찰|공단|공사|도서관|보건소|박물관|미술관|체육관|문화)/;
  const MART = /(백화점|마트|아울렛|몰|쇼핑|시장)/;
  // (an apartment: named so, or 6 storeys and up — villas are 4, 5 over pilotis — and never
  // a 빌라 / 빌트 / 하우스 / 타운 by name)
  const villa = /(빌라|빌트|빌$|하우스|타운|주택|원룸)/.test(title);
  const apartment = !villa && (/아파트/.test(title) || b.floors >= 6 || (!b.floors && b.height >= 18));
  let ok = false;
  if (code) ok = (code === "02" && apartment) || ["05", "07", "08", "09", "10", "12", "13"].includes(code) || (code === "14" && PUBLIC.test(title))
    || ((code === "03" || code === "04") && (MART.test(title) || PUBLIC.test(title)));
  else ok = (/^(apartments|residential)$/.test(use) && apartment) || /^(school|university|college|kindergarten|hospital|clinic|train_station|station|transportation|public|civic|government|townhall|library|police|fire_station|post_office|department_store|mall|supermarket|sports_centre|stadium|museum|theatre|community_centre)$/.test(use)
    || (/^(retail|commercial)$/.test(use) && MART.test(title));
  if (!ok) return null;
  // (an apartment block by its complex and 동: "호원가든아파트 103동"; the rest by name alone)
  const dong = (b.name ?? "").trim(), home = code === "02" || /^(apartments|residential)$/.test(use);
  return home && dong && dong !== title && /동$/.test(dong) ? `${title} ${dong}` : title;
}

/** Storey height (m) each context facade is drawn at, before fitting to registered floors. */
export const CONTEXT_FLOOR_M: Record<ContextStyle, number> = { villa: 2.9, shop: 3.4, office: 3.8, apt: FLOOR_M };

/** The neighbourhood: three plainer facades (villa, office curtain wall, shops with a
 * storefront ground floor), tinted per building. Colour, relief normals, roughness (G)
 * / metalness (B) and lit windows. The tile's bottom row sits on each building's ground. */
export const contextTextures = (seed: number, style: Exclude<ContextStyle, "apt"> = "villa") => runNow(contextSteps(seed, style));
export function* contextSteps(seed: number, style: Exclude<ContextStyle, "apt"> = "villa", scale = 1) {
  // (scale: the same drawing on larger canvases — a desktop's neighbourhood gets 2x)
  const W = 512, H = 1024, cols = style === "office" ? 6 : 4, rows = 8, cw = W / cols, ch = H / rows, k = scale;
  const color = canvas(W * k, H * k), rm = canvas(W * k, H * k), glow = canvas(W * k, H * k), height = canvas(W * k, H * k);
  const g = color.getContext("2d")!, r = rm.getContext("2d")!, e = glow.getContext("2d")!, hh = height.getContext("2d")!;
  for (const c of [g, r, e, hh]) c.scale(k, k);
  // The clear glass, as on the complex's own facades (the lit-window map's alpha): the
  // WebGPU view draws rooms behind it. Frames, mullions and grilles are cut out of it.
  const glassRects: number[][] = [], cuts: number[][] = [];
  const frame = (x: number, y: number, w: number, h: number, t: number) => cuts.push([x - t, y - t, w + 2 * t, 2 * t, 1], [x - t, y + h - t, w + 2 * t, 2 * t, 1], [x - t, y, 2 * t, h, 1], [x + w - t, y, 2 * t, h, 1]);
  const rnd = rng(seed);
  g.fillStyle = style === "villa" ? "#e9e2d6" : style === "office" ? "#d9dde0" : "#e6e3dc"; g.fillRect(0, 0, W, H);
  r.fillStyle = "rgb(0,225,0)"; r.fillRect(0, 0, W, H);
  e.fillStyle = "#000"; e.fillRect(0, 0, W, H);
  hh.fillStyle = "rgb(150,150,150)"; hh.fillRect(0, 0, W, H);
  if (style === "villa") {
    // Brick-tile cladding under the per-building tint: a 96 × 48 px swatch of varied
    // bricks, repeated (one fill instead of thousands).
    const sw = canvas(96, 48), sg = sw.getContext("2d")!;
    for (let y = 0; y < 48; y += 6) for (let x = (y / 6) % 2 ? -12 : 0; x < 96; x += 24) {
      sg.fillStyle = `rgba(${120 + rnd() * 40},${70 + rnd() * 30},${50 + rnd() * 20},${0.06 + rnd() * 0.05})`;
      sg.fillRect(x + 1, y + 1, 22, 4);
    }
    g.fillStyle = g.createPattern(sw, "repeat")!; g.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 14, 1 + rnd() * 2);
  }
  // Row 0 is the top of the tile, row rows-1 the ground floor.
  for (let row = 0; row < rows; row++) {
    if (row % 2 === 0) yield;
    const ground = row === rows - 1, y0 = row * ch;
    if (style === "office") {
      // Curtain wall: a spandrel band, then glazing between mullions.
      g.fillStyle = "#8d969c"; g.fillRect(0, y0, W, ch * 0.22);
      hh.fillStyle = "rgb(170,170,170)"; hh.fillRect(0, y0, W, ch * 0.22);
      for (let col = 0; col < cols; col++) {
        const wx = col * cw + 3, wy = y0 + ch * 0.22, ww = cw - 6, wh = ch * 0.78;
        const grad = g.createLinearGradient(0, wy, 0, wy + wh);
        grad.addColorStop(0, "#9fb4c4"); grad.addColorStop(0.5, "#4c6273"); grad.addColorStop(1, "#27343f");
        g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
        glassRects.push([wx, wy, ww, wh]);
        r.fillStyle = "rgb(0,12,190)"; r.fillRect(wx, wy, ww, wh);
        hh.fillStyle = "rgb(60,60,60)"; hh.fillRect(wx, wy, ww, wh);
        if (rnd() < (ground ? 0.8 : 0.35)) {
          e.fillStyle = `rgba(${220 + rnd() * 35},${225 + rnd() * 30},255,${0.35 + rnd() * 0.45})`;
          e.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        }
      }
      g.fillStyle = "#c9cfd2"; hh.fillStyle = "rgb(200,200,200)";
      for (let col = 0; col <= cols; col++) { g.fillRect(col * cw - 3, y0, 6, ch); hh.fillRect(col * cw - 3, y0, 6, ch); cuts.push([col * cw - 4, y0, 8, ch, 1]); }
      continue;
    }
    if (ground && style === "shop") {
      // Storefront: signage band, framed shop glazing lit in the evening.
      g.fillStyle = ["#2f5d8a", "#b23a2e", "#3d7a4a", "#e0a32a", "#3a3a3a"][Math.floor(rnd() * 5)]; g.fillRect(0, y0, W, ch * 0.2);
      hh.fillStyle = "rgb(200,200,200)"; hh.fillRect(0, y0, W, ch * 0.2);
      e.fillStyle = "rgba(255,240,220,0.5)"; e.fillRect(0, y0 + ch * 0.05, W, ch * 0.1);
      for (let col = 0; col < cols; col++) {
        const wx = col * cw + 6, wy = y0 + ch * 0.24, ww = cw - 12, wh = ch * 0.7;
        const grad = g.createLinearGradient(0, wy, 0, wy + wh);
        grad.addColorStop(0, "#8ea4b3"); grad.addColorStop(1, "#2c3740");
        g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
        g.strokeStyle = "#2a2c2e"; g.lineWidth = 5; g.strokeRect(wx, wy, ww, wh);
        glassRects.push([wx, wy, ww, wh]); frame(wx, wy, ww, wh, 3.5);
        r.fillStyle = "rgb(0,15,170)"; r.fillRect(wx, wy, ww, wh);
        hh.fillStyle = "rgb(55,55,55)"; hh.fillRect(wx, wy, ww, wh);
        e.fillStyle = `rgba(255,${215 + rnd() * 30},${170 + rnd() * 50},${0.55 + rnd() * 0.4})`; e.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
      }
      continue;
    }
    const villa = style === "villa";
    for (let col = 0; col < cols; col++) {
      const wx = col * cw + cw * (villa ? 0.18 : 0.14), wy = y0 + ch * (villa ? 0.26 : 0.2), ww = cw * (villa ? 0.64 : 0.72), wh = ch * (villa ? 0.46 : 0.52);
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, "#7c8e9c"); grad.addColorStop(1, "#27313a");
      g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
      g.strokeStyle = "#d4d6d4"; g.lineWidth = 3; g.strokeRect(wx, wy, ww, wh);
      g.fillStyle = "#d4d6d4"; g.fillRect(wx + ww / 2 - 1, wy, 3, wh);
      glassRects.push([wx, wy, ww, wh]); frame(wx, wy, ww, wh, 2.5); cuts.push([wx + ww / 2 - 2, wy, 5, wh, 1]);
      r.fillStyle = "rgb(0,20,140)"; r.fillRect(wx, wy, ww, wh);
      hh.fillStyle = "rgb(50,50,50)"; hh.fillRect(wx, wy, ww, wh);
      hh.strokeStyle = "rgb(190,190,190)"; hh.lineWidth = 3; hh.strokeRect(wx, wy, ww, wh);
      if (villa) {
        // Sill, and a security grille over the lower half.
        g.fillStyle = "#cfcac0"; g.fillRect(wx - 4, wy + wh, ww + 8, 5);
        hh.fillStyle = "rgb(210,210,210)"; hh.fillRect(wx - 4, wy + wh, ww + 8, 5);
        g.fillStyle = "rgba(60,60,60,0.55)";
        for (let gx = wx + 6; gx < wx + ww; gx += 9) g.fillRect(gx, wy + wh * 0.55, 1.5, wh * 0.45);
        cuts.push([wx, wy + wh * 0.55, ww, wh * 0.45, 0.35]);
      }
      if (rnd() < 0.3) {
        e.fillStyle = `rgba(255,${200 + Math.floor(rnd() * 40)},${140 + Math.floor(rnd() * 70)},${0.4 + rnd() * 0.5})`;
        e.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      }
    }
    g.fillStyle = "rgba(0,0,0,0.14)"; g.fillRect(0, y0 + ch - 4, W, 4);
    hh.fillStyle = "rgb(185,185,185)"; hh.fillRect(0, y0 + ch - 6, W, 6);
  }
  const open = canvas(W * k, H * k), o = open.getContext("2d")!;
  o.scale(k, k);
  o.fillStyle = "#fff";
  for (const [x, y, w, h] of glassRects) o.fillRect(x, y, w, h);
  o.globalCompositeOperation = "destination-out";
  for (const [x, y, w, h, a] of cuts) { o.globalAlpha = a; o.fillRect(x, y, w, h); }
  e.setTransform(1, 0, 0, 1, 0, 0);
  e.globalCompositeOperation = "destination-in"; e.drawImage(open, 0, 0); e.globalCompositeOperation = "source-over";
  const soft = canvas(W * k, H * k), sctx = soft.getContext("2d")!;
  sctx.filter = `blur(${k}px)`; sctx.drawImage(height, 0, 0);
  // (the same slopes at twice the texels: twice the strength per texel step)
  const normal = yield* normalCanvas(soft, 4 * k);
  // uv.y = 1 - (height above the building's ground): offset 2 puts the last row there.
  const tile = (c: HTMLCanvasElement, srgb: boolean) => worldTexture(c, srgb, cols * (style === "office" ? 1.8 : 3.4), rows * CONTEXT_FLOOR_M[style], 2);
  return { map: tile(color, true), normalMap: tile(normal, false), rmMap: tile(rm, false), emissiveMap: tile(glow, true) };
}

/** The neighbourhood's textures don't depend on the complex: made once per style and
 * kept for every complex after (never disposed with a model). */
const sharedTex = new Map<string, Record<string, THREE.Texture>>();
/** The same, painted in slices (the first time) so the page stays responsive. */
type Kept = { lookUp: (style: ContextStyle) => Promise<Record<string, THREE.Texture> | null>; keep: (style: ContextStyle, t: Record<string, THREE.Texture>) => void };
let kept: Kept | null = null;
const lookups = new Map<string, Promise<Record<string, THREE.Texture> | null>>();
/** Copies kept between visits, when the page has them (paintClient). */
export function keepPaintWith(k: Kept) { kept = k; }
export async function sharedContextTexturesSliced(style: ContextStyle, pace: () => Promise<boolean>): Promise<Record<string, THREE.Texture> | null> {
  const hit = sharedTex.get(style);
  if (hit) return hit;
  if (kept) {
    let job = lookups.get(style);
    if (!job) { job = kept.lookUp(style); lookups.set(style, job); }
    const got = await job;
    if (got && !sharedTex.has(style)) sharedTex.set(style, got);
    if (sharedTex.has(style)) return sharedTex.get(style)!;
    if (!await pace()) return null;
    if (sharedTex.has(style)) return sharedTex.get(style)!;
  }
  // (one painting per style: a second caller waits on the first, it doesn't paint again)
  let job = painting.get(style);
  if (!job) {
    job = runSliced<Record<string, THREE.Texture>>(style === "apt" ? facadeSteps(NEIGHBOUR_PALETTE, 4242) : contextSteps(1000 + style.length, style), pace)
      .then(made => { if (made && !sharedTex.has(style)) { sharedTex.set(style, made); kept?.keep(style, made); } return made; })
      .finally(() => painting.delete(style));
    painting.set(style, job);
  }
  await job;
  return sharedTex.get(style) ?? null;
}
const painting = new Map<string, Promise<Record<string, THREE.Texture> | null>>();

/** A desktop's neighbourhood at twice the texels (the complex itself already is): painted in
 * idle time once the first complex is on screen, kept between visits like the rest, and
 * swapped into the shared materials (the view makes their native materials again). Near
 * neighbours read as soft blocks of window grid at the single size. Once a session. */
let sharpening: Promise<void> | null = null;
export function sharpenNeighbourhood(pace: () => Promise<boolean>): Promise<void> {
  return sharpening ??= (async () => {
    for (const style of ["apt", "villa", "shop", "office"] as ContextStyle[]) {
      const key = (style + "@2") as ContextStyle;
      let made = kept ? await kept.lookUp(key).catch(() => null) : null;
      if (!made) {
        made = await runSliced<Record<string, THREE.Texture>>(style === "apt" ? facadeSteps(NEIGHBOUR_PALETTE, 4242, 2) : contextSteps(1000 + style.length, style, 2), pace);
        if (!made) { sharpening = null; return; }
        kept?.keep(key, made);
      }
      const m = sharedMat.get(style), old = sharedTex.get(style);
      sharedTex.set(style, made);
      if (m) {
        m.map = made.map; m.normalMap = made.normalMap; m.roughnessMap = made.rmMap; m.metalnessMap = made.rmMap; m.emissiveMap = made.emissiveMap;
        m.needsUpdate = true;
      }
      if (old && old !== made) Object.values(old).forEach(t => t.dispose());
    }
  })();
}
export function sharedContextTextures(style: ContextStyle): Record<string, THREE.Texture> {
  let hit = sharedTex.get(style);
  if (!hit) {
    hit = style === "apt" ? facadeTextures(NEIGHBOUR_PALETTE, 4242) : contextTextures(1000 + style.length, style);
    sharedTex.set(style, hit);
  }
  return hit;
}

const sharedMat = new Map<ContextStyle, THREE.MeshStandardMaterial>();
/** One material per neighbourhood style for the whole session (never disposed with a
 * model), so its GPU pipeline is built once — see warmMaterials. */
export function sharedContextMaterial(style: ContextStyle): THREE.MeshStandardMaterial {
  let m = sharedMat.get(style);
  if (!m) {
    const ct = sharedContextTextures(style);
    m = new THREE.MeshStandardMaterial({
      map: ct.map, normalMap: ct.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true,
      roughnessMap: ct.rmMap, metalnessMap: ct.rmMap, roughness: 1, metalness: 1,
      emissiveMap: ct.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
    });
    m.userData.contextBuilding = true;
    // Rooms behind the glass for every style, on each style's grid (bays across the tile, eight
    // storeys; a curtain wall's spandrel hides the top of each storey).
    m.userData.interior = style === "apt" ? true : {
      grid: [style === "office" ? 6 : 4, 8], bay: style === "office" ? 1.8 : 3.4, storey: CONTEXT_FLOOR_M[style],
      ceil: style === "office" ? 0.22 : 0.0, floor: style === "office" ? 1.0 : 0.97,
    };
    // (WebGPU: photographic grain over the painted walls; office spandrels are concrete)
    m.userData.detail = style === "office" ? "concrete" : "paint";
    patchMaterial(m, { roof: new THREE.Color("#7b7e7a"), glass: true });
    sharedMat.set(style, m);
  }
  return m;
}

/** A single hidden triangle per shared material, kept in the scene: the renderer builds
 * their pipelines while the first complex's data is still on the network. */
export async function warmMaterials(group: THREE.Group, next: () => Promise<void>, alive: () => boolean) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, -500, 0, 0.001, -500, 0, 0, -500, 0.001], 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  // All four at once, from the page's start: their drawing is brief and their waits (normal
  // maps in the worker pool, kept copies) overlap — one after another they were still being
  // painted when the first complex's build asked for them, half a second on.
  await Promise.all((["villa", "shop", "office", "apt"] as ContextStyle[]).map(async style => {
    if (!await sharedContextTexturesSliced(style, async () => { await next(); return alive(); })) return;
    const mesh = new THREE.Mesh(geo, sharedContextMaterial(style));
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }));
}

/** Granite cladding for the towers' base (1–2층 석재 마감): 1.2 × 0.6 m honed panels with
 * joints and faint veining; colour, normals, roughness / metalness. */
export const plinthTextures = (seed: number, tone: string) => runNow(plinthSteps(seed, tone));
export function* plinthSteps(seed: number, tone: string) {
  const W = 512, H = 512, pw = W / 4, ph = H / 8;
  const color = canvas(W, H), height = canvas(W, H), rm = canvas(W, H);
  const g = color.getContext("2d")!, hh = height.getContext("2d")!, r = rm.getContext("2d")!;
  const rnd = rng(seed);
  const base = new THREE.Color(tone);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 4; col++) {
    const c = base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
    g.fillStyle = "#" + c.getHexString(); g.fillRect(col * pw, row * ph, pw, ph);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? "30,30,30" : "255,255,255"},${rnd() * 0.12})`;
      g.fillRect(col * pw + rnd() * pw, row * ph + rnd() * ph, 1 + rnd() * 3, 1 + rnd() * 2);
    }
  }
  r.fillStyle = "rgb(0,120,0)"; r.fillRect(0, 0, W, H);
  hh.fillStyle = "rgb(170,170,170)"; hh.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(40,38,34,0.55)"; hh.fillStyle = "rgb(60,60,60)"; r.fillStyle = "rgb(0,220,0)";
  for (let row = 0; row <= 8; row++) { g.fillRect(0, row * ph - 1, W, 2.5); hh.fillRect(0, row * ph - 1, W, 2.5); r.fillRect(0, row * ph - 1, W, 2.5); }
  for (let col = 0; col <= 4; col++) { g.fillRect(col * pw - 1, 0, 2.5, H); hh.fillRect(col * pw - 1, 0, 2.5, H); r.fillRect(col * pw - 1, 0, 2.5, H); }
  const normal = yield* normalCanvas(height, 3);
  const tile = (c: HTMLCanvasElement, srgb: boolean) => worldTexture(c, srgb, 4.8, 4.8, 2);
  return { map: tile(color, true), normalMap: tile(normal, false), rmMap: tile(rm, false) };
}

/* ---------- Shader patches shared by the scene's materials ---------- */

export const shared = {
  uTime: { value: 0 },
  uCloud: { value: 0 },
  /** Weather on the surfaces: rain-wet (darker, glossy) and snow-covered tops. */
  uWet: { value: 0 },
  uSnow: { value: 0 },
  /** Sky reflection in glass, independent of how much the sky lights the walls. */
  uGlass: { value: 1 },
};

const NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm3(vec2 p) { return vnoise(p) * .5 + vnoise(p * 2.03 + 7.1) * .3 + vnoise(p * 4.1 + 3.3) * .2; }
float cloudShade(vec2 xz) {
  return smoothstep(0.5, 0.78, fbm3(xz * 0.0028 + uTime * vec2(0.006, 0.0035)));
}
`;

interface PatchOpts {
  /** Planar reflection: the reflector's texture and matrix, in this mesh's local frame. */
  reflect?: { tex: { value: THREE.Texture | null }; matrix: { value: THREE.Matrix4 }; strength: { value: number }; far: { value: number } };
  /** Ground detail noise, so the painted ground holds up close. */
  detail?: boolean;
  /** Flat roofs of merged context blocks take this colour instead of the facade tile. */
  roof?: THREE.Color;
  /** Metallic texels (glazing, frames) reflect the sky at full strength. */
  glass?: boolean;
}

/** World position, drifting cloud shadows and the optional extras above. */
export function patchMaterial(mat: THREE.Material, opts: PatchOpts = {}) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shared);
    if (opts.reflect) {
      shader.uniforms.tRefl = opts.reflect.tex;
      shader.uniforms.uReflMatrix = opts.reflect.matrix;
      shader.uniforms.uReflect = opts.reflect.strength;
      shader.uniforms.uReflFar = opts.reflect.far;
    }
    if (opts.roof) shader.uniforms.uRoof = { value: opts.roof };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos; varying float vWUp;
${opts.roof ? "varying float vUpN;" : ""}
${opts.reflect ? "uniform mat4 uReflMatrix; varying vec4 vReflUv;" : ""}`)
      .replace("#include <project_vertex>", `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWUp = normalize(mat3(modelMatrix) * objectNormal).y;
${opts.roof ? "vUpN = normal.z;" : ""}
${opts.reflect ? "vReflUv = uReflMatrix * vec4(transformed, 1.0);" : ""}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uTime; uniform float uCloud; uniform float uGlass; uniform float uWet; uniform float uSnow;
varying vec3 vWPos; varying float vWUp;
${opts.roof ? "varying float vUpN; uniform vec3 uRoof;" : ""}
${opts.reflect ? "uniform sampler2D tRefl; uniform float uReflect; uniform float uReflFar; varying vec4 vReflUv;" : ""}
${NOISE}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
${opts.roof ? "if (vUpN > 0.5) diffuseColor.rgb = uRoof;" : ""}
${opts.detail ? `diffuseColor.rgb *= 0.95 + 0.07 * fbm3(vWPos.xz * 0.12);` : ""}
// Weather: rain darkens what faces up (and gathers in puddles); snow settles on it,
// patchy at the edges of a surface and on slopes.
float wUp = smoothstep(0.45, 0.9, vWUp);
float wPuddle = smoothstep(0.55, 0.75, fbm3(vWPos.xz * 0.35));
diffuseColor.rgb *= 1.0 - uWet * (0.18 + 0.22 * wUp + 0.12 * wPuddle * wUp);
float wSnow = uSnow * smoothstep(0.35, 0.8, vWUp * (0.8 + 0.35 * fbm3(vWPos.xz * 0.6)));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), wSnow);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.12 + 0.2 * (1.0 - wPuddle), uWet * wUp * 0.85);
roughnessFactor = mix(roughnessFactor, 0.9, wSnow); metalnessFactor *= 1.0 - wSnow;
${opts.roof ? "if (vUpN > 0.5) { metalnessFactor = 0.0; roughnessFactor = 0.9; }" : ""}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
${opts.roof ? "if (vUpN > 0.5) totalEmissiveRadiance = vec3(0.0);" : ""}`)
      .replace("#include <opaque_fragment>", `
outgoingLight *= 1.0 - uCloud * cloudShade(vWPos.xz);
${opts.glass ? `#ifdef USE_ENVMAP
outgoingLight += metalnessFactor * (0.2 + 0.8 * pow(1.0 - clamp(dot(normal, geometryViewDir), 0.0, 1.0), 3.0))
  * getIBLRadiance(geometryViewDir, normal, roughnessFactor) * uGlass;
#endif` : ""}
${opts.reflect ? `{
  vec3 V = normalize(cameraPosition - vWPos);
  float gloss = clamp(1.0 - roughnessFactor, 0.0, 1.0);
  float fres = 0.1 + 0.9 * pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  vec2 ruv = vReflUv.xy / vReflUv.w;
  ruv += (vec2(vnoise(vWPos.xz * 1.7), vnoise(vWPos.zx * 1.7 + 5.0)) - 0.5) * 0.006 * (1.0 - gloss);
  float br = (1.0 - gloss) * 0.01;
  vec3 refl = texture2D(tRefl, ruv).rgb * 0.36
    + (texture2D(tRefl, ruv + vec2(br, 0.0)).rgb + texture2D(tRefl, ruv - vec2(br, 0.0)).rgb
     + texture2D(tRefl, ruv + vec2(0.0, br)).rgb + texture2D(tRefl, ruv - vec2(0.0, br)).rgb) * 0.16;
  float near = smoothstep(uReflFar, uReflFar * 0.35, length(vWPos - cameraPosition));
  outgoingLight = mix(outgoingLight, refl, clamp(fres * pow(gloss, 2.2) * uReflect * near, 0.0, 0.85));
}` : ""}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `complex:${!!opts.reflect}:${!!opts.detail}:${!!opts.roof}:${!!opts.glass}`;
}

/* ---------- Ground ---------- */

/** Where the 3D plants go (metres, footprint frame): trees, shrubs, flowers. */
export interface Planting {
  trees: [number, number][]; shrubs: [number, number][]; flowers: [number, number][];
  /** Flower borders (school grounds): x, y, run. */
  border?: [number, number, number][];
  /** Street trees in sidewalk pits: x, y and the road they line (one species per road). */
  street: [number, number, number][];
}
/** A street lamp on a sidewalk: position, and the unit direction its arm reaches over the road. */
export interface Lamp { x: number; y: number; dx: number; dy: number }
export interface GroundPlan { color: THREE.CanvasTexture; rough: THREE.CanvasTexture; glow: THREE.CanvasTexture; planting: Planting; lamps: Lamp[] }

/** Street lamps along the surveyed major roads: both sidewalks, staggered about every
 * 50 m a side, never inside the parcel or a footprint; one lamp where carriageways overlap. */
export function streetLamps(data: RealEstateBuildingsResponse): Lamp[] {
  const lamps: Lamp[] = [], cell = new Map<string, Lamp[]>();
  const key = (x: number, y: number) => `${Math.floor(x / 20)},${Math.floor(y / 20)}`;
  const near = (x: number, y: number) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const l of cell.get(`${Math.floor(x / 20) + i},${Math.floor(y / 20) + j}`) ?? []) if (Math.hypot(l.x - x, l.y - y) < 20) return true;
    return false;
  };
  // Bucketed footprints: a city block has well over a thousand of them.
  const inFootprint = ringIndex([...data.buildings, ...data.context].map(b => b.rings[0]));
  const blocked = (x: number, y: number) => data.site.some(r => inRing([x, y], r)) || inFootprint(x, y);
  for (const road of data.roads ?? []) {
    let carry = 0;
    for (let i = 0; i < road.line.length - 1; i++) {
      const [ax, ay] = road.line[i], [bx, by] = road.line[i + 1], len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
      for (let d = carry; d < len; d += 25) {
        const side = Math.round((d - carry) / 25 + i) % 2 ? 1 : -1, off = road.width / 2 + 1.2;
        const x = ax + ux * d + nx * off * side, y = ay + uy * d + ny * off * side;
        if (near(x, y) || blocked(x, y)) continue;
        const lamp = { x, y, dx: -nx * side, dy: -ny * side };
        lamps.push(lamp);
        const k = key(x, y);
        if (!cell.has(k)) cell.set(k, []);
        cell.get(k)!.push(lamp);
      }
      carry = (carry - len) % 25; if (carry < 0) carry += 25;
    }
  }
  return lamps.slice(0, 400);
}

type Season = "spring" | "summer" | "autumn" | "winter";
export function seasonNow(): Season {
  const m = new Date().getMonth() + 1;
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 9 ? "summer" : m >= 10 && m <= 11 ? "autumn" : "winter";
}

/** The ground painted top-down over ±T metres, smooth (no grain or noise).
 * Surveyed: the parcel (연속지적도), every registered footprint, and major roads at
 * their registered width and lane count (국가기본도 도로중심선). Drawn inside the parcel:
 * lawn, paved aprons around the towers, a perimeter walk and planting beds, whose
 * trees, shrubs and flowers are placed as 3D plants (`planting`). */
export const paintGround = (data: RealEstateBuildingsResponse, T: number, size: number, seed: number) => runNow(paintGroundSteps(data, T, size, seed));
/** The season's lawn and paddy colours (the ground's paint near and far: farGround.ts). */
export function seasonGround(season: Season = seasonNow()) {
  return {
    lawn: season === "autumn" ? "#76784c" : season === "winter" ? "#7b795f" : season === "spring" ? "#688a48" : "#5a7b3e",
    paddy: season === "summer" ? "#5f7d3c" : season === "autumn" ? "#b39a4e" : season === "spring" ? "#6b7563" : "#7d7461",
  };
}

export function* paintGroundSteps(data: RealEstateBuildingsResponse, T: number, size: number, seed: number): Steps<GroundPlan> {
  const S = size, k = S / (2 * T);
  const X = (x: number) => (x + T) * k, Y = (y: number) => (T - y) * k, m = (v: number) => v * k;
  const rnd = rng(seed);
  const season = seasonNow();
  const { lawn, paddy } = seasonGround(season);
  // Colour carries the detail; roughness and the night glow are low-frequency and
  // painted in the same coordinates onto 1024 px canvases (scaled context).
  const R = Math.min(1024, S);
  const color = canvas(S, S), rough = canvas(R, R);
  const cg = color.getContext("2d")!, rg = rough.getContext("2d")!;
  rg.scale(R / S, R / S);
  const path = (ctx: CanvasRenderingContext2D, ring: Ring) => {
    ctx.beginPath();
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
  };
  const line = (ctx: CanvasRenderingContext2D, pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  };
  const sitePath = (ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    for (const r of data.site) r.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
  };
  const towers = data.buildings.map(b => b.rings[0]);
  const rings = [...data.context.map(b => b.rings[0]), ...towers];
  const roads = data.roads ?? [];
  const lamps = streetLamps(data);
  const hasSite = data.site.length > 0;

  yield;
  // Occupancy mask (~0.5 m/px): R = plantable ground (the parcel, or a band round the
  // towers without one), G = blocked (footprints plus clearance, roads plus verge).
  const M = 1024, mk = M / (2 * T);
  const mask = canvas(M, M), mg = mask.getContext("2d", { willReadFrequently: true })!;
  const MX = (x: number) => (x + T) * mk, MY = (y: number) => (T - y) * mk;
  const mpath = (ring: [number, number][], close = true) => {
    mg.beginPath();
    ring.forEach(([x, y], i) => (i ? mg.lineTo(MX(x), MY(y)) : mg.moveTo(MX(x), MY(y))));
    if (close) mg.closePath();
  };
  mg.lineJoin = mg.lineCap = "round";
  mg.globalCompositeOperation = "lighter";
  mg.fillStyle = mg.strokeStyle = "#ff0000";
  if (hasSite) data.site.forEach(r => { mpath(r); mg.fill(); });
  else { mg.lineWidth = 60 * mk; towers.forEach(r => { mpath(r); mg.fill(); mg.stroke(); }); }
  mg.fillStyle = mg.strokeStyle = "#00ff00";
  mg.lineWidth = 12 * mk;
  rings.forEach(r => { mpath(r); mg.fill(); mg.stroke(); });
  roads.forEach(r => { mg.lineWidth = (r.width + 2 * sidewalkWidth(r.width) + 1) * mk; mpath(r.line, false); mg.stroke(); });
  // (read in four strips, a pause between: the whole 1024² at once was one ~15 ms piece)
  const md = new Uint8ClampedArray(M * M * 4);
  for (let y = 0; y < M; y += 256) {
    if (y) yield;
    md.set(mg.getImageData(0, y, M, Math.min(256, M - y)).data, y * M * 4);
  }
  const ok = (x: number, y: number) => {
    const px = Math.floor(MX(x)), py = Math.floor(MY(y));
    if (px < 0 || py < 0 || px >= M || py >= M) return false;
    const i = (py * M + px) * 4;
    return md[i] > 127 && md[i + 1] < 128;
  };
  /** Clear of footprints and roads (anywhere, not only on the parcel). */
  const free = (x: number, y: number) => {
    const px = Math.floor(MX(x)), py = Math.floor(MY(y));
    if (px < 0 || py < 0 || px >= M || py >= M) return false;
    return md[(py * M + px) * 4 + 1] < 128;
  };
  const reachT = hasSite ? Math.max(...data.site.flat().map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) : T * 0.5;

  yield;
  // Planting beds (shrubs and flowers), then trees on the open lawn and along the walk.
  const beds: [number, number, number, number, number][] = [];
  for (let i = 0; i < 1200 && beds.length < 70; i++) {
    const x = (rnd() * 2 - 1) * reachT, y = (rnd() * 2 - 1) * reachT;
    if (ok(x, y)) beds.push([x, y, 3 + rnd() * 5, 1.8 + rnd() * 2.6, rnd() * Math.PI]);
  }
  const inBed = (x: number, y: number) => beds.some(([bx, by, rx, ry, a]) => {
    const dx = x - bx, dy = y - by, u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a);
    return (u / rx) ** 2 + (v / ry) ** 2 < 1;
  });
  const planting: Planting = { trees: [], shrubs: [], flowers: [], street: [] };
  // Beds: shrubs in the middle, flowers toward the rim (about 1.3 plants per m²).
  beds.forEach(([bx, by, rx, ry, a]) => {
    const n = Math.round(Math.PI * rx * ry * 1.3);
    for (let j = 0; j < n; j++) {
      const u = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.92, lx = Math.cos(u) * rx * r, ly = Math.sin(u) * ry * r;
      const p: [number, number] = [bx + lx * Math.cos(a) - ly * Math.sin(a), by + lx * Math.sin(a) + ly * Math.cos(a)];
      (r > 0.6 ? planting.flowers : r > 0.3 || rnd() < 0.5 ? planting.shrubs : planting.flowers).push(p);
    }
  });
  yield;
  // Along the inside of the parcel boundary: a clipped hedge line, and a tree row behind it.
  const spaced = (list: [number, number][], x: number, y: number, gap: number) => !list.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < gap);
  for (const r of data.site) for (let i = 0; i < r.length; i++) {
    const [ax, ay] = r[i], [bx, by] = r[(i + 1) % r.length], len = Math.hypot(bx - ax, by - ay);
    if (len < 4) continue;
    const nx = -(by - ay) / len, ny = (bx - ax) / len; // rings run counter-clockwise: left is inside
    for (let d = 1; d < len - 1; d += 1.4) {
      const x = ax + (bx - ax) * d / len + nx * 5, y = ay + (by - ay) * d / len + ny * 5;
      if (ok(x, y)) planting.shrubs.push([x, y]);
    }
    for (let d = 4; d < len - 4; d += 8 + rnd() * 2) {
      const x = ax + (bx - ax) * d / len + nx * 9, y = ay + (by - ay) * d / len + ny * 9;
      if (ok(x, y) && spaced(planting.trees, x, y, 6)) planting.trees.push([x, y]);
    }
  }
  yield;
  // Open lawn: trees at least 7 m apart, clear of beds.
  for (let i = 0; i < 5000 && planting.trees.length < 420; i++) {
    const x = (rnd() * 2 - 1) * reachT, y = (rnd() * 2 - 1) * reachT;
    if (ok(x, y) && !inBed(x, y) && spaced(planting.trees, x, y, 7)) planting.trees.push([x, y]);
  }

  yield;
  // Land use from the 연속지적도 parcels (지목), painted under the complex and the roads:
  // each parcel in the surface its registered use gives it, and nothing drawn inside it
  // that isn't surveyed — road parcels (alleys included) asphalt, parks lawn, school
  // grounds dirt, rivers water, forest floor, fields soil, building lots paving.
  const parcels = data.parcels ?? [];
  const inSite = (x: number, y: number) => data.site.some(r => inRing([x, y], r));
  const lotTones = ["#a9a59c", "#b3aea4", "#9e9a92", "#bbb4a7", "#a49e92", "#aeaaa2", "#98958f"];
  const LAND: Record<string, { c: string | ((i: number) => string); r: number }> = {
    대: { c: i => lotTones[i % lotTones.length], r: 205 }, 도: { c: "#55585c", r: 185 }, 차: { c: "#4b4e52", r: 190 },
    주: { c: "#8f8d88", r: 170 }, 장: { c: "#8a8a86", r: 200 }, 창: { c: "#8e8c87", r: 200 }, 철: { c: "#6d655b", r: 245 },
    공: { c: lawn, r: 245 }, 체: { c: "#5d8744", r: 240 }, 원: { c: lawn, r: 245 }, 묘: { c: lawn, r: 245 },
    학: { c: "#bfa27a", r: 250 }, 임: { c: "#46542f", r: 252 }, 전: { c: "#86704f", r: 252 }, 답: { c: paddy, r: 200 },
    과: { c: "#6f7a45", r: 250 }, 목: { c: "#77814a", r: 250 },
    // Water parcels: their banks (둔치); the water itself is a surface on the channel (sceneWater.ts).
    천: { c: "#6b7a4f", r: 240 }, 구: { c: "#6f7a55", r: 240 }, 유: { c: "#6b7a4f", r: 240 }, 양: { c: "#6b7a4f", r: 240 },
    제: { c: "#7b8a55", r: 245 }, 종: { c: "#a8a298", r: 205 }, 사: { c: "#9f9888", r: 220 }, 수: { c: "#8e8c87", r: 200 },
    잡: { c: "#948a78", r: 240 }, 광: { c: "#8f877a", r: 240 }, 염: { c: "#b9b8b0", r: 120 },
  };
  // Covered streams (a road runs along the water parcel) are painted as the road they are.
  const covered = waterCovered(data);
  // A school ground: a dirt pitch inside a band of grass, the two worked into each other
  // (grass creeping in from the edges, worn earth where the grass is walked), with a
  // lighter, beaten patch in the middle.
  // (generators: the painting pauses between pieces — a school's tufts, a few hundred parcels —
  // the whole layout at once was a 50-70 ms step)
  const schoolGround = function* (ctx: CanvasRenderingContext2D, ring: Ring, i: number): Generator<void, void> {
    const r = rng(seed * 7 + i * 13 + 1);
    ctx.save();
    path(ctx, ring); ctx.clip();
    path(ctx, ring); ctx.fillStyle = "#b99a70"; ctx.fill();
    // Grass band along the edge, feathered into the dirt.
    ctx.strokeStyle = lawn; ctx.lineJoin = "round";
    for (const [w, a] of [[18, 0.18], [14, 0.32], [11, 0.5], [8, 0.75], [5, 1]] as const) {
      ctx.globalAlpha = a; ctx.lineWidth = m(w * 2); path(ctx, ring); ctx.stroke();
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 = Math.max(x0, -T); y0 = Math.max(y0, -T); x1 = Math.min(x1, T); y1 = Math.min(y1, T);
    const edge = (x: number, y: number) => {
      let d = Infinity;
      for (let q = 0, n = ring.length; q < n; q++) {
        const [ax, ay] = ring[q], [bx, by] = ring[(q + 1) % n], dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        d = Math.min(d, Math.hypot(x - ax - dx * t, y - ay - dy * t));
      }
      return d;
    };
    // The beaten middle: a lighter, sandier oval.
    const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
    const g = ctx.createRadialGradient(X(cxm), Y(cym), 0, X(cxm), Y(cym), m(Math.min(x1 - x0, y1 - y0) * 0.45));
    g.addColorStop(0, "rgba(212,188,150,0.55)"); g.addColorStop(1, "rgba(212,188,150,0)");
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(X(x0), Y(y1), m(x1 - x0), m(y1 - y0));
    // Mottling: grass tufts in the dirt, thinning away from the edge; bare patches in the grass.
    const grass = [lawn, "#6d8f4c", "#5f7f41", "#7c9a57"], dirt = ["#c3a57b", "#a98b62", "#b59571", "#cbb08a"];
    const count = Math.min(5000, ((x1 - x0) * (y1 - y0)) / 5);
    for (let n = 0; n < count; n++) {
      if (n && n % 800 === 0) yield;
      const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
      if (!inRing([x, y], ring)) continue;
      const d = edge(x, y);
      const green = r() < Math.exp(-d / 9) * 0.9 + 0.04;
      ctx.globalAlpha = 0.25 + r() * 0.4;
      ctx.fillStyle = green ? grass[Math.floor(r() * grass.length)] : dirt[Math.floor(r() * dirt.length)];
      ctx.beginPath();
      ctx.ellipse(X(x), Y(y), Math.max(1, m(0.4 + r() * (green ? 1.8 : 2.4))), Math.max(1, m(0.3 + r() * 1.2)), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
  const paintLand = function* (ctx: CanvasRenderingContext2D, rough: boolean): Generator<void, void> {
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      if (i && i % 250 === 0) yield;
      if (p.kind === "학" && !rough) { yield* schoolGround(ctx, p.ring, i); continue; }
      const spec = (WATER_KINDS.has(p.kind) && covered[i] ? LAND.도 : LAND[p.kind]) ?? LAND.대;
      path(ctx, p.ring);
      ctx.fillStyle = rough ? `rgb(0,${spec.r},0)` : typeof spec.c === "function" ? spec.c(i) : spec.c;
      ctx.fill();
    }
  };
  yield;
  // Trees where the land is a park or forest (and a few on burial grounds), clear of
  // buildings, roads and each other. A school keeps its playground open: its trees
  // stand in a row along the edge of the parcel, a few metres in, as schools plant them.
  const landTrees: [number, number][] = [];
  for (const p of parcels) {
    if (p.kind === "학") {
      const ring = p.ring, n = ring.length;
      let area = 0;
      for (let i = 0; i < n; i++) { const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n]; area += ax * by - bx * ay; }
      const inward = area > 0 ? 1 : -1, inset = 3, step = 9;
      for (let i = 0; i < n && landTrees.length < 900; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < step * 0.6) continue;
        // (left of the edge is inside for a counter-clockwise ring)
        const nx = (-(by - ay) / len) * inward * inset, ny = ((bx - ax) / len) * inward * inset;
        for (let t = step / 2; t < len - step / 3; t += step) {
          const k = t / len, jx = ax + (bx - ax) * k + nx + (rnd() - 0.5) * 1.2, jy = ay + (by - ay) * k + ny + (rnd() - 0.5) * 1.2;
          if (Math.abs(jx) < T && Math.abs(jy) < T && free(jx, jy) && inRing([jx, jy], ring) && !inSite(jx, jy) && spaced(landTrees, jx, jy, step * 0.7)) landTrees.push([jx, jy]);
        }
      }
      yield;
      continue;
    }
    const gap = p.kind === "임" ? 5.5 : p.kind === "공" || p.kind === "원" ? 8 : p.kind === "묘" ? 14 : 0;
    if (!gap) continue;
    // Only over the painted ground (a mountain parcel runs far past it).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p.ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 = Math.max(x0, -T); y0 = Math.max(y0, -T); x1 = Math.min(x1, T); y1 = Math.min(y1, T);
    let tested = 0;
    for (let y = y0 + gap / 2; y < y1 && landTrees.length < 900; y += gap * 0.87) {
      for (let x = x0 + gap / 2 + ((y / gap) % 2) * gap / 2; x < x1; x += gap) {
        const jx = x + (rnd() - 0.5) * gap * 0.5, jy = y + (rnd() - 0.5) * gap * 0.5;
        if (free(jx, jy) && inRing([jx, jy], p.ring) && !inSite(jx, jy)) landTrees.push([jx, jy]);
        if (++tested % 400 === 0) yield;
      }
    }
  }
  planting.trees.push(...landTrees);

  const layout = function* (ctx: CanvasRenderingContext2D, c: { base: string; walk: string; asphalt: string; lawn: string; path: string; apron: string; bed: string }): Generator<void, void> {
    ctx.fillStyle = c.base; ctx.fillRect(0, 0, S, S);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    yield* paintLand(ctx, ctx === rg);
    yield;
    ctx.save();
    if (hasSite) { sitePath(ctx); ctx.clip("evenodd"); ctx.fillStyle = c.lawn; ctx.fillRect(0, 0, S, S); }
    else { ctx.fillStyle = c.lawn; ctx.strokeStyle = c.lawn; ctx.lineWidth = m(40); towers.forEach(r => { path(ctx, r); ctx.stroke(); ctx.fill(); }); }
    if (hasSite) { ctx.strokeStyle = c.path; ctx.lineWidth = m(7); data.site.forEach(r => { path(ctx, r); ctx.stroke(); }); ctx.strokeStyle = c.lawn; ctx.lineWidth = m(2.2); data.site.forEach(r => { path(ctx, r); ctx.stroke(); }); }
    ctx.strokeStyle = c.apron; ctx.lineWidth = m(10);
    towers.forEach(r => { path(ctx, r); ctx.stroke(); });
    ctx.fillStyle = c.bed;
    beds.forEach(([x, y, rx, ry, a]) => { ctx.beginPath(); ctx.ellipse(X(x), Y(y), m(rx), m(ry), a, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
    // Roads last, at their surveyed width with the sidewalk each side (raised in 3D by
    // sceneSidewalk.ts): a road that crosses the parcel is real and stays paved.
    ctx.strokeStyle = c.walk;
    roads.forEach(r => { ctx.lineWidth = m(r.width + 2 * sidewalkWidth(r.width)); line(ctx, r.line); ctx.stroke(); });
    ctx.strokeStyle = c.asphalt;
    roads.forEach(r => { ctx.lineWidth = m(r.width); line(ctx, r.line); ctx.stroke(); });
  };
  yield* layout(cg, { base: "#8e8c86", walk: "#b3aea5", asphalt: "#3e4146", lawn, path: "#b9b1a2", apron: "#aea799", bed: "#4a3d30" });
  yield;
  yield* layout(rg, { base: "rgb(0,190,0)", walk: "rgb(0,150,0)", asphalt: "rgb(0,120,0)", lawn: "rgb(0,245,0)", path: "rgb(0,140,0)", apron: "rgb(0,125,0)", bed: "rgb(0,250,0)" });

  yield;
  // Lane markings from the registered lane count.
  cg.save();
  cg.lineCap = "butt";
  roads.forEach(r => {
    const lanes = Math.max(1, r.lanes);
    if (lanes < 2) return;
    for (let i = 0; i < r.line.length - 1; i++) {
      const [ax, ay] = r.line[i], [bx, by] = r.line[i + 1], len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const nx = -(by - ay) / len, ny = (bx - ax) / len;
      for (let l = 1; l < lanes; l++) {
        const off = -r.width / 2 + (r.width * l) / lanes, centre = l === lanes / 2;
        cg.strokeStyle = centre ? "rgba(214,178,70,0.7)" : "rgba(226,226,220,0.38)";
        cg.lineWidth = Math.max(0.75, m(0.15));
        cg.setLineDash(centre ? [] : [m(3), m(5)]);
        cg.beginPath(); cg.moveTo(X(ax + nx * off), Y(ay + ny * off)); cg.lineTo(X(bx + nx * off), Y(by + ny * off)); cg.stroke();
      }
    }
  });
  cg.setLineDash([]);
  cg.restore();
  yield;
  // Lamp light pools, lit at night through the ground's emissive map.
  const glow = canvas(R, R), gg = glow.getContext("2d")!;
  gg.scale(R / S, R / S);
  gg.fillStyle = "#000"; gg.fillRect(0, 0, S, S);
  gg.globalCompositeOperation = "lighter";
  lamps.forEach(l => {
    const px = X(l.x + l.dx * 1.6), py = Y(l.y + l.dy * 1.6), rad = m(13);
    const g = gg.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, "rgba(255,206,150,0.9)"); g.addColorStop(0.4, "rgba(255,180,110,0.32)"); g.addColorStop(1, "rgba(255,170,100,0)");
    gg.fillStyle = g; gg.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  });
  yield;
  // Soft contact shade around every footprint.
  // (one path, one blurred fill: a blur per footprint was hundreds of full-canvas GPU
  // passes, a 160 ms task in the browser's GPU process, and the pointer stalled with it)
  cg.filter = `blur(${Math.max(2, m(2.6))}px)`;
  cg.fillStyle = "rgba(0,0,0,0.34)";
  cg.beginPath();
  rings.forEach(ring => { ring.forEach(([x, y], i) => (i ? cg.lineTo(X(x), Y(y)) : cg.moveTo(X(x), Y(y)))); cg.closePath(); });
  cg.fill();
  cg.filter = "none";
  yield;
  // Fade toward the edge, so nothing streaks past the painted area.
  for (const [ctx, base] of [[cg, "142,140,134"], [rg, "0,190,0"]] as const) {
    const fade = ctx.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S * 0.5);
    fade.addColorStop(0, `rgba(${base},0)`); fade.addColorStop(1, `rgba(${base},1)`);
    ctx.fillStyle = fade; ctx.fillRect(0, 0, S, S);
  }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { color: tex(color, true), rough: tex(rough, false), glow: tex(glow, true), planting, lamps };
}

export function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------- Time of day and weather ---------- */

export type Tod = "day" | "dusk" | "night";
export type Weather = "clear" | "rain" | "snow";
export const WEATHER_ORDER: Weather[] = ["clear", "rain", "snow"];
export const WEATHER_LABEL: Record<Weather, string> = { clear: "맑음", rain: "비", snow: "눈" };
export const WEATHER_ICON: Record<Weather, string> = { clear: "☀", rain: "☂", snow: "❄" };

/** Local clock hour (fractional) now. */
export function hourNow(): number {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

const DEG = Math.PI / 180;
/** The sun over Korea for a KST clock hour on a given date: elevation and azimuth in
 * degrees (azimuth from south toward east, as `dirFrom` takes it). Declination and the
 * equation of time from the day of the year; good to about a degree. */
export function sunAt(hour: number, date = new Date(), lat = 37.55, lon = 126.98): { elev: number; az: number } {
  const n = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  const b = (360 / 365) * (n - 81) * DEG;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
  const decl = 23.44 * DEG * Math.sin(b);
  // KST keeps the 135°E meridian: solar time runs behind the clock west of it.
  const solar = hour + ((lon - 135) * 4 + eot) / 60;
  const h = (solar - 12) * 15 * DEG, phi = lat * DEG;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(h);
  const elev = Math.asin(THREE.MathUtils.clamp(sinEl, -1, 1));
  // Azimuth from south, positive toward west; the scene measures it toward east.
  const west = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  return { elev: elev / DEG, az: -west / DEG };
}

/** Local sidereal time (radians) at a KST clock hour: how far the sky has turned. */
export function siderealTurn(hour: number, date = new Date(), lon = 126.98): number {
  const ms = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + (hour - 9) * 3600000;
  const gmst = 280.46061837 + 360.98564736629 * (ms / 86400000 + 2440587.5 - 2451545);
  return ((((gmst + lon) % 360) + 360) % 360) * DEG;
}

/** Horizontal position (degrees; azimuth from south toward east) of equatorial RA/Dec
 * at a moment, from the local sidereal time. */
function horizontal(raDeg: number, decDeg: number, jd: number, lat: number, lon: number) {
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545);
  const h = (gmst + lon - raDeg) * DEG, phi = lat * DEG, dec = decDeg * DEG;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
  const west = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { elev: Math.asin(THREE.MathUtils.clamp(sinEl, -1, 1)) / DEG, az: -west / DEG };
}

/** The moon for a KST clock hour on a date: elevation and azimuth as `sunAt` gives them,
 * and how lit its disc is (0 new … 1 full). The main periodic terms of its orbit (after
 * Meeus); good to a degree or so, enough to rise, cross and set where it really does. */
export function moonAt(hour: number, date = new Date(), lat = 37.55, lon = 126.98): { elev: number; az: number; lit: number } {
  const ms = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + (hour - 9) * 3600000;
  const jd = ms / 86400000 + 2440587.5, d = jd - 2451545;
  const L = 218.316 + 13.176396 * d, M = (134.963 + 13.064993 * d) * DEG, F = (93.272 + 13.22935 * d) * DEG;
  const D = (297.85 + 12.190749 * d) * DEG, Ms = (357.529 + 0.98560028 * d) * DEG;
  const lam = (L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * M) - 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F)) * DEG;
  const beta = (5.128 * Math.sin(F) + 0.281 * Math.sin(M + F) + 0.278 * Math.sin(M - F)) * DEG;
  const eps = 23.439 * DEG;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lam));
  // Phase from the elongation: the moon's longitude less the sun's.
  const sunLon = (280.46 + 0.9856474 * d + 1.915 * Math.sin(Ms) + 0.02 * Math.sin(2 * Ms)) * DEG;
  const lit = (1 - Math.cos(lam - sunLon)) / 2;
  return { ...horizontal(ra / DEG, dec / DEG, jd, lat, lon), lit };
}

/** Clock hour of sunset (the sun 2° up, in the evening) on the date. */
export function sunsetHour(date = new Date(), lat?: number, lon?: number): number {
  let lo = 12, hi = 23;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (sunAt(mid, date, lat, lon).elev > 2) lo = mid; else hi = mid; }
  return lo;
}

/** The clock hour a named time of day opens the view at (?tod=, initialTod). */
export function hourForTod(tod: Tod, date = new Date()): number {
  return tod === "day" ? 13 : tod === "dusk" ? sunsetHour(date) - 0.2 : 22;
}

/** What to call the light at this sun elevation (morning or evening by the clock). */
export function phaseLabel(elev: number, hour: number): string {
  // Twilight by its usual steps: 새벽 from nautical dawn, 해질녘 to civil dusk, then
  // 초저녁 through nautical dusk.
  if (elev < -12) return "밤";
  if (elev < 0 && hour < 12) return "새벽";
  if (elev < -6) return "초저녁";
  if (elev < 0) return "해질녘";
  if (elev < 8) return hour < 12 ? "일출" : "노을";
  if (elev < 22) return hour < 12 ? "아침" : "오후";
  return "낮";
}

export function formatHour(hour: number): string {
  const m = Math.round((((hour % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export interface Look {
  sunElev: number; sunAz: number; keyElev: number; keyAz: number;
  turbidity: number; rayleigh: number; mie: number; mieG: number;
  key: THREE.Color; keyI: number; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number;
  fog: THREE.Color; fogK: number; exposure: number; env: number;
  /** stars: how much night it is (0 day … 1 night); the sky shaders read it so. */
  windows: number; lamps: number; stars: number; clouds: number; cloudShade: number;
  bloom: number; bloomAt: number; reflect: number;
  /** Weather: the overcast deck (0 … 1), rain and snow (falling, and on the ground). */
  overcast: number; rain: number; snow: number;
  /** Where the moon is (degrees, as sunElev / sunAz) and how lit its disc is. */
  moonElev: number; moonAz: number; moonLit: number;
  /** The star field's turn about the celestial pole (local sidereal time, radians). */
  starTurn: number;
}

type LookSpec = Omit<Look, "key" | "hemiSky" | "hemiGround" | "fog" | "overcast" | "rain" | "snow" | "moonElev" | "moonAz" | "moonLit" | "starTurn"> & { key: string; hemiSky: string; hemiGround: string; fog: string };
const look = (l: LookSpec): Look => ({
  ...l, key: new THREE.Color(l.key), hemiSky: new THREE.Color(l.hemiSky), hemiGround: new THREE.Color(l.hemiGround), fog: new THREE.Color(l.fog),
  overcast: 0, rain: 0, snow: 0, moonElev: 30, moonAz: 20, moonLit: 1, starTurn: 0,
});

// Azimuth in degrees from south (+z) toward east (+x); the camera opens from the south-east.
export const LOOKS: Record<Tod, Look> = {
  day: look({
    sunElev: 40, sunAz: -28, keyElev: 40, keyAz: -28, turbidity: 1.4, rayleigh: 1.9, mie: 0.0015, mieG: 0.7,
    key: "#fff3e0", keyI: 3.4, hemiSky: "#c4dcf6", hemiGround: "#6f6552", hemiI: 0.3,
    fog: "#a9c1dc", fogK: 0.075, exposure: 0.56, env: 0.16, windows: 0, lamps: 0, stars: 0, clouds: 0.34, cloudShade: 0.26, bloom: 0.2, bloomAt: 4, reflect: 0.85,
  }),
  dusk: look({
    sunElev: 3.5, sunAz: -70, keyElev: 6, keyAz: -70, turbidity: 6.5, rayleigh: 2.6, mie: 0.007, mieG: 0.9,
    key: "#ffa65a", keyI: 3.4, hemiSky: "#8e9bd0", hemiGround: "#4a3a3a", hemiI: 0.45,
    fog: "#e3aa86", fogK: 0.12, exposure: 0.72, env: 0.3, windows: 0.22, lamps: 0.6, stars: 0, clouds: 0.5, cloudShade: 0.05, bloom: 0.3, bloomAt: 2.5, reflect: 1,
  }),
  night: look({
    sunElev: -5, sunAz: -85, keyElev: 42, keyAz: 55, turbidity: 2, rayleigh: 1, mie: 0.004, mieG: 0.8,
    key: "#a4b8ff", keyI: 0.8, hemiSky: "#3b4f7a", hemiGround: "#0d0f16", hemiI: 0.6,
    fog: "#152238", fogK: 0.2, exposure: 1.05, env: 1.0, windows: 2.1, lamps: 1.6, stars: 1, clouds: 0.3, cloudShade: 0, bloom: 0.55, bloomAt: 1.3, reflect: 1.1,
  }),
};

/** The light through the day by sun elevation: night, blue hour, afterglow, sunset,
 * golden hour, day, high summer noon. Between two stops the look blends; the sun's
 * direction comes from the clock afterwards. */
const SUN_STOPS: [number, Look][] = [
  [-16, LOOKS.night],
  [-7, look({
    sunElev: -7, sunAz: 0, keyElev: 0, keyAz: 0, turbidity: 3, rayleigh: 1.8, mie: 0.005, mieG: 0.85,
    key: "#8ea4ff", keyI: 0.45, hemiSky: "#5a6aa8", hemiGround: "#1a1822", hemiI: 0.62,
    fog: "#34406a", fogK: 0.16, exposure: 1.0, env: 0.8, windows: 1.7, lamps: 1.45, stars: 0.78, clouds: 0.35, cloudShade: 0, bloom: 0.46, bloomAt: 1.5, reflect: 1.05,
  })],
  [-1.5, look({
    sunElev: -1.5, sunAz: 0, keyElev: 0, keyAz: 0, turbidity: 5, rayleigh: 2.4, mie: 0.006, mieG: 0.88,
    key: "#ff8a50", keyI: 1.3, hemiSky: "#7d82bd", hemiGround: "#3a2e34", hemiI: 0.52,
    fog: "#cf8a78", fogK: 0.13, exposure: 0.82, env: 0.45, windows: 0.75, lamps: 1.05, stars: 0.3, clouds: 0.48, cloudShade: 0.02, bloom: 0.36, bloomAt: 2, reflect: 1,
  })],
  [4, LOOKS.dusk],
  [14, look({
    sunElev: 14, sunAz: 0, keyElev: 0, keyAz: 0, turbidity: 3.5, rayleigh: 2.2, mie: 0.004, mieG: 0.8,
    key: "#ffd4a3", keyI: 3.3, hemiSky: "#b3c4e8", hemiGround: "#5e5146", hemiI: 0.38,
    fog: "#c7bcb0", fogK: 0.095, exposure: 0.62, env: 0.22, windows: 0.04, lamps: 0.08, stars: 0, clouds: 0.42, cloudShade: 0.16, bloom: 0.24, bloomAt: 3.2, reflect: 0.9,
  })],
  [38, LOOKS.day],
  [72, look({
    sunElev: 72, sunAz: 0, keyElev: 0, keyAz: 0, turbidity: 1.3, rayleigh: 1.8, mie: 0.0014, mieG: 0.7,
    key: "#fffaf0", keyI: 3.6, hemiSky: "#c9e0f8", hemiGround: "#72695a", hemiI: 0.28,
    fog: "#b1cae4", fogK: 0.07, exposure: 0.53, env: 0.15, windows: 0, lamps: 0, stars: 0, clouds: 0.34, cloudShade: 0.28, bloom: 0.2, bloomAt: 4, reflect: 0.85,
  })],
];

// Where the night's key light comes from while the moon is down: a high, dim sky light.
const NIGHT_SKY = { elev: 42, az: 55 };

/** The clear-sky look for a sun (and moon) position. */
export function sunLook(elev: number, az: number, moon: { elev: number; az: number; lit: number } = { elev: NIGHT_SKY.elev, az: NIGHT_SKY.az, lit: 1 }): Look {
  const last = SUN_STOPS.length - 1;
  let l: Look;
  if (elev <= SUN_STOPS[0][0]) l = mixLook(SUN_STOPS[0][1], SUN_STOPS[0][1], 0);
  else if (elev >= SUN_STOPS[last][0]) l = mixLook(SUN_STOPS[last][1], SUN_STOPS[last][1], 0);
  else {
    let i = 0;
    while (elev > SUN_STOPS[i + 1][0]) i++;
    const [e0, a] = SUN_STOPS[i], [e1, b] = SUN_STOPS[i + 1];
    const t = (elev - e0) / (e1 - e0);
    l = mixLook(a, b, t * t * (3 - 2 * t));
  }
  l.sunElev = elev; l.sunAz = az;
  l.moonElev = moon.elev; l.moonAz = moon.az; l.moonLit = moon.lit;
  // At night the key light is the moon while it is up (brighter the higher and fuller
  // it is, its shadows turning as it crosses the sky), a dim high sky light while it is
  // down.
  const up = THREE.MathUtils.smoothstep(moon.elev, -1, 12);
  const night = { elev: THREE.MathUtils.lerp(NIGHT_SKY.elev, Math.max(moon.elev, 12), up), az: moon.az * up + NIGHT_SKY.az * (1 - up) };
  if (up < 1 && up > 0) { let a = moon.az - NIGHT_SKY.az; a -= Math.round(a / 360) * 360; night.az = NIGHT_SKY.az + a * up; }
  const moonLight = 0.45 + 0.55 * up * (0.3 + 0.7 * moon.lit);
  // The key light is the sun while it is up (5° at the lowest: a lower sun's shadows
  // would run past the shadow map), the night's once it is down; across twilight, when
  // both are faint, it swings over.
  const w = THREE.MathUtils.smoothstep(elev, -5, 1);
  l.keyI *= THREE.MathUtils.lerp(moonLight, 1, w);
  l.keyElev = THREE.MathUtils.lerp(night.elev, Math.max(elev, 5), w);
  let dAz = az - night.az;
  dAz -= Math.round(dAz / 360) * 360;
  l.keyAz = night.az + dAz * w;
  // Direct light thins as the sun lowers (more air): full from about 30°.
  if (elev > 0) l.keyI *= 0.55 + 0.45 * THREE.MathUtils.smoothstep(elev, 0, 30);
  return l;
}

/** Rain or snow over a clear look. Both close the sky (no sun disc, faint soft shadows,
 * light from the whole sky), thicken the haze and turn the lights on earlier; rain wets
 * the ground (reflections), snow whitens it (light thrown back up). The greys follow how
 * light it is: a night deck glows dully with the city under it. */
function weatherLook(base: Look, kind: "rain" | "snow"): Look {
  const l = mixLook(base, base, 0);
  const day = 1 - base.stars;
  const lit = THREE.MathUtils.smoothstep(base.sunElev, -8, 12);
  if (kind === "rain") {
    l.overcast = 1; l.rain = 1;
    l.keyI = base.keyI * 0.12;
    l.hemiI = base.hemiI * (1.6 + 0.9 * lit);
    l.hemiSky.lerp(new THREE.Color("#8d97a3").multiplyScalar(0.35 + 0.65 * lit), 0.8);
    l.hemiGround.lerp(new THREE.Color("#2e3033"), 0.6);
    l.fog.lerp(new THREE.Color("#262a31").lerp(new THREE.Color("#7f8890"), lit), 0.85);
    l.fogK = base.fogK * 2.3;
    l.exposure = base.exposure * (1.08 + 0.12 * lit);
    l.windows = base.windows + 0.3 * day;
    l.lamps = Math.max(base.lamps, 0.25 + 0.35 * (1 - lit));
    l.clouds = 0; l.cloudShade = 0;
    l.reflect = base.reflect * 1.7;
    l.bloom = base.bloom * 1.15;
    l.env = base.env * 1.2;
  } else {
    l.overcast = 0.9; l.snow = 1;
    l.keyI = base.keyI * 0.24;
    l.hemiI = base.hemiI * (1.5 + 0.8 * lit);
    l.hemiSky.lerp(new THREE.Color("#c5ccd6").multiplyScalar(0.3 + 0.7 * lit), 0.8);
    l.hemiGround.lerp(new THREE.Color("#b9bfc7").multiplyScalar(0.25 + 0.75 * lit), 0.75);
    l.fog.lerp(new THREE.Color("#363b46").lerp(new THREE.Color("#c2c8d0"), lit), 0.85);
    l.fogK = base.fogK * 2.8;
    l.exposure = base.exposure * (1.0 - 0.06 * lit);
    l.windows = base.windows + 0.2 * day;
    l.lamps = Math.max(base.lamps, 0.2 + 0.3 * (1 - lit));
    l.clouds = 0; l.cloudShade = 0;
    l.reflect = base.reflect * 0.35;
    l.env = base.env * 1.15;
  }
  return l;
}

/** The whole look: the sun from the clock, then rain and snow by how far each has set
 * in (0 … 1; the caller eases these for a gradual change of weather). */
export function atmosphereLook(hour: number, rain: number, snow: number, date?: Date, lat?: number, lon?: number): Look {
  const { elev, az } = sunAt(hour, date, lat, lon);
  let l = sunLook(elev, az, moonAt(hour, date, lat, lon));
  l.starTurn = siderealTurn(hour, date, lon);
  if (rain > 0.001) l = mixLook(l, weatherLook(l, "rain"), rain);
  if (snow > 0.001) l = mixLook(l, weatherLook(l, "snow"), snow);
  return l;
}

export function mixLook(a: Look, b: Look, t: number): Look {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(a) as (keyof Look)[]) {
    const x = a[k], y = b[k];
    out[k] = x instanceof THREE.Color ? x.clone().lerp(y as THREE.Color, t) : (x as number) + ((y as number) - (x as number)) * t;
  }
  return out as unknown as Look;
}

export function dirFrom(elevDeg: number, azDeg: number, out = new THREE.Vector3()) {
  const el = THREE.MathUtils.degToRad(elevDeg), az = THREE.MathUtils.degToRad(azDeg);
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

/** The WebGL sky, drawn like the native renderer's (tidewater/ComplexRenderer.js
 * `complexSky`): a clear blue gradient, fair-weather cumulus drifting overhead, a small
 * soft sun without glare, night and dusk tints; below the horizon, the haze. Weather
 * closes it: an overcast deck of uneven thickness (a dull glow where the sun is behind it
 * in snow), darker ragged scud under rain clouds, a city-lit deck at night. It replaces
 * three's physical Sky shading, which washes out toward the sun. Keep the two in step. */
export function patchSky(mat: THREE.ShaderMaterial, horizon: THREE.Color) {
  mat.uniforms.uHorizon = { value: horizon };
  mat.uniforms.uSunColor = { value: new THREE.Color(3, 2.9, 2.7) };
  mat.uniforms.uNight = { value: 0 };
  mat.uniforms.uWeather = { value: new THREE.Vector3() }; // overcast, rain, snow
  mat.uniforms.uStarVis = { value: 0 };
  mat.uniforms.uStarTurn = { value: 0 };
  mat.fragmentShader = /* glsl */`
varying vec3 vWorldPosition;
uniform vec3 sunPosition; uniform float time; uniform vec3 uHorizon; uniform vec3 uSunColor; uniform float uNight; uniform vec3 uWeather;
uniform float uStarVis; uniform float uStarTurn;
float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), u.x), mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), u.x), u.y);
}
float skyFbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * skyNoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
float cumulus(vec2 uv) {
  vec2 warp = vec2(skyFbm(uv * 0.7 + vec2(3.1, 1.7)), skyFbm(uv * 0.7 + vec2(8.3, 2.8))) - 0.5;
  float billow = skyFbm(uv * 1.7 + warp * 0.9);
  float cover = smoothstep(0.34, 0.6, skyNoise(uv * 0.85 + vec2(5.0, 1.0)) * 0.7 + skyNoise(uv * 0.3 + vec2(2.0, 7.0)) * 0.3);
  return smoothstep(0.5, 0.6, billow * (0.62 + 0.55 * cover)) * smoothstep(0.05, 0.4, cover);
}
// Stars: three layers (many faint, some medium, a few bright with a soft halo), each
// star its own colour (blue-white to orange) and twinkle, the Milky Way a faint dusty
// band. The field turns about the celestial pole with the clock (uStarTurn, sidereal).
// Twin: STARS_WGSL in tidewater/ComplexRenderer.js.
vec3 sHash3(vec3 p) { p = fract(p * vec3(0.1031, 0.103, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
vec3 starLayer(vec3 d, float scale, float density, float pr, float bright, float halo, float t) {
  vec3 c = floor(d * scale), h = sHash3(c);
  if (h.x > density) return vec3(0.0);
  vec3 sd = normalize(c + 0.2 + 0.6 * sHash3(c + 17.0));
  float ang = length(d - sd), k = h.z;
  vec3 col = k < 0.12 ? vec3(0.72, 0.82, 1.15) : k < 0.6 ? vec3(1.0, 0.98, 0.95) : k < 0.86 ? vec3(1.1, 0.95, 0.78) : vec3(1.15, 0.78, 0.58);
  float b = bright * (0.2 + 0.8 * pow(h.y, 3.0));
  float tw = 1.0 + 0.45 * sin(t * (1.5 + 5.0 * h.y) + h.x * 90.0) * sin(t * (2.3 + 3.0 * h.z) + h.y * 40.0);
  float core = exp(-pow(ang / (pr * 0.95), 2.0)) + halo * exp(-ang / (pr * 3.5));
  return col * b * tw * core;
}
vec3 starField(vec3 ray, float pr, float t, float turn, float vis) {
  if (vis < 0.002 || ray.y < -0.02) return vec3(0.0);
  // Into the star frame: undo the sky's turn about the pole (north is -z; latitude 37.5°).
  vec3 k = vec3(0.0, 0.6088, -0.7934);
  float cs = cos(-turn), sn = sin(-turn);
  vec3 d = ray * cs + cross(k, ray) * sn + k * dot(k, ray) * (1.0 - cs);
  vec3 n = normalize(vec3(0.42, 0.18, 0.89));
  float band = exp(-pow(dot(d, n) / 0.17, 2.0));
  float dust = skyFbm(vec2(atan(d.z, d.x) * 5.0, d.y * 7.0));
  vec3 s = starLayer(d, 95.0, 0.5 + 0.4 * band, pr, 0.32, 0.0, t)
         + starLayer(d, 42.0, 0.45, pr, 0.85, 0.04, t)
         + starLayer(d, 15.0, 0.28, pr * 1.3, 2.6, 0.12, t);
  vec3 milky = vec3(0.022, 0.025, 0.036) * band * smoothstep(0.3, 0.75, dust) * (1.0 - 0.6 * smoothstep(0.55, 0.7, skyFbm(vec2(atan(d.z, d.x) * 11.0, d.y * 16.0))));
  // Thinner and dimmer toward the horizon (more air, city haze).
  return (s + milky) * vis * smoothstep(-0.02, 0.22, ray.y);
}
void main() {
  vec3 ray = normalize(vWorldPosition - cameraPosition);
  float pixel = length(fwidth(ray));
  vec3 sunDir = normalize(sunPosition);
  float day = 1.0 - uNight;
  float overcast = uWeather.x, rain = uWeather.y, snow = uWeather.z;
  float e = clamp(ray.y, 0.0, 1.0);
  float dusk = 1.0 - smoothstep(0.04, 0.45, sunDir.y);
  vec3 zenith = mix(vec3(0.08, 0.27, 0.72), vec3(0.24, 0.2, 0.34), dusk);
  vec3 hor = mix(vec3(0.55, 0.71, 0.9), uHorizon, dusk * 0.85);
  vec3 sky = mix(mix(uHorizon * 0.45, vec3(0.006, 0.013, 0.04), pow(e, 0.35)), mix(hor, zenith, pow(e, 0.55)), day);
  vec3 tint = uSunColor / max(max(uSunColor.r, max(uSunColor.g, uSunColor.b)), 0.001);
  sky += starField(ray, pixel, time, uStarTurn, uStarVis);
  if (ray.y > 0.0) {
    vec2 uv = ray.xz / (ray.y + 0.22) * 1.35 + vec2(time * 0.005, time * 0.0018);
    float d = cumulus(uv) * (1.0 - overcast);
    if (d > 0.002) {
      vec2 toSun = normalize(sunDir.xz + vec2(0.0001, 0.0)) * 0.22;
      float lit = clamp(1.0 - (cumulus(uv + toSun) - d * 0.35) * 1.5, 0.0, 1.0);
      vec3 dayCloud = mix(vec3(0.6, 0.65, 0.74), vec3(1.06, 1.05, 1.02) * mix(vec3(1.0), tint, 0.3), lit);
      sky = mix(sky, mix(uHorizon * 0.25, dayCloud, day), clamp(d * 1.25, 0.0, 0.97) * smoothstep(0.0, 0.08, ray.y));
    }
  }
  if (overcast > 0.001) {
    // The deck: grey by day (milky in snow, leaden in rain), dimming as the sun goes
    // down; at night the haze colour, lit from below by the city.
    vec2 uv = ray.xz / (max(ray.y, 0.0) + 0.3) * 0.9 + vec2(time * 0.012, time * 0.004);
    float thick = skyFbm(uv * 0.8);
    float scud = smoothstep(0.52, 0.72, skyFbm(uv * 1.9 + vec2(4.0, 9.0) + time * 0.01));
    vec3 grey = mix(vec3(0.6, 0.64, 0.69), vec3(0.8, 0.82, 0.85), snow) * mix(1.0, 0.66, rain);
    grey *= mix(0.35, 1.0, smoothstep(-0.12, 0.35, sunDir.y));
    vec3 deck = mix(uHorizon * 0.9 + vec3(0.025, 0.02, 0.016), grey, day);
    deck *= (0.8 + 0.34 * thick) * (1.0 - 0.3 * rain * scud) * mix(0.93, 1.05, e);
    // The sun a pale glow behind thin cloud (snow, never rain).
    deck += tint * 0.22 * pow(max(dot(ray, sunDir), 0.0), 18.0) * day * (1.0 - rain) * smoothstep(-0.02, 0.1, sunDir.y);
    sky = mix(sky, deck, overcast * smoothstep(-0.02, 0.06, ray.y) * 0.95);
  }
  float sun = max(dot(ray, sunDir), 0.0);
  sky = mix(sky, tint * 1.15, smoothstep(0.99985, 0.99995, sun) * day * 0.85 * (1.0 - overcast));
  sky = mix(uHorizon, sky, smoothstep(-0.01, 0.07, ray.y));
  gl_FragColor = vec4(sky * 1.15, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  mat.needsUpdate = true;
}

/* ---------- Rain and snow ---------- */

/** Falling rain and snow, the same in both renderers (WGSL twin: PRECIP_WGSL in
 * tidewater/ComplexRenderer.js). Drops live on a few cylinders around the camera; `q`
 * is a point on one (arc length, height, in metres), r its radius, pix a pixel's size
 * there. Rain: thin slanted streaks falling fast; snow: soft flakes drifting down and
 * swaying. Each returns coverage 0 … 1. */
export const PRECIP_RADII = [2.5, 5, 9, 16, 28];
const PRECIP_GLSL = /* glsl */`
float pHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float rainAt(vec2 q, float r, float pix, float t, float amount, float slant) {
  float cu = r * 0.024, cv = cu * 7.0;
  q.x += q.y * slant;
  q.y += t * 8.5;
  vec2 g = q / vec2(cu, cv), cell = floor(g), f = g - cell;
  if (pHash(cell + r) > amount * 0.6) return 0.0;
  float x0 = 0.2 + 0.6 * pHash(cell + r + 1.7), y0 = 0.25 * pHash(cell + r + 3.1);
  float w = max(0.0045, pix * 0.75);
  float across = smoothstep(w, 0.0, abs(f.x - x0) * cu);
  float along = (f.y - y0) / 0.7;
  return across * smoothstep(0.0, 0.2, along) * smoothstep(1.0, 0.55, along) * min(1.0, 0.0045 / w * 1.6);
}
float snowAt(vec2 q, float r, float pix, float t, float amount) {
  float c = r * 0.045;
  q.y += t * 0.735;
  vec2 g = q / c, cell = floor(g), f = g - cell;
  float h = pHash(cell + r);
  if (h > amount * 0.42) return 0.0;
  vec2 p0 = vec2(0.3 + 0.4 * pHash(cell + r + 1.7), 0.3 + 0.4 * pHash(cell + r + 3.1));
  p0.x += sin(t * 1.3 + h * 40.0) * 0.14;
  float rad = 0.007 + 0.008 * pHash(cell + r + 5.3), rr = max(rad, pix * 0.9);
  float d = length((f - p0) * c);
  return smoothstep(rr, rr * 0.3, d) * min(1.0, pow(rad / rr, 2.0) * 1.4);
}`;

/** The WebGL rain and snow: one open cylinder per radius, kept around the camera and
 * drawn after the opaque scene (the depth test hides drops behind a tower). */
export function precipField() {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
  const group = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 }, uRain: { value: 0 }, uSnow: { value: 0 }, uPixAngle: { value: 0.001 }, uSlant: { value: 0.18 },
    uRainColor: { value: new THREE.Color() }, uSnowColor: { value: new THREE.Color() }, uHaze: { value: 0 },
  };
  const layers = PRECIP_RADII.map((r, i) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uR: { value: r } },
      vertexShader: /* glsl */`varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */`
uniform float uTime, uRain, uSnow, uPixAngle, uSlant, uR, uHaze; uniform vec3 uRainColor, uSnowColor;
varying vec3 vW;
${PRECIP_GLSL}
void main() {
  vec3 d = vW - cameraPosition;
  float dist = length(d), pix = dist * uPixAngle;
  // Looking steeply down or up, the cylinder is seen edge-on: let it fade.
  float side = smoothstep(0.12, 0.45, length(d.xz) / dist);
  vec2 q = vec2(atan(d.z, d.x) * uR, vW.y);
  float fade = exp(-dist * uHaze) * side;
  float rain = uRain > 0.001 ? rainAt(q, uR, pix, uTime, uRain, uSlant) : 0.0;
  float snow = uSnow > 0.001 ? snowAt(q, uR, pix, uTime, uSnow) : 0.0;
  float a = clamp(rain * 0.34 + snow * 0.9, 0.0, 1.0) * fade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uRainColor, uSnowColor, snow / max(rain + snow, 0.001)), a);
}`,
      transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(r, r * 10, r);
    mesh.renderOrder = 10 + (PRECIP_RADII.length - i);
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  });
  group.visible = false;
  return {
    group,
    /** Each frame: centred on the camera. */
    update(camera: THREE.PerspectiveCamera, time: number, heightPx: number) {
      uniforms.uTime.value = time;
      if (!group.visible) return;
      uniforms.uPixAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, heightPx);
      group.position.copy(camera.position);
    },
    setLook(l: Look) {
      uniforms.uRain.value = l.rain;
      uniforms.uSnow.value = l.snow;
      group.visible = l.rain > 0.01 || l.snow > 0.01;
      // Lit like the haze around them; flakes a little brighter than the streaks.
      uniforms.uRainColor.value.copy(l.fog).multiplyScalar(1.35).addScalar(0.025);
      uniforms.uSnowColor.value.copy(l.fog).multiplyScalar(1.7).addScalar(0.05);
      uniforms.uHaze.value = 0.012;
      layers.forEach(m => { (m.material as THREE.ShaderMaterial).uniformsNeedUpdate = true; });
    },
    dispose() { geo.dispose(); layers.forEach(m => (m.material as THREE.Material).dispose()); },
  };
}

/** Display-referred finish: a gentle vignette, and dither against sky banding. (No lens
 * flare or sun glare: the sky should read as a plain blue sky with clouds.) */
export const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.9 }, uAspect: { value: 1 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uVignette;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 dv = vUv - 0.5;
  c.rgb *= mix(1.0, smoothstep(0.95, 0.25, length(dv)), uVignette * 0.35);
  c.rgb += (h(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = c;
}`,
};

/** The moon: a photographic disk (/3d/moon.webp, from the Solar System Scope lunar
 * map, CC BY 4.0) with a soft halo, where the moon is at the hour on the slider (Look
 * moonElev / moonAz): it rises, crosses the sky and sets as the time moves. It keeps
 * that direction as the camera orbits, zooms or pans, sits beyond the haze, and
 * anything nearer (a tower) hides it. Shown at night, while it is above the horizon. */
export function moonInSky() {
  const dir = new THREE.Vector3(0, 1, 0);
  let above = 1, level = 0, lit = 1;
  const disc = new THREE.TextureLoader().load(cdn("/3d/moon.webp"));
  disc.colorSpace = THREE.SRGBColorSpace;
  const glowCanvas = canvas(128, 128), g = glowCanvas.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,250,235,0.32)"); grad.addColorStop(0.3, "rgba(225,232,255,0.1)"); grad.addColorStop(1, "rgba(200,215,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const glow = new THREE.CanvasTexture(glowCanvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  const mat = (tex: THREE.Texture) => {
    // Black albedo, the image as emission, its alpha as coverage: unlit, unfogged.
    const m = new THREE.MeshStandardMaterial({ color: "#000000", map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0,
      transparent: true, depthWrite: false, fog: false, roughness: 1, metalness: 0 });
    m.userData.sky = true;
    return m;
  };
  const quad = new THREE.PlaneGeometry(1, 1);
  const halo = new THREE.Mesh(quad, mat(glow)), moon = new THREE.Mesh(quad, mat(disc));
  halo.renderOrder = 1; moon.renderOrder = 2;
  const group = new THREE.Group();
  group.add(halo, moon);
  group.visible = false;
  return {
    group,
    /** Each frame: far along the fixed direction from the camera, facing it. */
    update(camera: THREE.PerspectiveCamera) {
      if (!group.visible) return;
      const d = camera.far * 0.6, size = 2 * d * Math.tan(THREE.MathUtils.degToRad(1.3)); // ~2.6°: larger than life, as it reads
      group.position.copy(camera.position).addScaledVector(dir, d);
      group.quaternion.copy(camera.quaternion);
      moon.scale.setScalar(size);
      halo.scale.setScalar(size * 2.6);
    },
    /** Where it is (degrees, as dirFrom takes them) and how lit (0 new … 1 full). A
     * moon near the horizon sinks into it rather than vanishing. */
    setPosition(elevDeg: number, azDeg: number, litFraction = 1) {
      // The orbit camera looks at most a little above the horizon: a moon drawn at its
      // true height would leave the view within the hour of rising. Its bearing is real;
      // its height is eased into the band the view shows (it still rises and sets).
      const shown = elevDeg <= 0 ? elevDeg : 5 * (1 - Math.exp(-elevDeg / 7));
      dirFrom(shown, azDeg, dir);
      above = THREE.MathUtils.smoothstep(elevDeg, -1.5, 1.5);
      lit = litFraction;
      this.setLevel(level);
    },
    /** Look.stars: 1 at night, 0 by day (and less behind an overcast). */
    setLevel(next: number) {
      level = next;
      const k = level * above * (0.35 + 0.65 * lit);
      group.visible = k > 0.05 && level > 0.3;
      (moon.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 * k;
      (halo.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 * k * lit;
    },
    dispose() { quad.dispose(); disc.dispose(); glow.dispose(); [moon, halo].forEach(m => (m.material as THREE.Material).dispose()); },
  };
}
