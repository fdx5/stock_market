/// <reference lib="webworker" />
/* Display painter off the main thread. The 3D loop never waits for a 2D canvas: the main thread
 * sends data once per change and small paint requests; this worker draws into OffscreenCanvases
 * (one per pixel size) and returns each picture as a transferred ImageBitmap (zero copy). */
import { PAINTERS, type G, type PaintEnv } from "./panels";
import { companyLogo, type ExchangeMarket, type FloorSnapshot, type Language } from "./marketCore";

type Init = { type: "init"; base: string; faces: [string, string, string][] };
type Data = { type: "data"; snapshot: FloorSnapshot; series: Record<string, number[]>; lang: Language };
type Paint = { type: "paint"; id: string; token: number; w: number; h: number; pxW: number; pxH: number;
  page: number; prev: number; t: number; now: number };
export type WorkerIn = Init | Data | Paint;
export type WorkerOut = { type: "ready" } | { type: "logo" }
  | { type: "done"; id: string; token: number; bitmap: ImageBitmap | null; ms: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let snapshot: FloorSnapshot | undefined;
let series: Record<string, number[]> = {};
let lang: Language = "ko";
const canvases = new Map<string, { canvas: OffscreenCanvas; g: G }>();
const logos = new Map<string, ImageBitmap | null | "loading">();

function surface(pxW: number, pxH: number) {
  const key = pxW + "x" + pxH;
  let entry = canvases.get(key);
  if (!entry) {
    const canvas = new OffscreenCanvas(pxW, pxH);
    const g = canvas.getContext("2d", { alpha: false }) as unknown as G | null;
    if (!g) return undefined;
    entry = { canvas, g };
    canvases.set(key, entry);
  }
  return entry;
}

function logo(g: G, market: ExchangeMarket, code: string, x: number, y: number, size: number) {
  const url = companyLogo(market, code);
  const img = logos.get(url);
  g.save();
  g.beginPath();
  g.roundRect(x, y, size, size, size * .24);
  g.fillStyle = "#f4f6fa";
  g.fill();
  if (img && img !== "loading") {
    g.clip();
    const s = size * .82 / Math.max(img.width, img.height);
    g.drawImage(img, x + (size - img.width * s) / 2, y + (size - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    g.fillStyle = "#1d2433";
    g.fill();
    g.fillStyle = "#cfe0ff";
    g.font = `800 ${size * .38}px "IBM Plex Sans Condensed", sans-serif`;
    g.textAlign = "center";
    g.fillText(code.slice(0, 2), x + size / 2, y + size * .64);
    g.textAlign = "left";
  }
  g.restore();
  if (img !== undefined || logos.size > 160) return;
  logos.set(url, "loading");
  void fetch(url, { mode: "cors", credentials: "omit" })
    .then(r => r.ok ? r.blob() : Promise.reject(new Error(String(r.status))))
    .then(blob => createImageBitmap(blob))
    .then(bitmap => { logos.set(url, bitmap); scope.postMessage({ type: "logo" } satisfies WorkerOut); })
    .catch(() => logos.set(url, null));
}

scope.onmessage = async (event: MessageEvent<WorkerIn>) => {
  const msg = event.data;
  if (msg.type === "init") {
    const fonts = (scope as unknown as { fonts?: FontFaceSet }).fonts;
    await Promise.allSettled(msg.faces.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(${msg.base}${file})`, { weight, display: "block" });
      fonts?.add(await face.load());
    }));
    scope.postMessage({ type: "ready" } satisfies WorkerOut);
    return;
  }
  if (msg.type === "data") { snapshot = msg.snapshot; series = msg.series; lang = msg.lang; return; }
  const painter = PAINTERS[msg.id];
  const entry = surface(msg.pxW, msg.pxH);
  if (!painter || !entry || !snapshot) {
    scope.postMessage({ type: "done", id: msg.id, token: msg.token, bitmap: null, ms: 0 } satisfies WorkerOut);
    return;
  }
  const { canvas, g } = entry;
  const start = performance.now();
  g.setTransform(msg.pxH / msg.h, 0, 0, msg.pxH / msg.h, 0, 0);
  g.fillStyle = "#000";
  g.fillRect(0, 0, msg.w, msg.h);
  const env: PaintEnv = { lang, series, now: msg.now, cycle: 0, logo, page: msg.page, prev: msg.prev, t: msg.t };
  try { painter(g, msg.w, msg.h, snapshot, env); } catch (error) { console.warn("[exchange worker] panel", msg.id, error); }
  const bitmap = canvas.transferToImageBitmap();
  scope.postMessage({ type: "done", id: msg.id, token: msg.token, bitmap, ms: Math.round((performance.now() - start) * 10) / 10 } satisfies WorkerOut, [bitmap]);
};
