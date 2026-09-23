import * as THREE from "three";

/* Logos, palettes and name labels for the 증시버블 spheres. Everything here is
 * drawn once per company (and redrawn only when its quote changes), then handed to
 * WebGL as a texture — nothing is laid out by the browser per frame. */

const transparentLogoCache = new Map<string, Promise<string>>();
const logoPaletteCache = new Map<string, Promise<[string, string]>>();

/** Knocks a logo's near-white backdrop out to transparency, so it sits on the
 * sphere's frosted medallion rather than as a white square. */
export function transparentLogo(src: string): Promise<string> {
  const cached = transparentLogoCache.get(src);
  if (cached) return cached;
  const request = new Promise<string>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(src);
        const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
        const w = image.naturalWidth * scale;
        const h = image.naturalHeight * scale;
        ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
        const px = ctx.getImageData(0, 0, size, size);
        for (let i = 0; i < px.data.length; i += 4) {
          const r = px.data[i], g = px.data[i + 1], b = px.data[i + 2];
          const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
          if (lo > 232 && hi - lo < 14) px.data[i + 3] = Math.round(px.data[i + 3] * Math.max(0, (252 - lo) / 20));
        }
        ctx.putImageData(px, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(src);
      }
    };
    image.onerror = () => resolve("");
    image.src = src;
  });
  transparentLogoCache.set(src, request);
  return request;
}

/** The logo's dominant hue, as a light and a deep shade — the glass is tinted with it. */
export function logoPalette(src: string, key: string): Promise<[string, string]> {
  const cached = logoPaletteCache.get(key);
  if (cached) return cached;
  const request = transparentLogo(src).then(
    (resolved) =>
      new Promise<[string, string]>((resolve) => {
        if (!resolved) return resolve(["#a9bfd2", "#58748d"]);
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = 40;
            canvas.height = 40;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) throw new Error("no canvas");
            ctx.drawImage(image, 0, 0, 40, 40);
            const data = ctx.getImageData(0, 0, 40, 40).data;
            const bins = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
            let nW = 0, n = 0;
            const c = new THREE.Color();
            const hsl = { h: 0, s: 0, l: 0 };
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] < 70) continue;
              const r = data[i], g = data[i + 1], b = data[i + 2];
              const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
              if (hi > 245 && lo > 232) continue;
              if (hi - lo < 14) {
                const w = data[i + 3] / 255;
                n += ((r + g + b) / 3) * w;
                nW += w;
                continue;
              }
              c.setRGB(r / 255, g / 255, b / 255);
              c.getHSL(hsl);
              const bin = bins[Math.min(17, Math.floor(hsl.h * 18))];
              const w = (data[i + 3] / 255) * (0.35 + hsl.s) * (1 - Math.abs(hsl.l - 0.5) * 0.55);
              bin.w += w;
              bin.r += r * w;
              bin.g += g * w;
              bin.b += b * w;
            }
            const top = bins.reduce((a, b) => (b.w > a.w ? b : a), bins[0]);
            const src = top.w > 1 ? new THREE.Color(top.r / top.w / 255, top.g / top.w / 255, top.b / top.w / 255) : new THREE.Color((nW ? n / nW : 112) / 255, (nW ? n / nW : 112) / 255, (nW ? n / nW : 112) / 255);
            src.getHSL(hsl);
            const sat = top.w > 1 ? Math.min(0.96, Math.max(0.62, hsl.s * 1.06)) : 0.2;
            const light = new THREE.Color().setHSL(hsl.h, sat, 0.55);
            const deep = new THREE.Color().setHSL(hsl.h, Math.min(0.98, sat), 0.28);
            resolve([`#${light.getHexString()}`, `#${deep.getHexString()}`]);
          } catch {
            resolve(["#a9bfd2", "#58748d"]);
          }
        };
        image.onerror = () => resolve(["#a9bfd2", "#58748d"]);
        image.src = resolved;
      })
  );
  logoPaletteCache.set(key, request);
  return request;
}

