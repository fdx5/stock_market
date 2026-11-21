import {
  CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  FLOOR, MARKETS, PANEL_LABELS, changeText, changeTone, companyLogo, displayValue, postNumber, rowsForPanel, shortTime,
  type FloorSnapshot, type Language,
} from "./market";

const WIDTH = 2048, HEIGHT = 1344, TILE_W = 512, TILE_H = 256;
const PANELS = [...Object.keys(PANEL_LABELS).filter(key => key !== "overview"), ...Array.from({ length: 8 }, (_, i) => "post" + i)];
const COLORS = { up: "#ff8298", down: "#7ebaff", flat: "#a9b3c8" };
type Rect = { x: number; y: number; w: number; h: number };
type ChartSeries = Record<string, number[]>;

export function drawLine(ctx: CanvasRenderingContext2D, points: readonly number[], x: number, y: number, w: number, h: number, color: string) {
  for (let i = 0; i <= 3; i++) {
    ctx.fillStyle = "#9ea9c025";
    ctx.fillRect(x, y + h * i / 3, w, 1);
  }
  if (points.length < 2) return;
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo;
  if (!Number.isFinite(span)) return;
  ctx.beginPath();
  points.forEach((price, i) => {
    const px = x + i / (points.length - 1) * w;
    const py = y + (span ? (hi - price) / span : .5) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, color + "58");
  fill.addColorStop(1, color + "04");
  ctx.fillStyle = fill;
  ctx.fill();
}

function trunc(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

function write(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, weight = 500) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Segoe UI", "Malgun Gothic", sans-serif`;
  ctx.fillText(value, x, y);
}

function panelRect(panel: string): Rect {
  if (panel === "overview") return { x: 0, y: 0, w: 1024, h: 320 };
  if (panel === "sign") return { x: 1024, y: 0, w: 1024, h: 105 };
  const i = PANELS.indexOf(panel);
  return { x: i % 4 * TILE_W, y: 320 + Math.floor(i / 4) * TILE_H, w: TILE_W, h: TILE_H };
}

function background(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, "#121b31");
  gradient.addColorStop(1, "#0a101c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, 4);
  ctx.fillStyle = color + "26";
  ctx.fillRect(16, 52, w - 32, 1);
}

function getCanvas(width: number, height: number) {
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = LinearFilter;
  return { ctx, texture };
}

export function createScreens() {
  const atlas = getCanvas(WIDTH, HEIGHT);
  const ticker = getCanvas(4096, 104);
  ticker.texture.wrapS = RepeatWrapping;
  const boardMaterial = new MeshBasicMaterial({ map: atlas.texture, toneMapped: false });
  const tickerMaterial = new MeshBasicMaterial({ map: ticker.texture, toneMapped: false });
  const group = new Group();
  const targets: Mesh[] = [];
  const placements: [PlaneGeometry[], PlaneGeometry[]] = [[], []];
  const logos = new Map<string, HTMLImageElement | null>();
  let active = true;
  let repaintQueued = 0;
  let snapshot: FloorSnapshot | undefined;
  let series: ChartSeries = {};
  let lang: Language = "ko";
  let cycle = 0;
  let nextCycle = 0;
  const t = (ko: string, en: string) => lang === "ko" ? ko : en;

  for (const screen of FLOOR.screens) {
    const rolling = screen.id === "ticker";
    const geometry = new PlaneGeometry(screen.w, screen.h);
    const uv = geometry.getAttribute("uv");
    if (rolling) {
      const repeats = screen.w / screen.h * 104 / 4096;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * repeats);
    } else {
      const { x, y, w, h } = panelRect(screen.id);
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (x + 2 + uv.getX(i) * (w - 4)) / WIDTH,
          1 - (y + 2 + (1 - uv.getY(i)) * (h - 4)) / HEIGHT);
      }
    }
    const mesh = new Mesh(geometry, rolling ? tickerMaterial : boardMaterial);
    mesh.position.set(screen.x, screen.y, screen.z);
    mesh.rotation.y = screen.yaw * Math.PI / 180;
    mesh.userData.panel = screen.id;
    mesh.updateMatrixWorld(true);
    placements[rolling ? 1 : 0].push(geometry.clone().applyMatrix4(mesh.matrixWorld));
    if (!rolling && screen.id !== "sign") targets.push(mesh);
    else geometry.dispose();
  }
  for (const [i, layout] of placements.entries()) {
    const geometry = mergeGeometries(layout);
    layout.forEach(item => item.dispose());
    if (!geometry) throw new Error("Monitor geometry could not be batched");
    group.add(new Mesh(geometry, i === 0 ? boardMaterial : tickerMaterial));
  }

  function drawLogo(code: string, x: number, y: number, size: number) {
    if (!snapshot) return;
    const ctx = atlas.ctx;
    const url = companyLogo(snapshot.market, code);
    const existing = logos.get(url);
    ctx.fillStyle = "#cde1f021";
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, size * .22);
    ctx.fill();
    if (existing?.complete && existing.naturalWidth > 0) {
      const scale = (size - 5) / Math.max(existing.naturalWidth, existing.naturalHeight);
      const w = existing.naturalWidth * scale, h = existing.naturalHeight * scale;
      ctx.drawImage(existing, x + (size - w) / 2, y + (size - h) / 2, w, h);
      return;
    }
    write(ctx, code.slice(0, 2), x + 4, y + size * .70, size * .36, "#a9c6e1", 730);
    if (existing !== undefined || logos.size >= 90) return;
    const asset = new Image();
    asset.crossOrigin = "anonymous";
    asset.decoding = "async";
    logos.set(url, asset);
    asset.onload = () => {
      if (!active || repaintQueued) return;
      repaintQueued = requestAnimationFrame(() => { repaintQueued = 0; paint(false); });
    };
    asset.onerror = () => { logos.set(url, null); };
    asset.src = url;
  }

  function drawPanel(id: string, data: FloorSnapshot) {
    const ctx = atlas.ctx, { x, y, w, h } = panelRect(id);
    const spec = MARKETS[data.market];
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    if (id === "sign") {
      ctx.fillStyle = "#0c111d";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = spec.color + "66";
      ctx.fillRect(26, h - 5, w - 52, 2);
      ctx.textAlign = "center";
      write(ctx, "K O S P I M A P   E X C H A N G E", w / 2, 70, 48, "#f0dbaa", 750);
      ctx.restore();
      return;
    }
    background(ctx, w, h, spec.color);
    const n = postNumber(id);
    const label = PANEL_LABELS[id]?.[lang === "ko" ? 0 : 1] ?? `POST 0${n + 1}`;
    write(ctx, label, 23, 35, id === "overview" ? 26 : 22, "#edf3ff", 700);
    ctx.textAlign = "right";
    write(ctx, spec.label, w - 24, 35, 18, spec.color, 760);
    ctx.textAlign = "left";
    const stamp = shortTime(data.received);
    if (id === "overview") {
      write(ctx, spec.venue + "  /  " + t("기준 지수", "BENCHMARK"), 28, 98, 23, "#afbad0", 650);
      write(ctx, displayValue(data.index?.close), 28, 188, 74, "#fafbff", 730);
      write(ctx, changeText(data.index?.change), 32, 237, 31, COLORS[changeTone(data.index?.change)], 700);
      write(ctx, shortTime(data.index?.time), 32, 282, 20, "#afbad0");
      drawLine(ctx, data.series, 450, 94, 526, 149, spec.color);
      write(ctx, data.series.length < 2 ? t("차트 수신 대기", "Awaiting history")
        : data.market === "sp500" ? t("제공 장중 시계열", "Intraday history") : t("최근 거래일 일별 종가", "Recent daily closes"),
        450, 280, 20, "#bec8dc");
    } else if (id === "breadth") {
      const counts = [data.up, data.flat, data.down];
      const count = counts.reduce((sum, value) => sum + value, 0);
      let left = 25;
      ["up", "flat", "down"].forEach((key, i) => {
        const color = COLORS[key as keyof typeof COLORS];
        write(ctx, count ? String(counts[i]) : "—", 26 + i * 157, 127, 48, color, 700);
        write(ctx, [t("상승", "Up"), t("보합", "Flat"), t("하락", "Down")][i], 29 + i * 157, 156, 20, "#bfd0e8");
        if (count) { ctx.fillStyle = color; const width = counts[i] / count * 462; ctx.fillRect(left, 182, width, 10); left += width; }
      });
      write(ctx, count ? `${t("제공 표본", "Quote sample")} · ${count} / ${data.rows.length}` : t("표본 수신 대기", "Awaiting quotes"), 27, 228, 19, "#a9bbd4");
    } else if (id === "commodities") {
      data.quotes.forEach(({ name, quote, unit }, i) => {
        const py = 83 + i * 36;
        write(ctx, name, 27, py, 18, "#e7efff", 700);
        write(ctx, displayValue(quote?.price) + (quote ? " " + unit : ""), 169, py, 16, "#cfdaed");
        ctx.textAlign = "right"; write(ctx, changeText(quote?.change_pct), w - 25, py, 17, COLORS[changeTone(quote?.change_pct)]); ctx.textAlign = "left";
      });
    } else if (id === "sectors") {
      data.sectors.slice(0, 4).forEach((sector, i) => {
        const py = 88 + i * 38;
        write(ctx, trunc(sector.name, 25), 27, py, 19, "#dce7fb", 640);
        ctx.textAlign = "right"; write(ctx, changeText(sector.change), w - 27, py, 19, COLORS[changeTone(sector.change)]); ctx.textAlign = "left";
      });
      write(ctx, t("표본 종목 등락률 단순평균", "Average changes in the sample"), 27, 239, 15, "#90a1bd");
    } else {
      const rows = rowsForPanel(data, id);
      if (n >= 0 && rows[0]) {
        const row = rows[0];
        drawLogo(row.code, 25, 69, 46);
        write(ctx, trunc(row.name, 23), 82, 91, 23, "#e6effe", 750);
        write(ctx, row.code + " / " + spec.currency, 83, 115, 15, "#a4b7d3");
        write(ctx, displayValue(row.close), 25, 182, 46, "#f3f7ff", 740);
        write(ctx, changeText(row.change_pct), 27, 218, 25, COLORS[changeTone(row.change_pct)], 700);
        drawLine(ctx, series[row.code] ?? [], 225, 140, 252, 72, spec.color);
        if (!series[row.code]?.length) write(ctx, t("차트 수신 대기", "Awaiting history"), 225, 237, 15, "#8e9ab0");
      } else {
        const pages = n >= 0 ? 1 : Math.max(1, Math.ceil(Math.min(rows.length, 12) / 4));
        const offset = cycle % pages * 4;
        rows.slice(offset, offset + 4).forEach((row, i) => {
          const py = 80 + i * 39;
          drawLogo(row.code, 23, py - 18, 27);
          write(ctx, trunc(data.market === "sp500" ? row.code + " " + row.name : row.name, 23), 60, py, 17, "#e3edf9", 650);
          write(ctx, displayValue(row.close), 310, py, 17, "#c4d1e8");
          ctx.textAlign = "right"; write(ctx, changeText(row.change_pct), w - 23, py, 16, COLORS[changeTone(row.change_pct)]); ctx.textAlign = "left";
        });
        write(ctx, rows.length ? stamp : t("표시할 종목이 없습니다", "No rows available"), 25, 235, 16, "#90a1bd");
        if (pages > 1) {
          ctx.textAlign = "right";
          write(ctx, String(cycle % pages + 1) + "/" + pages, w - 24, 235, 16, spec.color);
          ctx.textAlign = "left";
        }
      }
    }
    ctx.restore();
  }

  function paintTicker(data: FloorSnapshot) {
    const ctx = ticker.ctx, market = MARKETS[data.market];
    ctx.fillStyle = "#080f19";
    ctx.fillRect(0, 0, 4096, 104);
    ctx.fillStyle = market.color;
    ctx.fillRect(0, 101, 4096, 3);
    const entries = [
      [market.label, displayValue(data.index?.close), data.index?.change],
      ...data.rows.slice(0, 10).map(row => [row.code, displayValue(row.close), row.change_pct] as const),
      ...data.quotes.slice(0, 3).map(({ name, quote }) => [name, displayValue(quote?.price), quote?.change_pct] as const),
    ] as const;
    const cells = Math.max(4, entries.length);
    for (let i = 0; i < cells; i++) {
      const [label, price, change] = entries[i % entries.length];
      const x = (i + .08) * 4096 / cells;
      write(ctx, label, x, 35, 28, market.color, 730);
      write(ctx, price, x, 75, 28, "#eaf1fc", 650);
      write(ctx, changeText(change), x + 149, 75, 25, COLORS[changeTone(change)], 650);
    }
    ticker.texture.needsUpdate = true;
  }

  function paint(includeTicker: boolean) {
    if (!snapshot) return;
    drawPanel("overview", snapshot);
    drawPanel("sign", snapshot);
    for (const name of PANELS) drawPanel(name, snapshot);
    atlas.texture.needsUpdate = true;
    if (includeTicker) paintTicker(snapshot);
  }

  return {
    group, targets,
    update(next: FloorSnapshot, nextSeries: ChartSeries, language: Language) {
      if (snapshot?.market !== next.market) cycle = 0;
      snapshot = next; series = nextSeries; lang = language;
      paint(true);
    },
    tick(time: number, reduced: boolean) {
      if (reduced) return;
      ticker.texture.offset.x = (time * .000017) % 1;
      if (!nextCycle) nextCycle = time + 8_000;
      if (!snapshot?.rows.length || time < nextCycle) return;
      nextCycle = time + 8_000;
      cycle++;
      for (const id of ["leaders", "gainers", "laggards"]) drawPanel(id, snapshot);
      atlas.texture.needsUpdate = true;
    },
    dispose() {
      active = false;
      cancelAnimationFrame(repaintQueued);
      for (const image of logos.values()) if (image) image.onload = image.onerror = null;
      targets.forEach(target => target.geometry.dispose());
      group.children.forEach(child => { (child as Mesh).geometry.dispose(); });
      atlas.texture.dispose(); ticker.texture.dispose(); boardMaterial.dispose(); tickerMaterial.dispose();
    },
  };
}
