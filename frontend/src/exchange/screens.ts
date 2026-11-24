/* Every display on the floor as GPU meshes: one merged mesh and one canvas texture per panel.
 *
 * Screens read as OLED glass: the panel image drives the emissive channel of a near-black,
 * glossy material, so the room's environment reflects off the glass while the content glows.
 * Repaints are queued and spread over frames so a data refresh never stalls the render loop.
 *
 * Memory and frame pacing (phones froze on v3): panels paint into a few shared scratch canvases
 * (one per pixel size) instead of 53 resident canvases. Where OffscreenCanvas exists the finished
 * picture leaves by transferToImageBitmap — a zero-copy hand-off, where createImageBitmap(canvas)
 * forced a GPU→CPU readback of the 2D canvas on the main thread. Each snapshot bitmap is closed as
 * soon as the GPU has it, and finished bitmaps go to the GPU at a fixed number per frame.
 *
 * Turning used to hitch: three.js uploads a changed texture only when its mesh is next drawn, so
 * every panel refreshed behind the camera uploaded (with mips) in the frame it swung into view.
 * Uploads are now pushed immediately through `upload` (renderer.initTexture), visible panels paint
 * first, and panels out of view keep refreshing in the background at a low, steady rate. */
import {
  BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry, Group, LinearMipmapLinearFilter, LinearFilter, Mesh, MeshStandardMaterial,
  PlaneGeometry, RepeatWrapping, SRGBColorSpace, Sphere, Texture, Vector3, type Frustum, type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial, type UniformNode } from "three/webgpu";
import { texture as textureNode, uniform, uv, vec2 } from "three/tsl";
import { FLOOR, companyLogo, shortTime, type ExchangeMarket, type FloorSnapshot, type Language } from "./market";
import {
  LIVE_PANELS, OUTER_TICKER_ATLAS, PAGES, PAINTERS, paintColumn, paintOuterTicker, paintTicker, setTickerLogoListener,
  tickerEntries, type G, type PaintEnv, type TickerStyle,
} from "./panels";
import type { WorkerIn, WorkerOut } from "./paintWorker";

type Screen = (typeof FLOOR.screens)[number] & { r?: number; a0?: number; a1?: number };

/** A curved screen on a circle around the atrium's centre, facing the centre (kinds arc and band).
 * u runs left to right as seen from the centre (increasing angle runs to the viewer's left). */
