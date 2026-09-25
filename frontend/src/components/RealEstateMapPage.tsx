import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { api, RealEstateItem, RealEstateMapResponse, RealEstatePeriod, RealEstateSido } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { TILE_FONT_FAMILY, measureTextWidth, pct, tileDisplayInfo } from "../mapTile";
import { TreemapRect, changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";
import { useDocumentTitle } from "../useDocumentTitle";
import Colophon from "../desk2/Colophon";
import Finder from "../desk2/Finder";
import Masthead from "../desk2/Masthead";
import { useBroadsheet, useFinderHotkey } from "../desk2/shell";
import "../desk2/maps.css";
import "../desk2/realestate-region.css";
import Tape from "../desk2/Tape";
import FloatingTip from "./FloatingTip";
import RealEstateSheet from "./RealEstateSheet";
import { useMediaQuery } from "../useMediaQuery";
import RealEstatePopup, { PopupContext, fullPrice, shortPrice } from "./RealEstatePopup";
import AptBrandIcon, { APT_BRANDS, brandIconWidth, brandImage } from "./AptBrandIcon";
import {
  MapExportButtons,
  MapPreviewModal,
  TILE_NIGHT_MODE,
  loadImage,
  resolveCssColor,
  truncateToWidth,
  useMapExport,
} from "./mapExport";

/* /realestate-map — 부동산 맵. The same broadsheet treemap as the four market maps,
 * over apartment complexes instead of listed companies: 시·도 → 시·군·구 → 읍·면·동
 * narrows the region, tiles are sized by each complex's latest 실거래가 and coloured
 * by how that price moved over the chosen period (see backend
 * app/services/realestate_map.py for exactly how both are derived). */

// The region map pulls in three.js; it loads after the treemap, never ahead of it.
const RegionMap3D = lazy(() => import("./RegionMap3D"));

const PERIODS: { key: RealEstatePeriod; label: string; detail: string }[] = [
  { key: "3m", label: "3개월", detail: "최근 3개월 실거래" },
  { key: "6m", label: "6개월", detail: "최근 6개월 실거래" },
  { key: "1y", label: "1년", detail: "최근 1년 실거래" },
];

/** Apartment prices move less than stocks in a day but more over a year; the colour
 * scale saturates at ±10% rather than the stock maps' ±5%. */
const SATURATION_PCT = 10;
const SKELETON_WEIGHTS = [30, 22, 16, 12, 10, 6, 4];
/** The map area keeps the 야간판 palette in both editions (see TILE_NIGHT_MODE). */
const MAP_MODE = TILE_NIGHT_MODE;
/** The no-trade tile, as .re-map-tile--idle draws it (desk2/maps.css). */
const IDLE_FILL = "#22221e";
const IDLE_RING = "rgba(236, 230, 214, 0.1)";
const IDLE_TEXT = "#bdb6a4";
const IDLE_PCT = "#8a8475";

/** Draws `img` inside a w×h box the way CSS object-fit: contain does. */
function drawInBox(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / img.width, h / img.height) || 0;
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

interface TileLayout {
  showName: boolean;
  showPctOnly: boolean;
  /** The name as it is drawn, one entry per line. */
  lines: string[];
  nameSize: number;
  /** Where the brand mark goes: before the first line, on a row of its own above
   * the name, or nowhere (the tooltip still names the brand). */
  icon: "inline" | "above" | null;
  iconSize: number;
  iconWidth: number;
  showPrice: boolean;
  priceSize: number;
  pctSize: number;
}

const TILE_PAD_X = 5;
const LINE = 1.2;

/** The name split into two lines that each fit `avail`, breaking at a space or
 * bracket when one falls where it can, anywhere otherwise — Korean complex names
 * rarely have spaces. null when no split fits. */
function splitName(name: string, size: number, avail: number): [string, string] | null {
  const fits = (t: string) => measureTextWidth(t, size) <= avail;
  if (name.length < 2) return null;
  let cut = name.length - 1;
  while (cut > 0 && !fits(name.slice(0, cut))) cut -= 1;
  if (cut === 0) return null;
  for (let k = cut; k > Math.max(0, cut - 5); k -= 1) {
    if (/[\s(\[·-]/.test(name[k]) || /[)\]]/.test(name[k - 1])) {
      const a = name.slice(0, k).trimEnd();
      const b = name.slice(k).trimStart();
      if (a && fits(b)) return [a, b];
    }
  }
  const rest = name.slice(cut);
  return fits(rest) ? [name.slice(0, cut), rest] : null;
}

/** How a tile shows its complex's name. The name is the point of the map, so it is
 * given room first: a smaller type size before an ellipsis, the brand mark moved
 * above the name or dropped before the name is cut, two lines before one cut line,
 * and the price line only when all of that still leaves space for it. */
function tileLayout(item: RealEstateItem, w: number, h: number): TileLayout {
  const base = tileDisplayInfo(w, h, item.name);
  const pctSize = base.fontSizes.pct;
  const iconSize = base.iconSize;
  const iconWidth = brandIconWidth(item.brand, iconSize);
  const priceSize = Math.max(10, pctSize * 0.85);
  const result: TileLayout = {
    showName: base.showName,
    showPctOnly: base.showPctOnly,
    lines: [item.name],
    nameSize: base.fontSizes.name,
    icon: null,
    iconSize,
    iconWidth,
    showPrice: false,
    priceSize,
    pctSize,
  };
  if (!base.showName) return result;

  const avail = w - TILE_PAD_X * 2;
  // The tile's own padding and the 1px gaps between its rows come out of the height.
  const room = h - 8;
  const pctH = pctSize * LINE;
  const height = (lines: number, size: number, above: boolean) =>
    lines * size * LINE + (above ? iconSize + 2 : 0) + pctH;
  const width = (t: string, size: number) => measureTextWidth(t, size);
  const hasIcon = !!item.brand && iconWidth > 0 && iconWidth <= avail;
  const minSize = Math.max(10, base.fontSizes.name * 0.72);
  const sizes: number[] = [];
  for (let size = base.fontSizes.name; size >= minSize; size -= 0.5) sizes.push(size);

  const finish = (lines: string[], size: number, icon: TileLayout["icon"]) => {
    const used = height(lines.length, size, icon === "above");
    return {
      ...result,
      lines,
      nameSize: size,
      icon,
      showPrice: w >= 70 && used + priceSize * 1.25 <= room,
    };
  };

  // One line: with the mark in front, then with the mark above, then without it.
  for (const size of sizes) {
    const nameW = width(item.name, size);
    if (height(1, size, false) > room) continue;
    if (hasIcon && nameW + iconWidth + 4 <= avail) return finish([item.name], size, "inline");
    if (nameW <= avail) {
      if (hasIcon && height(1, size, true) <= room) return finish([item.name], size, "above");
      return finish([item.name], size, null);
    }
  }
  // Two lines.
  for (const size of sizes) {
    if (height(2, size, false) > room) continue;
    const split = splitName(item.name, size, avail);
    if (!split) continue;
    if (hasIcon && height(2, size, true) <= room) return finish(split, size, "above");
    return finish(split, size, null);
  }
  // Nothing fits whole: one line, cut with an ellipsis, as the market maps do.
  const inline = hasIcon && w >= iconWidth + iconSize * 2.5;
  return finish([item.name], base.fontSizes.name, inline ? "inline" : null);
}

/** 거래없음 for a tile with nothing to compare, the change otherwise. */
function tileLabelText(item: RealEstateItem): string {
  return item.change_pct === null ? "거래없음" : pct(item.change_pct);
}

interface Zone {
  group: string;
  rect: TreemapRect;
  headerH: number;
  avg: number | null;
  tiles: (TreemapRect & { item: RealEstateItem })[];
}



function dateDots(iso: string | null): string {
  return iso ? iso.replace(/-/g, ".") : "—";
}

function colourFor(change: number | null, mode: "dark" | "light") {
  if (change === null) return null;
  return changeToRgb((change / SATURATION_PCT) * 5, mode);
}

const DEFAULT_SIDO = "11"; // 서울특별시
const DEFAULT_SGG = "11680"; // 강남구

function readQuery() {
  const q = new URLSearchParams(window.location.search);
  const period = q.get("period") as RealEstatePeriod | null;
  return {
    // A bare /realestate-map opens on 서울 강남구. A link that names its own region —
    // including 시·도 전체, which carries sido and no sgg — is taken as it is.
    sido: q.get("sido") ?? DEFAULT_SIDO,
    sgg: q.get("sgg") ?? (q.has("sido") ? "" : DEFAULT_SGG),
    dong: q.get("dong") ?? "",
    period: PERIODS.some((p) => p.key === period) ? (period as RealEstatePeriod) : "3m",
  };
}

export default function RealEstateMapPage() {
  const { lang } = useLanguage();
  useDocumentTitle("부동산 맵 · 아파트 실거래가 히트맵 · K-Stock Hub");
  useBroadsheet();
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);
  useEffect(() => {
    document.documentElement.classList.add("is-mm");
    return () => document.documentElement.classList.remove("is-mm");
  }, []);

  const initial = useMemo(readQuery, []);
  const [sido, setSido] = useState(initial.sido);
  const [sgg, setSgg] = useState(initial.sgg);
  const [dong, setDong] = useState(initial.dong);
  const [period, setPeriod] = useState<RealEstatePeriod>(initial.period);
  const [regions, setRegions] = useState<RealEstateSido[]>([]);
  const [data, setData] = useState<RealEstateMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "table">("map");
  const [hovered, setHovered] = useState<RealEstateItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    api
      .realEstateRegions()
      .then((r) => setRegions(r.sido))
      .catch(() => setError("지역 목록을 불러오지 못했습니다."));
  }, []);

  const sidoNode = regions.find((r) => r.code === sido);
  const sggNode = sidoNode?.sgg.find((g) => g.code === sgg);
  // The selectors list 시·군·구 and 읍·면·동 in 가나다 order; the region table itself
  // arrives in 법정동코드 order.
  const byName = (a: string, b: string) => a.localeCompare(b, "ko");
  const sggOptions = useMemo(() => [...(sidoNode?.sgg ?? [])].sort((a, b) => byName(a.name, b.name)), [sidoNode]);
  const dongOptions = useMemo(() => [...(sggNode?.dongs ?? [])].sort(byName), [sggNode]);

  // The address bar carries the selection, so a map can be shared or bookmarked.
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("sido", sido);
    if (sgg) q.set("sgg", sgg);
    if (sgg && dong) q.set("dong", dong);
    q.set("period", period);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q}`);
  }, [sido, sgg, dong, period]);

  /** A phone's screen fits about 100 tiles, so its 시·도 map asks for the top 100
   * (every 시·군·구 still keeps its own top 10); a desktop gets 500. */
  const smallScreen = useMediaQuery("(max-width: 760px)");
  const sidoTop = smallScreen ? 100 : 500;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = (first: boolean) => {
      if (first) setLoading(true);
      api
        .realEstateMap({ sido, sgg: sgg || undefined, dong: (sgg && dong) || undefined, period, top: sidoTop })
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setError(null);
          // While the collector is still filling this region, re-read it: the map
          // grows district by district instead of waiting for a reload.
          if (res.status.collecting) timer = window.setTimeout(() => load(false), 8000);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message || "부동산 데이터를 불러오지 못했습니다.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load(true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sido, sgg, dong, period, sidoTop]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const items = data?.items ?? [];

  const zones = useMemo<Zone[]>(() => {
    if (items.length === 0 || size.w === 0 || size.h === 0) return [];
    const byGroup = new Map<string, RealEstateItem[]>();
    for (const it of items) {
      const list = byGroup.get(it.group) ?? [];
      list.push(it);
      byGroup.set(it.group, list);
    }
    const groups = Array.from(byGroup.entries())
      .map(([group, list]) => ({ group, list: list.sort((a, b) => b.price - a.price), total: list.reduce((s, it) => s + it.price, 0) }))
      .sort((a, b) => b.total - a.total);
    const rects = squarify(groups.map((g) => ({ id: g.group, value: g.total })), 0, 0, size.w, size.h);
    return rects.map((rect) => {
      const g = groups.find((x) => x.group === rect.id)!;
      const headerH = rect.h > 46 ? 20 : 0;
      const pad = rect.w > 6 && rect.h - headerH > 6 ? 1 : 0;
      const inner = squarify(
        g.list.map((it) => ({ id: it.id, value: it.price })),
        rect.x + pad,
        rect.y + headerH,
        Math.max(rect.w - pad * 2, 0),
        Math.max(rect.h - headerH - pad, 0)
      );
      const byId = new Map(g.list.map((it) => [it.id, it]));
      const moved = g.list.filter((it) => it.change_pct !== null);
      const weight = moved.reduce((s, it) => s + it.price, 0);
      return {
        group: rect.id,
        rect,
        headerH,
        avg: weight > 0 ? moved.reduce((s, it) => s + (it.change_pct as number) * it.price, 0) / weight : null,
        tiles: inner.map((t) => ({ ...t, item: byId.get(t.id)! })),
      };
    });
  }, [items, size]);

  const skeleton = useMemo(
    () => (size.w && size.h ? squarify(SKELETON_WEIGHTS.map((value, i) => ({ id: `s${i}`, value })), 0, 0, size.w, size.h) : []),
    [size]
  );

  const total = useMemo(() => items.reduce((s, it) => s + it.price, 0), [items]);
  const movedCount = items.filter((it) => it.change_pct !== null).length;

  /** A click or tap on a complex pins its card (a sheet on touch screens, a dialog on
   * a desktop), where its 평형 can be switched and moving into its region is a
   * button. On a desktop the hover card still previews it. */
  const touchUi = useMediaQuery("(hover: none), (pointer: coarse)");
  /** Tablets and phones stack the region map above the treemap (styles.css, 980px). */
  const stacked = useMediaQuery("(max-width: 980px)");
  const mainRef = useRef<HTMLDivElement>(null);
  /** On a stacked layout a region picked on the region map scrolls down to the
   * treemap it just changed, clear of the sticky command bar. */
  const revealTreemap = () => {
    requestAnimationFrame(() => {
      const el = mainRef.current;
      if (!el) return;
      const bar = document.querySelector<HTMLElement>(".d2-cmd");
      const offset = (bar && getComputedStyle(bar).position === "sticky" ? bar.offsetHeight : 0) + 8;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: reduce ? "auto" : "smooth" });
    });
  };
  // The region map folds away on a phone, where it sits above the treemap; the choice
  // is remembered.
  const [regionMapOpen, setRegionMapOpen] = useState(() => {
    try {
      return window.localStorage.getItem("re_region_map") !== "closed";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("re_region_map", regionMapOpen ? "open" : "closed");
    } catch {
      /* private mode: the choice lasts this visit */
    }
  }, [regionMapOpen]);
  const [sheetItem, setSheetItem] = useState<RealEstateItem | null>(null);
  useEffect(() => setSheetItem(null), [sido, sgg, dong, period]);

  /** Where a click on this complex leads, as a button label — null at 동 level. */
  const drillLabel = (item: RealEstateItem): string | null =>
    !sgg ? `${item.sgg} 지도로 이동` : !dong && item.dong ? `${item.dong} 지도로 이동` : null;

  const openItem = (item: RealEstateItem) => {
    setHovered(null);
    setSheetItem(item);
  };

  /** A tile or a group drills one level down: 시·도 → 시·군·구 → 읍·면·동. */
  const drill = (item: RealEstateItem | null, group?: string) => {
    if (!sidoNode) return;
    if (!sgg) {
      const name = item?.sgg ?? group;
      const target = sidoNode.sgg.find((g) => g.name === name);
      if (target) {
        setSgg(target.code);
        setDong("");
      }
    } else if (!dong) {
      const name = item?.dong ?? group;
      if (name) setDong(name);
    }
    setHovered(null);
  };

  const levelLabel = dong || sggNode?.name || sidoNode?.name || "";
  const topN = data?.top_n ?? (sgg ? 100 : sidoTop);
  const groupFloor = data?.group_floor ?? null;
  const periodInfo = PERIODS.find((p) => p.key === period) ?? PERIODS[0];

  /** Where the hovered complex stands on this map, and what clicking it does. */
  const popupContext = (item: RealEstateItem): PopupContext => {
    const inGroup = items.filter((it) => it.group === item.group);
    return {
      periodLabel: periodInfo.label,
      regionLabel: levelLabel,
      regionRank: items.indexOf(item) + 1,
      regionCount: items.length,
      groupRank: inGroup.indexOf(item) + 1,
      groupCount: inGroup.length,
      share: total > 0 ? (item.price / total) * 100 : 0,
      clickHint: "클릭하면 평형별 상세 보기",
    };
  };

  /** The map as a PNG, drawn from the same zones the page renders — the market maps'
   * export, with brand marks, the price line and the no-trade tiles added. */
  const renderMapPng = async (): Promise<Blob | null> => {
    if (zones.length === 0 || size.w === 0 || size.h === 0) return null;
    const host = containerRef.current ?? document.body;
    const cardBg = resolveCssColor("var(--surface-1)", host);
    const gapColor = resolveCssColor("var(--map-gap)", host);
    const headerBg = resolveCssColor("color-mix(in srgb, var(--baseline) 35%, var(--surface-1))", host);
    const headerBorder = resolveCssColor("var(--gridline)", host);
    const textPrimary = resolveCssColor("var(--text-primary)", host);
    const upColor = resolveCssColor("var(--up-color)", host);
    const downColor = resolveCssColor("var(--down-color)", host);

    const logos = new Map<string, HTMLImageElement>();
    await Promise.all(
      Array.from(new Set(items.map((it) => it.brand).filter((b): b is string => !!b))).map(async (brand) => {
        const image = brandImage(brand);
        const img = image ? await loadImage(image.src) : null;
        if (img) logos.set(brand, img);
      })
    );

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(size.w * scale);
    canvas.height = Math.round(size.h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.fillStyle = cardBg;
    ctx.fillRect(0, 0, size.w, size.h);

    for (const zone of zones) {
      if (zone.headerH > 0) {
        ctx.fillStyle = headerBg;
        ctx.fillRect(zone.rect.x, zone.rect.y, zone.rect.w, zone.headerH);
        ctx.strokeStyle = headerBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(zone.rect.x, zone.rect.y + zone.headerH);
        ctx.lineTo(zone.rect.x + zone.rect.w, zone.rect.y + zone.headerH);
        ctx.stroke();
        ctx.font = `700 11px ${TILE_FONT_FAMILY}`;
        ctx.textBaseline = "middle";
        const avgText = zone.avg === null ? "" : pct(zone.avg);
        const avgWidth = avgText ? ctx.measureText(avgText).width : 0;
        ctx.fillStyle = textPrimary;
        ctx.textAlign = "left";
        ctx.fillText(
          truncateToWidth(ctx, zone.group, Math.max(0, zone.rect.w - 14 - avgWidth - 6)),
          zone.rect.x + 7,
          zone.rect.y + zone.headerH / 2 + 1
        );
        if (zone.avg !== null) {
          ctx.fillStyle = zone.avg >= 0 ? upColor : downColor;
          ctx.textAlign = "right";
          ctx.fillText(avgText, zone.rect.x + zone.rect.w - 7, zone.rect.y + zone.headerH / 2 + 1);
          ctx.textAlign = "left";
        }
      }

      for (const tile of zone.tiles) {
        const it = tile.item;
        const rgb = colourFor(it.change_pct, MAP_MODE);
        ctx.fillStyle = rgb ? rgbToCss(rgb) : IDLE_FILL;
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
        ctx.lineWidth = 1;
        if (!rgb && tile.w > 4 && tile.h > 4) {
          ctx.strokeStyle = IDLE_RING;
          ctx.strokeRect(tile.x + 1.5, tile.y + 1.5, tile.w - 3, tile.h - 3);
        }
        ctx.strokeStyle = gapColor;
        ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, Math.max(tile.w - 1, 0), Math.max(tile.h - 1, 0));

        const layout = tileLayout(it, tile.w, tile.h);
        const { showName, showPctOnly, iconSize, iconWidth } = layout;
        if (!showName && !showPctOnly) continue;
        const textColor = rgb ? textColorForRgb(rgb, MAP_MODE) : IDLE_TEXT;
        const padX = TILE_PAD_X;
        if (showName) {
          const drawMark = (x: number, y: number) => {
            if (!it.brand) return;
            const logo = logos.get(it.brand);
            if (logo) {
              ctx.fillStyle = "#fff";
              ctx.fillRect(x, y, iconWidth, iconSize);
              drawInBox(ctx, logo, x + 1, y + 1, iconWidth - 2, iconSize - 2);
            } else {
              const b = APT_BRANDS[it.brand];
              ctx.fillStyle = b.color;
              ctx.fillRect(x, y, iconSize, iconSize);
              ctx.fillStyle = "#fff";
              ctx.font = `800 ${Math.round(iconSize * (b.mark.length > 1 ? 0.5 : 0.65))}px ${TILE_FONT_FAMILY}`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(b.mark, x + iconSize / 2, y + iconSize / 2);
              ctx.textAlign = "left";
            }
          };
          // Stacked from the top, the way the tile's flex column lays it out, then
          // centred vertically as that column is.
          const blockH =
            (layout.icon === "above" ? iconSize + 2 : 0) +
            layout.lines.length * layout.nameSize * LINE +
            (layout.showPrice ? layout.priceSize * 1.25 : 0) +
            layout.pctSize * LINE;
          let y = tile.y + Math.max(2, (tile.h - blockH) / 2);
          if (layout.icon === "above") {
            drawMark(tile.x + padX, y);
            y += iconSize + 2;
          }
          ctx.textBaseline = "top";
          layout.lines.forEach((line, i) => {
            let textX = tile.x + padX;
            if (i === 0 && layout.icon === "inline") {
              drawMark(textX, y + (layout.nameSize * LINE - iconSize) / 2);
              textX += iconWidth + 4;
            }
            ctx.fillStyle = textColor;
            ctx.font = `700 ${layout.nameSize}px ${TILE_FONT_FAMILY}`;
            ctx.textBaseline = "top";
            ctx.fillText(truncateToWidth(ctx, line, tile.x + tile.w - padX - textX), textX, y + 1);
            y += layout.nameSize * LINE;
          });
          if (layout.showPrice) {
            ctx.font = `600 ${layout.priceSize}px ${TILE_FONT_FAMILY}`;
            ctx.globalAlpha = 0.88;
            ctx.fillText(
              truncateToWidth(ctx, `${shortPrice(it.price)} · ${Math.round(it.area)}㎡`, tile.w - padX * 2),
              tile.x + padX,
              y + 1
            );
            ctx.globalAlpha = 1;
            y += layout.priceSize * 1.25;
          }
          ctx.font = `600 ${layout.pctSize}px ${TILE_FONT_FAMILY}`;
          ctx.fillStyle = rgb ? textColor : IDLE_PCT;
          ctx.fillText(tileLabelText(it), tile.x + padX, y + 1);
        } else {
          ctx.fillStyle = rgb ? textColor : IDLE_PCT;
          ctx.font = `600 ${layout.pctSize}px ${TILE_FONT_FAMILY}`;
          ctx.textBaseline = "middle";
          ctx.fillText(it.change_pct === null ? "—" : pct(it.change_pct), tile.x + padX, tile.y + tile.h / 2);
        }
      }

      ctx.strokeStyle = gapColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(zone.rect.x + 1, zone.rect.y + 1, Math.max(zone.rect.w - 2, 0), Math.max(zone.rect.h - 2, 0));
    }
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  };

  const mapExport = useMapExport({
    render: renderMapPng,
    filePrefix: `realestate_${sgg || sido}${dong ? "_" + dong : ""}`,
    shareTitle: `부동산 MAP · ${levelLabel} | K-Stock Hub`,
    shareText: `${levelLabel} 아파트 실거래가 히트맵 (${periodInfo.label})`,
  });
  const status = data?.status;

  return (
    <div className="d2 mm app kospi-map-page kospi-map-page--expanded re-map-page" lang={lang}>
      <Masthead
        rail={false}
        onPrint={() => window.print()}
        section={{
          ko: "부동산 지도",
          en: "Real estate map",
          taglineKo: "아파트 실거래가 히트맵 — 면적은 시세, 색은 등락",
          taglineEn: "Apartment trades — area is price, colour is the move",
        }}
      />
      <Tape />

      <main className="d2-main mm-main">
        <div className="app-header-trailing">
          <div className="kospi-map-titlebar">
            <div>
              <div className="app-title-row">
                <h2 className="app-title">부동산 MAP</h2>
                <span className="kospi-map-live-badge">
                  <span className="kospi-map-live-dot" />
                  국토교통부 실거래가
                </span>
              </div>
              <p className="app-subtitle">
                {levelLabel}{" "}
                {data && items.length < topN
                  ? `전체 ${items.length.toLocaleString()}개`
                  : groupFloor
                    ? `가격 상위 ${topN.toLocaleString()}개 + 구별 상위 ${groupFloor}개`
                    : `가격 상위 ${topN.toLocaleString()}개`}{" "}
                아파트 단지 MAP
                {data?.latest_deal_date && <span className="kospi-map-updated"> · 최근 계약일 {dateDots(data.latest_deal_date)}</span>}
              </p>
            </div>
            <div className="kospi-map-view-toggle">
              <button type="button" className={view === "map" ? "active" : ""} onClick={() => setView("map")}>
                맵 보기
              </button>
              <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>
                표로 보기
              </button>
              <MapExportButtons exp={mapExport} disabled={zones.length === 0} />
            </div>
          </div>
        </div>

        {error && <div className="error-state">{error}</div>}
        {status && !status.configured && (
          <div className="error-state re-map-notice">
            국토교통부 아파트 매매 실거래가 API 키가 아직 설정되지 않아 데이터를 불러올 수 없습니다. 서버 환경변수 <code>MOLIT_API_KEY</code>를
            설정하면 자동으로 수집을 시작합니다.
          </div>
        )}

        <div className="kospi-map-workspace">
          <aside className="kospi-map-period-rail re-map-rail" aria-label="조회 기간과 지역 지도">
            <div className="kospi-map-period-head">
              <small>REAL TRADES</small>
              <strong>조회 기간</strong>
            </div>
            <div className="kospi-map-period-options">
              {PERIODS.map((option) => (
                <label key={option.key} className={period === option.key ? "active" : ""}>
                  <input type="checkbox" checked={period === option.key} onChange={() => setPeriod(option.key)} />
                  <span>
                    <b>{option.label}</b>
                    <small>{option.key === "today" && data?.latest_deal_date ? `최근 계약일 ${dateDots(data.latest_deal_date)}` : option.detail}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className={`re-map-region${regionMapOpen ? "" : " is-collapsed"}`}>
              <button
                type="button"
                className="re-map-region-toggle"
                aria-expanded={regionMapOpen}
                onClick={() => setRegionMapOpen((v) => !v)}
              >
                <span>지역별 등락 지도</span>
                <small>{regionMapOpen ? "접기" : "펼치기"}</small>
              </button>
              {regionMapOpen && regions.length > 0 && (
                <Suspense fallback={<div className="rm3 rm3--placeholder" />}>
                  <RegionMap3D
                    regions={regions}
                    sido={sido}
                    sgg={sgg}
                    dong={dong}
                    period={period}
                    periodLabel={periodInfo.label}
                    touch={touchUi}
                    onSelect={(next) => {
                      setSido(next.sido);
                      setSgg(next.sgg);
                      setDong(next.dong);
                      if (stacked) revealTreemap();
                    }}
                  />
                </Suspense>
              )}
            </div>
            <div className="kospi-map-period-status" aria-live="polite">
              {loading
                ? "실거래 데이터를 불러오는 중…"
                : status?.collecting
                  ? `실거래 수집 중 ${Math.round(status.coverage * 100)}% · 자동 갱신`
                  : `${items.length.toLocaleString()}개 단지 · 기간 내 거래 ${movedCount.toLocaleString()}곳`}
              {status?.error && status.collecting && <div className="re-map-status-error">최근 오류: {status.error}</div>}
            </div>
            <p className="kospi-map-period-note">
              대표 평형의 현재 시세를 기간 시작 직전 시세와 비교합니다. 시세는 최근 거래 최대 3건(90일 이내)의 중간값이고, 지역 색은 그
              지역 단지들의 시세 가중 평균 등락입니다. 실거래는 계약 후 30일 안에 신고되므로 최근 며칠은 거래가 적게 보일 수 있으며, 해제된
              계약은 제외합니다.
            </p>
          </aside>

          <div className="kospi-map-workspace-main" ref={mainRef}>
            <div className="kospi-map-legend re-map-legend">
              <div className="kospi-map-legend-info">
                <span className="kospi-map-legend-label">하락</span>
                <span className="kospi-map-legend-bar" />
                <span className="kospi-map-legend-label">상승</span>
                <span className="kospi-map-legend-scale">±10% 포화 · 회색 = 기간 내 거래 없음</span>
              </div>
              <div className="re-map-filters">
                <label className="kospi-map-sector-filter">
                  <span className="kospi-map-sector-filter-label">시·도</span>
                  <select
                    value={sido}
                    onChange={(e) => {
                      setSido(e.target.value);
                      setSgg("");
                      setDong("");
                    }}
                    aria-label="시·도"
                  >
                    {regions.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="kospi-map-sector-filter">
                  <span className="kospi-map-sector-filter-label">시·군·구</span>
                  <select
                    value={sgg}
                    onChange={(e) => {
                      setSgg(e.target.value);
                      setDong("");
                    }}
                    aria-label="시·군·구"
                  >
                    <option value="">전체</option>
                    {sggOptions.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="kospi-map-sector-filter">
                  <span className="kospi-map-sector-filter-label">읍·면·동</span>
                  <select value={dong} onChange={(e) => setDong(e.target.value)} disabled={!sgg} aria-label="읍·면·동">
                    <option value="">전체</option>
                    {dongOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {view === "map" && (
              <div className="card kospi-map-canvas map-canvas-night" ref={containerRef}>
                {loading &&
                  skeleton.map((rect, i) => (
                    <div
                      key={rect.id}
                      className="kospi-map-skeleton-block"
                      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, animationDelay: `${i * 70}ms` }}
                    />
                  ))}
                {!loading && items.length === 0 && status?.configured && (
                  <div className="re-map-empty">
                    {status.collecting
                      ? `${levelLabel}의 실거래 데이터를 수집하고 있습니다 (${Math.round(status.coverage * 100)}%). 잠시 후 자동으로 표시됩니다.`
                      : `${levelLabel}에는 최근 1년 아파트 매매 실거래가 없습니다.`}
                  </div>
                )}
                {!loading &&
                  zones.map((zone) => (
                    <div
                      key={zone.group}
                      className="kospi-map-sector"
                      style={{ left: zone.rect.x, top: zone.rect.y, width: zone.rect.w, height: zone.rect.h }}
                    >
                      {zone.headerH > 0 && (
                        <button
                          type="button"
                          className="kospi-map-sector-header re-map-group-head"
                          style={{ height: zone.headerH }}
                          onClick={() => drill(null, zone.group)}
                          disabled={!!dong}
                          title={dong ? undefined : `${zone.group}만 보기`}
                        >
                          <span className="kospi-map-sector-name">{zone.group}</span>
                          {zone.avg !== null && (
                            <span className="kospi-map-sector-avg" style={{ color: zone.avg >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                              {pct(zone.avg)}
                            </span>
                          )}
                        </button>
                      )}
                      {zone.tiles.map((tile) => {
                        const it = tile.item;
                        const rgb = colourFor(it.change_pct, MAP_MODE);
                        const idle = rgb === null;
                        const text = rgb ? textColorForRgb(rgb, MAP_MODE) : undefined;
                        const layout = tileLayout(it, tile.w, tile.h);
                        const { showName, showPctOnly, iconSize } = layout;
                        const label = tileLabelText(it);
                        return (
                          <button
                            key={tile.id}
                            type="button"
                            className={`kospi-map-tile${idle ? " re-map-tile--idle" : ""}`}
                            style={{
                              left: tile.x - zone.rect.x,
                              top: tile.y - zone.rect.y,
                              width: tile.w,
                              height: tile.h,
                              background: rgb ? rgbToCss(rgb) : undefined,
                              color: text,
                              fontFamily: TILE_FONT_FAMILY,
                            }}
                            onClick={() => openItem(it)}
                            onMouseEnter={(e) => {
                              if (touchUi || sheetItem) return;
                              setHovered(it);
                              setHoverPos({ x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
                            onMouseLeave={() => setHovered(null)}
                          >
                            {showName && (
                              <>
                                {layout.icon === "above" && it.brand && (
                                  <AptBrandIcon brand={it.brand} size={iconSize} className="kospi-map-tile-icon re-map-tile-icon-above" />
                                )}
                                {layout.lines.map((line, i) => (
                                  <span className="kospi-map-tile-name-row" key={i}>
                                    {i === 0 && layout.icon === "inline" && it.brand && (
                                      <AptBrandIcon brand={it.brand} size={iconSize} className="kospi-map-tile-icon" />
                                    )}
                                    <span className="kospi-map-tile-name" style={{ fontSize: layout.nameSize }}>
                                      {line}
                                    </span>
                                  </span>
                                ))}
                                {layout.showPrice && (
                                  <span className="re-map-tile-price" style={{ fontSize: layout.priceSize }}>
                                    {shortPrice(it.price)} · {Math.round(it.area)}㎡
                                  </span>
                                )}
                                <span className="kospi-map-tile-pct" style={{ fontSize: layout.pctSize }}>
                                  {label}
                                </span>
                              </>
                            )}
                            {showPctOnly && (
                              <span className="kospi-map-tile-pct" style={{ fontSize: layout.pctSize }}>
                                {it.change_pct === null ? "—" : pct(it.change_pct)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
              </div>
            )}

            {view === "table" && (
              <div className="card kospi-map-table-wrap">
                <table className="kospi-map-table re-map-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>단지명</th>
                      <th>지역</th>
                      <th>대표 평형</th>
                      <th>시세</th>
                      <th>최근 계약</th>
                      <th>기간 전 시세</th>
                      <th>등락률</th>
                      <th>기간 거래</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={it.id} onClick={() => openItem(it)}>
                        <td>{i + 1}</td>
                        <td className="kospi-map-table-name">
                          <span className="re-map-table-name">
                            {it.brand && <AptBrandIcon brand={it.brand} size={16} />}
                            {it.name}
                          </span>
                        </td>
                        <td>
                          {it.sgg} {it.dong}
                        </td>
                        <td>
                          {it.area}㎡ ({it.pyeong}평)
                        </td>
                        <td>{fullPrice(it.price)}</td>
                        <td>{dateDots(it.deal_date)}</td>
                        <td>{it.base_price ? `${fullPrice(it.base_price)} (${dateDots(it.base_date)})` : "—"}</td>
                        <td
                          style={{
                            color: it.change_pct === null ? undefined : it.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)",
                          }}
                        >
                          {it.change_pct === null ? "—" : pct(it.change_pct)}
                        </td>
                        <td>{it.trades}건</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="re-map-source">
              자료: 국토교통부 아파트 매매 실거래가 (공공데이터포털). 면적은 단지 대표 평형(최근 1년 최다 거래 전용면적)의 시세(최근 거래 최대 3건 중간값, 직거래 제외), 그룹 면적은
              지역 내 시세 합계 비중입니다. 브랜드 표시는 단지명 기준 자동 분류이며, 로고는 Wikimedia Commons(힐스테이트·우미린 CC BY-SA)와 각 사 공식 사이트에서 가져왔습니다. 로고가 없는 브랜드는 약식 표지로 표시합니다.
            </p>
          </div>
        </div>

        {sheetItem && (
          <RealEstateSheet
            item={sheetItem}
            ctx={popupContext(sheetItem)}
            period={period}
            goLabel={drillLabel(sheetItem)}
            onGo={() => {
              const item = sheetItem;
              setSheetItem(null);
              drill(item);
            }}
            onClose={() => setSheetItem(null)}
          />
        )}
        {hovered && !touchUi && !sheetItem && (
          <FloatingTip className="kospi-map-tooltip re-pop-tip" x={hoverPos.x} y={hoverPos.y}>
            <RealEstatePopup item={hovered} ctx={popupContext(hovered)} />
          </FloatingTip>
        )}
        <MapPreviewModal exp={mapExport} />
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
