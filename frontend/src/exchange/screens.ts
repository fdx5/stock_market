/* Every display on the floor as GPU meshes: one merged mesh and one canvas texture per panel.
 *
 * Screens read as OLED glass: the panel image drives the emissive channel of a near-black,
 * glossy material, so the room's environment reflects off the glass while the content glows.
 * Repaints are queued and spread over frames so a data refresh never stalls the render loop. */
import {
  BufferGeometry, CanvasTexture, CylinderGeometry, Group, LinearMipmapLinearFilter, LinearFilter, Mesh, MeshStandardMaterial,
  PlaneGeometry, RepeatWrapping, SRGBColorSpace, type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { texture as textureNode, uniform, uv, vec2 } from "three/tsl";
import { FLOOR, companyLogo, type ExchangeMarket, type FloorSnapshot, type Language } from "./market";
import { LIVE_PANELS, PAGES, PAINTERS, paintTicker, type G, type PaintEnv, type TickerStyle } from "./panels";

type Screen = (typeof FLOOR.screens)[number];
const TICKERS: Record<string, TickerStyle> = { tickerA: "amber", tickerB: "cyan", tickerC: "commodity", tickerD: "news", ring: "ring" };
/** Texture width at full quality, and the aspect a panel is designed for (720 design units tall). */
function panelSpec(id: string, instances: Screen[]) {
  const primary = instances.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
  const aspect = primary.w / primary.h;
  const width = id === "overview" ? 3840 : ["treemap", "world", "heatgrid", "news"].includes(id) ? 2048
    : id === "sign" ? 4096 : ["clocks", "session"].includes(id) ? 3200 : /^s\d/.test(id) ? 1152 : 1440;
  return { aspect, width };
}

const fontsReady = (() => {
  let promise: Promise<void> | undefined;
  return () => promise ??= (async () => {
    const base = "/3d/exchange-floor/fonts/";
    const faces: [string, string, string][] = [
      ["Pretendard Variable", "PretendardVariable.woff2", "45 920"],
      ["IBM Plex Sans Condensed", "IBMPlexSansCondensed-500.woff2", "500"],
      ["IBM Plex Sans Condensed", "IBMPlexSansCondensed-600.woff2", "600"],
      ["IBM Plex Sans Condensed", "IBMPlexSansCondensed-700.woff2", "700"],
      ["IBM Plex Mono", "IBMPlexMono-500.woff2", "500"],
      ["IBM Plex Mono", "IBMPlexMono-600.woff2", "600 700"],
      ["Doto", "Doto.woff2", "100 900"],
      ["Big Shoulders Display", "BigShouldersDisplay.woff2", "100 900"],
    ];
    await Promise.allSettled(faces.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(${base}${file})`, { weight, display: "block" });
      document.fonts.add(await face.load());
    }));
  })();
})();
export const loadDisplayFonts = fontsReady;

const UPLOAD = new URLSearchParams(location.search).get("tex") ?? "bitmap";

export function createScreens(quality: number) {
  const group = new Group();
  const targets: Mesh[] = [];
  const panels = new Map<string, { canvas: HTMLCanvasElement; g: G; tex: CanvasTexture; w: number; h: number; scale: number; token?: number }>();
  const tickers = new Map<string, { canvas: HTMLCanvasElement; tex: CanvasTexture; width: number; meshes: Mesh[]; offset: { value: number } }>();
  /** Page flips for list panels: page index, the page it left and when the flip started. */
  const pagers = new Map<string, { page: number; prev: number; at: number; next: number }>();
  const materials: Material[] = [];
  const logos = new Map<string, HTMLImageElement | null>();
  const dirty = new Set<string>();
  let snapshot: FloorSnapshot | undefined;
  let series: Record<string, number[]> = {};
  let lang: Language = "ko";
  let active = true;
  let lastSecond = 0;
  const paintMs: Record<string, number> = {};

  const byPanel = new Map<string, Screen[]>();
  for (const s of FLOOR.screens) byPanel.set(s.id, [...(byPanel.get(s.id) ?? []), s]);

  function glass(map: CanvasTexture, intensity = 1) {
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
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.wrapS = RepeatWrapping;
      tex.anisotropy = 8;
      // Scroll in the shader: a uniform offset, so moving text costs no texture upload at all.
      const offset = uniform(0);
      const mat = new MeshStandardNodeMaterial({ color: 0x000000, roughness: .12, metalness: 0 });
      mat.envMapIntensity = .3;
      mat.emissiveNode = textureNode(tex, uv().add(vec2(offset, 0))).rgb.mul(id === "tickerA" ? 1.25 : 1.1);
      materials.push(mat);
      const meshes = instances.map(s => {
        let geometry: BufferGeometry;
        if (id === "ring") {
          geometry = new CylinderGeometry(s.w, s.w, s.h, 96, 1, true);
          geometry.translate(s.x, s.y, s.z);
        } else geometry = place(new PlaneGeometry(s.w, s.h), s);
        const mesh = new Mesh(geometry, mat);
        mesh.userData.ticker = { length: id === "ring" ? 2 * Math.PI * s.w : s.w, height: s.h };
        group.add(mesh);
        return mesh;
      });
      tex.userData.width = canvas.width;
      tickers.set(id, { canvas, tex, width: 1024, meshes, offset });
      continue;
    }
    const painter = PAINTERS[id];
    if (!painter) continue;
    const spec = panelSpec(id, instances);
    const w = 720 * spec.aspect, h = 720;
    const pxW = Math.round(spec.width * quality), pxH = Math.round(pxW / spec.aspect);
    const canvas = Object.assign(document.createElement("canvas"), { width: pxW, height: pxH });
    const g = canvas.getContext("2d", { alpha: false, willReadFrequently: UPLOAD === "cpu" });
    if (!g) continue;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = 8;
    const parts = instances.map(s => {
      const geometry = new PlaneGeometry(s.w, s.h);
      // Crop rather than stretch when an instance's aspect differs from the panel's design.
      const a = s.w / s.h;
      const uv = geometry.getAttribute("uv");
      const su = a < spec.aspect ? a / spec.aspect : 1, sv = a > spec.aspect ? spec.aspect / a : 1;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, .5 + (uv.getX(i) - .5) * su, .5 + (uv.getY(i) - .5) * sv);
      return place(geometry, s);
    });
    const merged = mergeGeometries(parts);
    parts.forEach(p => p.dispose());
    if (!merged) continue;
    const mesh = new Mesh(merged, glass(tex, id === "sign" ? 1.4 : 1));
    mesh.userData.panel = id;
    group.add(mesh);
    if (id !== "sign") targets.push(mesh);
    panels.set(id, { canvas, g, tex, w, h, scale: pxH / 720 });
  }

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
    const { g, w, h, scale } = panel;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const pager = pagers.get(id);
    const t = pager ? Math.min(1, (performance.now() - pager.at) / 650) : 1;
    const env: PaintEnv = { lang, series, now, cycle: 0, logo, page: pager?.page ?? 0, prev: pager?.prev ?? 0, t };
    const start = performance.now();
    try { PAINTERS[id](g, w, h, snapshot, env); } catch (error) { console.warn("[exchange] panel", id, error); }
    paintMs[id] = Math.round((performance.now() - start) * 10) / 10;
    if (UPLOAD !== "bitmap") { panel.tex.needsUpdate = true; return; }
    // Snapshot the canvas asynchronously, then upload the bitmap: no canvas→GPU sync stall in the frame.
    const token = (panel.token = (panel.token ?? 0) + 1);
    void createImageBitmap(panel.canvas).then(bitmap => {
      if (!active || token !== panel.token) { bitmap.close(); return; }
      const old = panel.tex.image as ImageBitmap | HTMLCanvasElement;
      (panel.tex as { image: unknown }).image = bitmap;
      panel.tex.needsUpdate = true;
      if (old instanceof ImageBitmap) setTimeout(() => old.close(), 500);
    }).catch(() => { panel.tex.needsUpdate = true; });
  }

  function paintTickers() {
    if (!snapshot) return;
    for (const [id, ticker] of tickers) {
      const width = paintTicker(ticker.canvas, TICKERS[id], snapshot, lang);
      if (!width) continue;
      ticker.width = width;
      // Repeat the strip along each mesh at its natural pixel aspect.
      for (const mesh of ticker.meshes) {
        const { length, height } = mesh.userData.ticker as { length: number; height: number };
        const repeat = length / height * 128 / width;
        const uv = mesh.geometry.getAttribute("uv");
        if (!mesh.userData.baseU) mesh.userData.baseU = Float32Array.from({ length: uv.count }, (_, i) => uv.getX(i));
        const base = mesh.userData.baseU as Float32Array;
        for (let i = 0; i < uv.count; i++) uv.setX(i, base[i] * repeat);
        uv.needsUpdate = true;
      }
      // Same-size repaints reuse the GPU texture; only a size change reallocates it. The upload goes
      // through an async ImageBitmap so the frame never waits on the 2D canvas.
      const resized = ticker.tex.userData.width !== width;
      ticker.tex.userData.width = width;
      void createImageBitmap(ticker.canvas).then(bitmap => {
        if (!active) { bitmap.close(); return; }
        const old = ticker.tex.image as ImageBitmap | HTMLCanvasElement;
        if (resized) ticker.tex.dispose();
        (ticker.tex as { image: unknown }).image = bitmap;
        ticker.tex.needsUpdate = true;
        if (old instanceof ImageBitmap) setTimeout(() => old.close(), 500);
      }).catch(() => { if (resized) ticker.tex.dispose(); ticker.tex.needsUpdate = true; });
    }
  }

  return {
    group, targets,
    ready: fontsReady,
    update(next: FloorSnapshot, nextSeries: Record<string, number[]>, language: Language) {
      snapshot = next; series = nextSeries; lang = language;
      for (const id of panels.keys()) dirty.add(id);
      paintTickers();
    },
    /** Called once per frame: scrolls tickers, ticks clocks and drains at most two repaints. */
    tick(now: number, reduced: boolean) {
      if (!reduced) for (const [id, ticker] of tickers) {
        const speed = id === "ring" ? 85 : id === "tickerD" ? 120 : 150;   // px per second on the strip
        ticker.offset.value = (now / 1000 * speed / ticker.width) % 1;
      }
      // Page flips: staggered per panel; while a flip animates, that panel repaints every frame.
      if (snapshot && !reduced) {
        let i = 0;
        for (const id of panels.keys()) {
          const pages = PAGES[id]?.(snapshot) ?? 1;
          i++;
          if (pages < 2) continue;
          let pager = pagers.get(id);
          if (!pager) { pager = { page: 0, prev: 0, at: -1e9, next: now + 6000 + i * 830 }; pagers.set(id, pager); }
          if (now >= pager.next) {
            pager.prev = pager.page % pages;
            pager.page = (pager.page + 1) % pages;
            pager.at = now;
            pager.next = now + 7000;
          }
          if (now - pager.at < 720) dirty.add(id);
        }
      }
      const second = Math.floor(now / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        for (const id of LIVE_PANELS) dirty.add(id);
      }
      // Time-boxed: one panel always, more only while the frame still has headroom.
      const start = performance.now();
      for (const id of dirty) {
        dirty.delete(id);
        paint(id, Date.now());
        if (performance.now() - start > 4) break;
      }
    },
    paintMs,
    dispose() {
      active = false;
      for (const img of logos.values()) if (img) img.onload = img.onerror = null;
      group.traverse(child => { if (child instanceof Mesh) child.geometry.dispose(); });
      for (const p of panels.values()) { p.tex.dispose(); p.canvas.width = p.canvas.height = 0; }
      for (const tk of tickers.values()) tk.tex.dispose();
      materials.forEach(m => m.dispose());
    },
  };
}