function arcGeometry(s: Screen) {
  const r = s.r ?? 1, a0 = (s.a0 ?? 0) * Math.PI / 180, a1 = (s.a1 ?? 0) * Math.PI / 180;
  const n = Math.max(8, Math.ceil(r * (a1 - a0) / .25));
  const pos = new Float32Array((n + 1) * 2 * 3), nor = new Float32Array((n + 1) * 2 * 3), uvs = new Float32Array((n + 1) * 2 * 2);
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + (a1 - a0) * i / n, sx = Math.sin(t), cz = Math.cos(t);
    for (let k = 0; k < 2; k++) {
      const v = i * 2 + k;
      pos.set([r * sx, s.y + (k ? s.h / 2 : -s.h / 2), r * cz], v * 3);
      nor.set([-sx, 0, -cz], v * 3);
      uvs.set([1 - i / n, k], v * 2);
    }
    if (i < n) {
      const b = i * 2, nb = b + 2;
      idx.push(b, nb + 1, nb, b, b + 1, nb + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("uv", new BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}
const curved = (s: Screen) => s.kind === "arc" || s.kind === "band";
const TICKERS: Record<string, TickerStyle> = { tickerA: "amber", tickerB: "cyan", tickerC: "commodity", tickerD: "news", ring: "ring", tickerV: "column" };
/** The two ends of the mesh must sample the same position at every scroll offset. */
function outerTickerTexture(
  tex: Texture,
  offset: UniformNode<"float", number>,
  count: UniformNode<"float", number>,
  repeats: UniformNode<"float", number>,
) {
  const columns = OUTER_TICKER_ATLAS.columns;
  const band = uv();
  const progress = band.x.add(offset).mul(repeats);
  const slot = progress.fract().mul(count);
  const row = slot.div(columns).floor();
  const rowCount = count.div(columns).ceil();
  const atlasUvs = vec2(slot.mod(columns).div(columns), row.add(band.y.oneMinus()).div(rowCount));
  // Derive mip gradients before wrapping at the ring seam and moving between atlas rows.
  const continuous = vec2(progress.mul(count).div(columns), band.y.negate().div(rowCount));
  return textureNode(tex, atlasUvs).grad(continuous.dFdx(), continuous.dFdy());
}

/** Texture width at full quality, and the aspect a panel is designed for (720 design units tall). */
function panelSpec(id: string, instances: Screen[]) {
  const primary = instances.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
  const aspect = primary.w / primary.h;
  // Balanced Retina-sharp screen widths: cuts live texture upload + WebGPU mipmap bandwidth by ~55% with zero visible softness.
  const width = id === "overview" ? 2560 : ["treemap", "world", "heatgrid", "news"].includes(id) ? 1600
    : id === "sign" ? 2560 : ["clocks", "session"].includes(id) ? 1920 : /^s\d/.test(id) ? 960 : 1280;
  return { aspect, width };
}

const FONT_BASE = "/3d/exchange-floor/fonts/";
const FONT_FACES: [string, string, string][] = [
      ["Pretendard Variable", "PretendardVariable.woff2", "45 920"],
      ["IBM Plex Sans Condensed", "IBMPlexSansCondensed-500.woff2", "500"],
      ["IBM Plex Sans Condensed", "IBMPlexSansCondensed-600.woff2", "600"],
      ["IBM Plex Sans Condensed", "IBMPlexSansCondensed-700.woff2", "700"],
      ["IBM Plex Mono", "IBMPlexMono-500.woff2", "500"],
      ["IBM Plex Mono", "IBMPlexMono-600.woff2", "600 700"],
      ["Doto", "Doto.woff2", "100 900"],
      ["Big Shoulders Display", "BigShouldersDisplay.woff2", "100 900"],
];
const fontsReady = (() => {
  let promise: Promise<void> | undefined;
  return () => promise ??= (async () => {
    await Promise.allSettled(FONT_FACES.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(${FONT_BASE}${file})`, { weight, display: "block" });
      document.fonts.add(await face.load());
    }));
  })();
})();
export const loadDisplayFonts = fontsReady;

const UPLOAD = new URLSearchParams(location.search).get("tex") ?? "bitmap";
const isBitmap = (image: unknown): image is ImageBitmap => typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
/** Paint in a worker unless the browser lacks OffscreenCanvas transfer, or ?paint=main asks otherwise. */
const WORKER_OK = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined"
  && typeof OffscreenCanvas.prototype.transferToImageBitmap === "function"
  && new URLSearchParams(location.search).get("paint") !== "main" && UPLOAD === "bitmap";

type Panel = {
  tex: Texture; w: number; h: number; scale: number; pxW: number; pxH: number;
  /** Own canvas only in ?tex=cpu mode; otherwise panels share scratch canvases. */
  canvas?: HTMLCanvasElement; g?: G;
  spheres: Sphere[]; visible: boolean; token: number;
};

/** lite: touch/iPad devices — lighter paint budget, single-repaint page flips; disableWorker: avoids Safari OffscreenCanvas OOM. */
export function createScreens(quality: number, lite = false, upload?: (texture: Texture) => void, disableWorker = false) {
  const group = new Group();
  const targets: Mesh[] = [];
  const panels = new Map<string, Panel>();
  const scratch = new Map<string, { canvas: HTMLCanvasElement | OffscreenCanvas; g: G }>();
  const offscreen = !disableWorker && typeof OffscreenCanvas !== "undefined" && typeof OffscreenCanvas.prototype.transferToImageBitmap === "function";
  /** Finished snapshots waiting for their GPU upload; newest wins per panel. */
  const pending = new Map<string, ImageBitmap>();
  // During initial loading overlay (bootMode=true), burst-flush visible boards in ~4 frames (~65ms) instead of 2.5s!
  // Once revealed (bootMode=false), strictly 1 GPU upload per frame preserves locked 60 FPS with zero frame drops.
  let bootMode = true;
  let uploadFn = upload;
  const uploadsPerFrame = () => (bootMode ? (lite ? 4 : 8) : 1);
  const maxInflight = () => (bootMode ? (lite ? 4 : 6) : (lite ? 2 : 3));
  const paintBudget = () => (bootMode ? 12 : (lite ? 2.5 : 3.5));
  const BACKGROUND_EVERY = lite ? 280 : 160;
  // Worker painting: the main thread only posts requests and uploads finished bitmaps.
  let worker: Worker | undefined;
  let workerReady: Promise<void> = Promise.resolve();
  let workerTimer = 0, finishWorkerStart = () => {};
  let inflight = 0;
  const stopWorker = () => {
    worker?.terminate();
    worker = undefined;
    inflight = 0;
    clearTimeout(workerTimer);
    finishWorkerStart();
  };
  if (WORKER_OK && !disableWorker) {
    try {
      worker = new Worker(new URL("./paintWorker.ts", import.meta.url), { type: "module" });
      workerReady = new Promise<void>(resolve => {
        finishWorkerStart = resolve;
        workerTimer = window.setTimeout(stopWorker, 2800);
      });
      worker.onmessage = (event: MessageEvent<WorkerOut>) => {
        const msg = event.data;
        if (msg.type === "ready") { clearTimeout(workerTimer); finishWorkerStart(); return; }
        if (msg.type === "logo") {
          if (active) for (const id of panels.keys()) if (/^s\d|leaders|gainers|laggards|movers|heatgrid/.test(id)) dirty.add(id);
          return;
        }
        if (msg.type !== "done") return;
        inflight = Math.max(0, inflight - 1);
        paintMs[msg.id] = msg.ms;
        const panel = panels.get(msg.id);
        if (!msg.bitmap) {
          stopWorker();
          if (active) for (const id of panels.keys()) dirty.add(id);
          return;
        }
        if (!active || !panel || msg.token !== panel.token) { msg.bitmap.close(); return; }
        pending.get(msg.id)?.close();
        pending.set(msg.id, msg.bitmap);
      };
      worker.onerror = () => { stopWorker(); if (active) for (const id of panels.keys()) dirty.add(id); };
      worker.postMessage({ type: "init", base: FONT_BASE, faces: FONT_FACES } satisfies WorkerIn);
    } catch { stopWorker(); }
  }
  let lastBackground = 0, signature = "";
  /** Page counts per list panel, computed once per snapshot rather than (with a sort) every frame. */
  const pageCounts = new Map<string, number>();
  const tickers = new Map<string, { canvas: HTMLCanvasElement; tex: Texture; width: number; meshes: Mesh[]; offset: { value: number } }>();
  const outerTickerCanvas = offscreen ? new OffscreenCanvas(1, 1) : undefined;
  const outerCount = uniform(1);
  const outerRepeats = uniform(1);
  let outerSignature = "", outerPaint = 0;
  /** Page flips for list panels: page index, the page it left, when the flip started, and last slide paint time. */
  const pagers = new Map<string, { page: number; prev: number; at: number; next: number; lastSlide: number }>();
  const materials: Material[] = [];
  const logos = new Map<string, HTMLImageElement | null>();
  const dirty = new Set<string>();
  let snapshot: FloorSnapshot | undefined;
  let series: Record<string, number[]> = {};
  let lang: Language = "ko";
  let active = true;
  let lastSecond = 0;
  let lastSessionTick = 0;
  const paintMs: Record<string, number> = {};

  const byPanel = new Map<string, Screen[]>();
  for (const s of FLOOR.screens) byPanel.set(s.id, [...(byPanel.get(s.id) ?? []), s]);

  function glass(map: Texture, intensity = 1) {
    // Glossy glass, but the reflection stays well under the picture: visible, never washing it out.
    const m = new MeshStandardMaterial({ color: 0x000000, roughness: .11, metalness: 0, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: intensity });
    m.envMapIntensity = .36;
    materials.push(m);
    return m;
  }

  function place(geometry: BufferGeometry, s: Screen) {
    const mesh = new Mesh(geometry);
    // Sit 1 cm proud of the plane the housing was modelled around, so no bezel can cover the glass.
    geometry.translate(0, 0, .01);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.set((s.tilt ?? 0) * Math.PI / 180, s.yaw * Math.PI / 180, 0, "YXZ");
    mesh.updateMatrixWorld(true);
    return geometry.applyMatrix4(mesh.matrixWorld);
  }

  for (const [id, instances] of byPanel) {
    if (id in TICKERS) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 128;
      // No image until the first paint: a canvas without a 2D context cannot be uploaded (Chrome
      // warns and skips it), so the GPU holds a placeholder until the strip has text.
      const vertical = TICKERS[id] === "column";
      const tex = new Texture();
      tex.colorSpace = SRGBColorSpace;
      if (id === "tickerA") tex.flipY = false;
      else tex.wrapS = RepeatWrapping;
      if (vertical) tex.wrapT = RepeatWrapping;
      tex.anisotropy = 4;
      // Scroll in the shader: a uniform offset, so moving text costs no texture upload at all.
      const offset = uniform(0);
      const mat = new MeshStandardNodeMaterial({ color: 0x000000, roughness: .12, metalness: 0 });
      mat.envMapIntensity = .3;
      mat.emissiveNode = id === "tickerA" ? outerTickerTexture(tex, offset, outerCount, outerRepeats).rgb.mul(1.25)
        : textureNode(tex, uv().add(vertical ? vec2(0, offset) : vec2(offset, 0))).rgb.mul(1.1);
      materials.push(mat);
      const meshes = instances.map(s => {
        let geometry: BufferGeometry;
        if (id === "ring") {
          geometry = new CylinderGeometry(s.w, s.w, s.h, 96, 1, true);
          geometry.translate(s.x, s.y, s.z);
        } else if (curved(s)) geometry = arcGeometry(s);
        else geometry = place(new PlaneGeometry(s.w, s.h), s);
        const mesh = new Mesh(geometry, mat);
        mesh.userData.ticker = vertical ? { length: s.h, height: s.w, vertical: true, phase: (instances.indexOf(s) * .137) % 1 }
          : { length: id === "ring" ? 2 * Math.PI * s.w : s.w, height: s.h };
        group.add(mesh);
        return mesh;
      });
      tex.userData.width = canvas.width;
      const width = id === "tickerA" ? instances[0].w / instances[0].h * OUTER_TICKER_ATLAS.slotHeight : 1024;
      tickers.set(id, { canvas, tex, width, meshes, offset });
      continue;
    }
    const painter = PAINTERS[id];
    if (!painter) continue;
    const spec = panelSpec(id, instances);
    const w = 720 * spec.aspect, h = 720;
    const pxW = Math.round(spec.width * quality), pxH = Math.round(pxW / spec.aspect);
    let canvas: HTMLCanvasElement | undefined, g: G | undefined;
    if (UPLOAD === "cpu") {
      canvas = Object.assign(document.createElement("canvas"), { width: pxW, height: pxH });
      g = canvas.getContext("2d", { alpha: false, willReadFrequently: true }) ?? undefined;
      if (!g) continue;
    }
    // Bitmap mode: version 0 keeps a placeholder on the GPU until the first snapshot lands.
    const tex = canvas ? new CanvasTexture(canvas) : new Texture();
    tex.colorSpace = SRGBColorSpace;
    // On mobile/iPad, skip mipmaps on smaller stock cards to save ~33% GPU VRAM!
    const useMips = !lite || !/^s\d/.test(id);
    tex.generateMipmaps = useMips;
    tex.minFilter = useMips ? LinearMipmapLinearFilter : LinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = lite ? 2 : 4;
    const parts = instances.map(s => {
      const geometry = curved(s) ? arcGeometry(s) : new PlaneGeometry(s.w, s.h);
      // Crop rather than stretch when an instance's aspect differs from the panel's design.
      const a = s.w / s.h;
      const uv = geometry.getAttribute("uv");
      // Most screens crop a little to fill (same design, slightly different shape). The core tower
      // facets carry boards designed for much wider screens: fit those whole (black bars, which match
      // the panel's black ground) so no figure is cut off at the facet edge.
      const fit = s.kind === "facet";
      const su = fit ? (a > spec.aspect ? a / spec.aspect : 1) : (a < spec.aspect ? a / spec.aspect : 1);
      const sv = fit ? (a < spec.aspect ? spec.aspect / a : 1) : (a > spec.aspect ? spec.aspect / a : 1);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, .5 + (uv.getX(i) - .5) * su, .5 + (uv.getY(i) - .5) * sv);
      return curved(s) ? geometry : place(geometry, s);
    });
    const merged = mergeGeometries(parts);
    parts.forEach(p => p.dispose());
    if (!merged) continue;
    const mesh = new Mesh(merged, glass(tex, id === "sign" ? 1.4 : 1));
    mesh.userData.panel = id;
    group.add(mesh);
    if (id !== "sign") targets.push(mesh);
    const spheres = instances.flatMap(s => {
      if (!curved(s)) return [new Sphere(new Vector3(s.x, s.y, s.z), Math.hypot(s.w, s.h) * .65 + .5)];
      const parts = Math.max(1, Math.ceil(s.w / 6)), r = s.r ?? 1, a0 = s.a0 ?? 0, a1 = s.a1 ?? 0;
      return Array.from({ length: parts }, (_, k) => {
        const t = (a0 + (a1 - a0) * (k + .5) / parts) * Math.PI / 180;
        return new Sphere(new Vector3(r * Math.sin(t), s.y, r * Math.cos(t)), Math.hypot(s.w / parts, s.h) * .65 + .5);
      });
    });
    panels.set(id, { canvas, g, tex, w, h, scale: pxH / 720, pxW, pxH, spheres, visible: true, token: 0 });
  }

  function surface(panel: Panel) {
    if (panel.g) return panel.g;
    // Reuse a SINGLE shared scratch canvas (never retain 18 separate multi-MB canvases on iPad/Safari!)
    const key = "shared";
    let entry = scratch.get(key);
    if (!entry) {
      const canvas = offscreen ? new OffscreenCanvas(panel.pxW, panel.pxH)
        : Object.assign(document.createElement("canvas"), { width: panel.pxW, height: panel.pxH });
      // Painters share one 2D API; OffscreenCanvasRenderingContext2D covers everything they call.
      const g = canvas.getContext("2d", { alpha: false }) as G | null;
      if (!g) return undefined;
      entry = { canvas, g };
      scratch.set(key, entry);
    } else if (entry.canvas.width !== panel.pxW || entry.canvas.height !== panel.pxH) {
      entry.canvas.width = panel.pxW;
      entry.canvas.height = panel.pxH;
    }
    return entry.g;
  }
  /** The GPU has the pixels: release the bitmap memory right away. */
  const releaseOnUpload = (tex: Texture) => {
    const image = tex.image as unknown;
    if (isBitmap(image)) image.close();
  };

  const logo = (g: G, market: ExchangeMarket, code: string, x: number, y: number, size: number) => {
    const url = companyLogo(market, code);
    const img = logos.get(url);
    g.save();
    g.beginPath();
    g.roundRect(x, y, size, size, size * .24);
    g.fillStyle = "#f4f6fa";
    g.fill();
    if (img?.complete && img.naturalWidth > 0) {
      g.clip();
      const s = size * .82 / Math.max(img.naturalWidth, img.naturalHeight);
      g.drawImage(img, x + (size - img.naturalWidth * s) / 2, y + (size - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
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
    const asset = new Image();
    asset.crossOrigin = "anonymous";
    asset.decoding = "async";
    logos.set(url, asset);
    asset.onload = () => { if (active) for (const id of panels.keys()) if (/^s\d|leaders|gainers|laggards|movers|heatgrid/.test(id)) dirty.add(id); };
    asset.onerror = () => { logos.set(url, null); };
    asset.src = url;
  };

  function paint(id: string, now: number) {
    const panel = panels.get(id);
    if (!panel || !snapshot) return;
    if (worker) {
      const pager = pagers.get(id);
      const t = pager && !lite ? Math.min(1, (performance.now() - pager.at) / 650) : 1;
      inflight++;
      worker.postMessage({ type: "paint", id, token: ++panel.token, w: panel.w, h: panel.h, pxW: panel.pxW, pxH: panel.pxH,
        page: pager?.page ?? 0, prev: pager?.prev ?? 0, t, now } satisfies WorkerIn);
      return;
    }
    const g = surface(panel);
    if (!g) return;
    const { w, h, scale } = panel;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    if (!panel.canvas) { g.fillStyle = "#000"; g.fillRect(0, 0, w, h); }   // shared canvas: no leftovers
    const pager = pagers.get(id);
    const t = pager && !lite ? Math.min(1, (performance.now() - pager.at) / 650) : 1;
    const env: PaintEnv = { lang, series, now, cycle: 0, logo, page: pager?.page ?? 0, prev: pager?.prev ?? 0, t };
    const start = performance.now();
    try { PAINTERS[id](g, w, h, snapshot, env); } catch (error) { console.warn("[exchange] panel", id, error); }
    paintMs[id] = Math.round((performance.now() - start) * 10) / 10;
    if (panel.canvas) { panel.tex.needsUpdate = true; return; }
    // Snapshot now (the shared canvas is reused by the next paint); the upload waits for flush().
    const token = ++panel.token;
    const source = g.canvas as HTMLCanvasElement | OffscreenCanvas;
    const queue = (bitmap: ImageBitmap) => {
      if (!active || token !== panel.token) { bitmap.close(); return; }
      pending.get(id)?.close();
      pending.set(id, bitmap);
    };
    // On older WebKit, upload the shared 2D surface directly when snapshots are unavailable.
    if (source instanceof HTMLCanvasElement) {
      if (typeof createImageBitmap === "function") void createImageBitmap(source).then(queue).catch(() => {});
      else {
        panel.tex.image = source;
        panel.tex.needsUpdate = true;
        uploadFn?.(panel.tex);
      }
    } else queue(source.transferToImageBitmap());
  }

  /** Hand finished snapshots to the GPU (burst during boot overlay, strictly 1/frame after reveal for 60 FPS). */
  function flush() {
    const limit = uploadsPerFrame();
    let n = 0;
    for (const [id, bitmap] of pending) {
      if (n >= limit) break;
      const panel = panels.get(id);
      pending.delete(id);
      if (!panel) { bitmap.close(); continue; }
      // A previous snapshot never uploaded (panel culled since): drop it instead of leaking it.
      const old = panel.tex.image as unknown;
      if (isBitmap(old) && old !== bitmap) old.close();
      panel.tex.image = bitmap;
      panel.tex.onUpdate = releaseOnUpload;
      panel.tex.needsUpdate = true;
      uploadFn?.(panel.tex);   // now, not when the panel next enters the view
      n++;
    }
  }

  // Logos arrive one by one: repaint the strips once they settle (at most every 1.2 s).
  let logoTimer = 0;
  setTickerLogoListener(() => {
    if (!active || logoTimer) return;
    logoTimer = window.setTimeout(() => { logoTimer = 0; if (active) paintTickers(true); }, 1200);
  });

  function paintTickers(logosChanged = false) {
    if (!snapshot) return;
    for (const [id, ticker] of tickers) {
      const style = TICKERS[id];
      if (style === "amber") {
        const entries = tickerEntries(style, snapshot, lang);
        const signature = JSON.stringify(entries);
        if (!logosChanged && signature === outerSignature) continue;
        const source = outerTickerCanvas ?? ticker.canvas;
        if (!paintOuterTicker(source, entries)) continue;
        outerSignature = signature;
        const version = ++outerPaint;
        const commit = (image: ImageBitmap | HTMLCanvasElement) => {
          if (!active || version !== outerPaint) {
            if (isBitmap(image)) image.close();
            return;
          }
          const old = ticker.tex.image as ImageBitmap | HTMLCanvasElement | null;
          if (old && old.height !== image.height) ticker.tex.dispose();
          ticker.tex.image = image;
          ticker.tex.needsUpdate = true;
          outerCount.value = entries.length;
          // Repeat a partial feed a whole number of times until the full selection arrives.
          outerRepeats.value = Math.max(1, Math.round(ticker.width / (entries.length * OUTER_TICKER_ATLAS.slotWidth)));
          uploadFn?.(ticker.tex);
          if (isBitmap(old)) setTimeout(() => old.close(), 500);
        };
        if (outerTickerCanvas) commit(outerTickerCanvas.transferToImageBitmap());
        else if (typeof createImageBitmap === "function") void createImageBitmap(ticker.canvas).then(commit).catch(() => commit(ticker.canvas));
        else commit(ticker.canvas);
        continue;
      }
      const width = style === "column" ? paintColumn(ticker.canvas, snapshot, lang) : paintTicker(ticker.canvas, style, snapshot, lang);
      if (!width) continue;
      ticker.width = width;
      // Repeat the strip along each mesh at its natural pixel aspect.
      for (const mesh of ticker.meshes) {
        const { length, height, vertical: up, phase = 0 } = mesh.userData.ticker as { length: number; height: number; vertical?: boolean; phase?: number };
        const uv = mesh.geometry.getAttribute("uv");
        if (up) {
          // Column strips: the card stack runs along v; each column starts at its own phase.
          const repeat = length / height * ticker.canvas.width / width;
          if (!mesh.userData.baseV) mesh.userData.baseV = Float32Array.from({ length: uv.count }, (_, i) => uv.getY(i));
          const base = mesh.userData.baseV as Float32Array;
          for (let i = 0; i < uv.count; i++) uv.setY(i, base[i] * repeat + phase);
          uv.needsUpdate = true;
          continue;
        }
        const repeat = length / height * 128 / width;
        if (!mesh.userData.baseU) mesh.userData.baseU = Float32Array.from({ length: uv.count }, (_, i) => uv.getX(i));
        const base = mesh.userData.baseU as Float32Array;
        for (let i = 0; i < uv.count; i++) uv.setX(i, base[i] * repeat);
        uv.needsUpdate = true;
      }
      // Same-size repaints reuse the GPU texture; only a size change reallocates it. The upload goes
      // through an async ImageBitmap so the frame never waits on the 2D canvas.
      const version = (ticker.tex.userData.paintVersion ?? 0) + 1;
      ticker.tex.userData.paintVersion = version;
      const commit = (image: ImageBitmap | HTMLCanvasElement) => {
        if (!active || version !== ticker.tex.userData.paintVersion) { if (isBitmap(image)) image.close(); return; }
        const old = ticker.tex.image as ImageBitmap | HTMLCanvasElement | null;
        if (ticker.tex.userData.width !== width) ticker.tex.dispose();
        ticker.tex.userData.width = width;
        ticker.tex.image = image;
        ticker.tex.needsUpdate = true;
        uploadFn?.(ticker.tex);
        if (isBitmap(old)) setTimeout(() => old.close(), 500);
      };
      if (typeof createImageBitmap === "function") void createImageBitmap(ticker.canvas).then(commit).catch(() => commit(ticker.canvas));
      else commit(ticker.canvas);
    }
  }

  return {
    group, targets,
    /** Attach GPU upload hook once WebGPURenderer has initialized (allows worker & painting to start at t=0ms!). */
    setUpload(fn: (texture: Texture) => void) { uploadFn = fn; },
    /** Toggle high-speed burst flushing during loading screen vs locked 1-upload/frame 60 FPS mode after reveal. */
    setBootMode(on: boolean) { bootMode = on; },
    /** When the offscreen paint worker is active, don't block 3D reveal on main-thread 2MB font download! */
    ready: () => (worker ? workerReady : fontsReady()).then(() => undefined),
    /** Pre-kick visible panel paints while GLB is still downloading (zero GPU calls, pure worker parallelism!). */
    prewarm(limit = 16) {
      if (!snapshot || !worker) return;
      let sent = 0;
      for (const id of dirty) {
        if (inflight >= maxInflight() || sent >= limit) break;
        dirty.delete(id);
        paint(id, Date.now());
        sent++;
      }
    },
    /** Every visible display has its first picture on the GPU (or nothing is left to paint). */
    settled: () => !!snapshot && pending.size === 0 && inflight === 0
      && ![...dirty].some(id => panels.get(id)?.visible !== false),
    painting: () => !!worker,
    update(next: FloorSnapshot, nextSeries: Record<string, number[]>, language: Language) {
      // Polls return the same data most of the time (always, outside market hours): repaint only
      // when something a display shows has changed. The header stamp counts at display precision.
      const nextSignature = language + "|" + JSON.stringify(next, (key, value) => key === "received" ? shortTime(value) : value)
        + "|" + Object.entries(nextSeries).map(([k, v]) => k + ":" + v.length + ":" + v[v.length - 1]).join(",");
      snapshot = next; series = nextSeries; lang = language;
      if (nextSignature === signature) return;
      signature = nextSignature;
      worker?.postMessage({ type: "data", snapshot: next, series: nextSeries, lang: language } satisfies WorkerIn);
      pageCounts.clear();
      for (const id of panels.keys()) {
        pageCounts.set(id, PAGES[id]?.(next) ?? 1);
        dirty.add(id);
      }
      paintTickers();
    },
    /** Called once per frame: scrolls tickers, ticks clocks and repaints what the camera can see. */
    tick(now: number, reduced: boolean, frustum?: Frustum) {
      if (frustum) for (const panel of panels.values()) panel.visible = panel.spheres.some(s => frustum.intersectsSphere(s));
      flush();
      if (!reduced) for (const [id, ticker] of tickers) {
        const speed = id === "ring" ? 85 : id === "tickerD" ? 120 : id === "tickerV" ? -70 : 150;   // px/s along the strip (columns rise)
        ticker.offset.value = (now / 1000 * speed / ticker.width) % 1;
      }
      // Page flips: staggered per panel; pace desktop slide at ~9Hz (~5 smooth steps) instead of 60Hz mipmap upload storms!
      if (snapshot && !reduced) {
        let i = 0;
        for (const id of panels.keys()) {
          const pages = pageCounts.get(id) ?? 1;
          i++;
          if (pages < 2) continue;
          let pager = pagers.get(id);
          if (!pager) { pager = { page: 0, prev: 0, at: -1e9, next: now + 7000 + i * 1450, lastSlide: -1e9 }; pagers.set(id, pager); }
          if (now >= pager.next) {
            pager.prev = pager.page % pages;
            pager.page = (pager.page + 1) % pages;
            pager.at = now;
            pager.lastSlide = now;
            pager.next = now + 9000;
            dirty.add(id);
            continue;
          }
          if (!lite && panels.get(id)?.visible) {
            const elapsed = now - pager.at;
            if (elapsed > 0 && elapsed < 760 && now - pager.lastSlide >= 115) {
              pager.lastSlide = now;
              dirty.add(id);
            }
          }
        }
      }
      const second = Math.floor(now / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        if (LIVE_PANELS.has("clocks") && panels.get("clocks")?.visible !== false) dirty.add("clocks");
      }
      // Stagger session board onto half-second offset every 2s so clocks & session NEVER compete in the same frame!
      const sessionBucket = Math.floor((now + 500) / 2000);
      if (sessionBucket !== lastSessionTick) {
        lastSessionTick = sessionBucket;
        if (LIVE_PANELS.has("session") && panels.get("session")?.visible !== false) dirty.add("session");
      }
      // Time-boxed: visible panels first — one always, more only while the frame has headroom.
      const start = performance.now();
      const capInflight = maxInflight();
      const capUpload = uploadsPerFrame();
      const capBudget = paintBudget();
      let hidden: string | undefined;
      for (const id of dirty) {
        if (panels.get(id)?.visible === false) { hidden ??= id; continue; }
        if (worker && inflight >= capInflight) return;
        dirty.delete(id);
        paint(id, Date.now());
        if (!worker && performance.now() - start > capBudget) return;
        if (pending.size >= capUpload * 3) return;
      }
      if (worker && inflight >= capInflight) return;
      // Nothing visible left to do: refresh one panel behind the camera, so turning finds it current.
      if (hidden && now - lastBackground >= BACKGROUND_EVERY && pending.size < capUpload) {
        lastBackground = now;
        dirty.delete(hidden);
        paint(hidden, Date.now());
      }
    },
    paintMs,
    dispose() {
      active = false;
      stopWorker();
      setTickerLogoListener(undefined);
      clearTimeout(logoTimer);
      for (const img of logos.values()) if (img) img.onload = img.onerror = null;
      group.traverse(child => { if (child instanceof Mesh) child.geometry.dispose(); });
      for (const p of panels.values()) {
        releaseOnUpload(p.tex);
        p.tex.dispose();
        if (p.canvas) p.canvas.width = p.canvas.height = 0;
      }
      for (const b of pending.values()) b.close();
      pending.clear();
      for (const s of scratch.values()) s.canvas.width = s.canvas.height = 0;
      if (outerTickerCanvas) outerTickerCanvas.width = outerTickerCanvas.height = 0;
      for (const tk of tickers.values()) {
        releaseOnUpload(tk.tex);
        tk.tex.dispose();
        tk.canvas.width = tk.canvas.height = 0;
      }
      materials.forEach(m => m.dispose());
    },
  };
}