/** A monogram for a company whose logo will not load. */
export function monogramCanvas(text: string, tint: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = tint;
  ctx.font = `800 ${text.length > 2 ? 78 : 104}px ${LABEL_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 136);
  return canvas;
}

export const LABEL_FONT = `"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif`;
export const LABEL_W = 640;
export const LABEL_H = 220;

export interface LabelData {
  rank: number;
  name: string;
  price: string;
  changePct: number;
  cap: string | null;
  /** Name and move only. */
  compact?: boolean;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The caption under a sphere: rank, name, price and the move in a coloured pill,
 * and the market value in small type. Drawn at 2x for a crisp sprite. */
export function drawLabel(canvas: HTMLCanvasElement, d: LabelData): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, LABEL_W, LABEL_H);
  const cx = LABEL_W / 2;
  if (d.compact) {
    const pct = `${d.changePct > 0 ? "+" : d.changePct < 0 ? "−" : ""}${Math.abs(d.changePct).toFixed(2)}%`;
    const up = d.changePct > 0.04, down = d.changePct < -0.04;
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,4,12,.9)";
    ctx.shadowBlur = 14;
    ctx.font = `800 62px ${LABEL_FONT}`;
    let name = d.name;
    while (ctx.measureText(name).width > LABEL_W - 40 && name.length > 2) name = name.slice(0, -1);
    if (name !== d.name) name = `${name.slice(0, -1)}…`;
    ctx.fillStyle = "#eef4ff";
    ctx.fillText(name, cx, 78);
    ctx.font = `800 50px ${LABEL_FONT}`;
    ctx.fillStyle = up ? "#ff6b78" : down ? "#6aa7ff" : "#b3bccb";
    ctx.fillText(pct, cx, 146);
    return;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // name with rank, over a faint shadow for legibility against bright glass
  ctx.shadowColor = "rgba(0,4,12,.85)";
  ctx.shadowBlur = 14;
  ctx.font = `800 58px ${LABEL_FONT}`;
  let name = d.name;
  while (ctx.measureText(name).width > LABEL_W - 150 && name.length > 2) name = name.slice(0, -1);
  if (name !== d.name) name = `${name.slice(0, -1)}…`;
  const nameW = ctx.measureText(name).width;
  ctx.font = `700 34px ${LABEL_FONT}`;
  const rankText = `${d.rank}`;
  const rankW = ctx.measureText(rankText).width + 26;
  const startX = cx - (nameW + rankW + 14) / 2;
  ctx.shadowBlur = 0;
  roundRect(ctx, startX, 30, rankW, 46, 23);
  ctx.fillStyle = "rgba(214,164,69,.95)";
  ctx.fill();
  ctx.fillStyle = "#1a1206";
  ctx.fillText(rankText, startX + rankW / 2, 65);
  ctx.shadowBlur = 14;
  ctx.font = `800 58px ${LABEL_FONT}`;
  ctx.fillStyle = "#f4f8ff";
  ctx.textAlign = "left";
  ctx.fillText(name, startX + rankW + 14, 74);

  // price + change pill
  ctx.textAlign = "left";
  ctx.font = `600 40px ${LABEL_FONT}`;
  const pct = `${d.changePct > 0 ? "+" : d.changePct < 0 ? "−" : ""}${Math.abs(d.changePct).toFixed(2)}%`;
  const priceW = ctx.measureText(d.price).width;
  ctx.font = `800 40px ${LABEL_FONT}`;
  const pctW = ctx.measureText(pct).width + 34;
  const rowX = cx - (priceW + 16 + pctW) / 2;
  ctx.font = `600 40px ${LABEL_FONT}`;
  ctx.fillStyle = "rgba(226,236,250,.92)";
  ctx.fillText(d.price, rowX, 140);
  ctx.shadowBlur = 0;
  const up = d.changePct > 0.04, down = d.changePct < -0.04;
  roundRect(ctx, rowX + priceW + 16, 104, pctW, 50, 25);
  ctx.fillStyle = up ? "rgba(240,72,86,.94)" : down ? "rgba(56,128,255,.94)" : "rgba(150,160,176,.85)";
  ctx.fill();
  ctx.font = `800 40px ${LABEL_FONT}`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(pct, rowX + priceW + 16 + pctW / 2, 142);

  if (d.cap) {
    ctx.shadowColor = "rgba(0,4,12,.85)";
    ctx.shadowBlur = 10;
    ctx.font = `600 30px ${LABEL_FONT}`;
    ctx.fillStyle = "rgba(170,196,226,.85)";
    ctx.fillText(d.cap, cx, 200);
  }
}
