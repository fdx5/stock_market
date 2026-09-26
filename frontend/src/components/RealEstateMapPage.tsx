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
import RealEstateExploreControls from "./RealEstateExploreControls";
import RealEstateCompare from "./RealEstateCompare";
import RealEstateResults from "./RealEstateResults";
import { csvDownload, FILTER_DEFAULTS, readEstateFilters, tradeState, useSavedEstates } from "./realEstateTools";
import "../desk2/realestate-explore.css";
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
  return tradeState(item);
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
  let last: { sido?: string; sgg?: string; dong?: string } = {};
  if (!q.has("sido") && !q.has("sgg")) {
    try {
      const saved = JSON.parse(localStorage.getItem("re_last_region") ?? "{}");
      if (saved && /^\d{2}$/.test(saved.sido)) last = saved;
    } catch { /* no persisted preference */ }
  }
  return {
    // A bare /realestate-map opens on 서울 강남구. A link that names its own region —
    // including 시·도 전체, which carries sido and no sgg — is taken as it is.
    sido: q.get("sido") ?? last.sido ?? DEFAULT_SIDO,
    sgg: q.get("sgg") ?? (q.has("sido") ? "" : last.sgg ?? DEFAULT_SGG),
    dong: q.get("dong") ?? last.dong ?? "",
    period: PERIODS.some((p) => p.key === period) ? (period as RealEstatePeriod) : "3m",
  };
}

export default function RealEstateMapPage() {
  const { lang } = useLanguage();
  useDocumentTitle("부동산 맵 · 아파트 실거래가 히트맵 · K-Stock Hub");
  useBroadsheet({ lightByDefault: true });
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
  const [view, setView] = useState<"map" | "table">(() => new URLSearchParams(location.search).get("view") === "table" ? "table" : "map");
  const [filters, setFilters] = useState(readEstateFilters);
  const [page, setPage] = useState(() => Math.max(0, Number(new URLSearchParams(location.search).get("page")) || 0));
  const [retry, setRetry] = useState(0);
  const [regionsError, setRegionsError] = useState(false);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(location.search).get("complex") ?? "");
  const [detailError, setDetailError] = useState("");
  const { saved, toggle: toggleSaved, storageError } = useSavedEstates();
  const [compare, setCompare] = useState<RealEstateItem[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const restoring = useRef(false);
  const firstUrl = useRef(true);
  const previousNavigation = useRef("");
  const [hovered, setHovered] = useState<RealEstateItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    api
      .realEstateRegions()
      .then((r) => { setRegions(r.sido); setRegionsError(false); })
      .catch(() => setRegionsError(true));
  }, [retry]);

  const sidoNode = regions.find((r) => r.code === sido);
  const sggNode = sidoNode?.sgg.find((g) => g.code === sgg);
  // The selectors list 시·군·구 and 읍·면·동 in 가나다 order; the region table itself
  // arrives in 법정동코드 order.
  const byName = (a: string, b: string) => a.localeCompare(b, "ko");
  const sggOptions = useMemo(() => [...(sidoNode?.sgg ?? [])].sort((a, b) => byName(a.name, b.name)), [sidoNode]);
  const dongOptions = useMemo(() => [...(sggNode?.dongs ?? [])].sort(byName), [sggNode]);

  // A stable page size preserves the same result page when a tablet rotates.
  const sidoTop = 100;
  const requestKey = JSON.stringify([sido, sgg, dong, period, filters, page, sidoTop]);
  const [responseKey, setResponseKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setHovered(null);
    setError(null);
    if ((filters.price_min && filters.price_max && Number(filters.price_min) > Number(filters.price_max)) ||
        (filters.area_min && filters.area_max && Number(filters.area_min) > Number(filters.area_max))) {
      setError("최소값은 최대값보다 작거나 같아야 합니다. 가격·면적 조건을 확인해 주세요.");
      setLoading(false);
      return () => controller.abort();
    }
    const load = (first: boolean) => {
      if (first) setLoading(true);
      const params = new URLSearchParams({ sido, period, offset: String(page * sidoTop), limit: String(sidoTop) });
      if (sgg) params.set("sgg", sgg);
      if (sgg && dong) params.set("dong", dong);
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      api
        .realEstateExplore(params, controller.signal)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setResponseKey(requestKey);
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
    timer = window.setTimeout(() => load(true), 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, retry]);

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
  }, [view, loading, data?.items.length]);

  const items = responseKey === requestKey ? data?.items ?? [] : [];

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
  const tradedCount = items.filter((it) => it.trades > 0).length;

  /** A click or tap on a complex pins its card (a sheet on touch screens, a dialog on
   * a desktop), where its 평형 can be switched and moving into its region is a
   * button. On a desktop the hover card still previews it. */
  const touchUi = useMediaQuery("(hover: none), (pointer: coarse)");
  /** Tablets and phones stack the region map above the treemap (styles.css, 980px). */
  const stacked = useMediaQuery("(max-width: 980px)");
  const mainRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  /** The phone's breadcrumb bar sends the reader back up to the three selectors. */
  const revealFilters = () => {
    const el = filtersRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: reduce ? "auto" : "smooth" });
  };
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
  // is remembered. A phone that has never chosen starts with it folded, so the
  // treemap — the page's reason to exist — is in the first screen rather than
  // under a 320px 3D stage.
  const [regionMapOpen, setRegionMapOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem("re_region_map");
      if (saved) return saved !== "closed";
    } catch {
      /* private mode: fall through to the default */
    }
    return !window.matchMedia("(max-width: 760px)").matches;
  });
  /** Only a reader's own toggle is remembered, never the phone default above. */
  const toggleRegionMap = () => {
    const next = !regionMapOpen;
    setRegionMapOpen(next);
    try {
      window.localStorage.setItem("re_region_map", next ? "open" : "closed");
    } catch {
      /* private mode: the choice lasts this visit */
    }
  };
  const [sheetItem, setSheetItem] = useState<RealEstateItem | null>(null);
  const closeSheet = (restoreHistory = true) => {
    if (restoreHistory && selectedId && window.history.state?.reDetailFromMap) { window.history.back(); return; }
    setSelectedId(""); setSheetItem(null); setDetailError("");
  };
  useEffect(() => {
    const pop = () => {
      restoring.current = true;
      const next = readQuery(); const q = new URLSearchParams(location.search);
      setSido(next.sido); setSgg(next.sgg); setDong(next.dong); setPeriod(next.period);
      setFilters(readEstateFilters()); setPage(Math.max(0, Number(q.get("page")) || 0));
      setView(q.get("view") === "table" ? "table" : "map");
      setSelectedId(q.get("complex") ?? ""); setSheetItem(null); setDetailError("");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (restoring.current) { restoring.current = false; previousNavigation.current = JSON.stringify([sido, sgg, dong, period, view, page, selectedId]); return; }
    const q = new URLSearchParams(location.search);
    const oldComplex = q.get("complex") ?? "";
    q.set("sido", sido); q.set("period", period);
    if (sgg) q.set("sgg", sgg); else q.delete("sgg");
    if (sgg && dong) q.set("dong", dong); else q.delete("dong");
    if (view === "table") q.set("view", view); else q.delete("view");
    if (page) q.set("page", String(page)); else q.delete("page");
    Object.entries(filters).forEach(([key, value]) => { if (value && value !== FILTER_DEFAULTS[key as keyof typeof filters]) q.set(key, value); else q.delete(key); });
    if (selectedId) q.set("complex", selectedId); else q.delete("complex");
    if (oldComplex !== selectedId) { q.delete("area"); q.delete("mode"); }
    const url = `${location.pathname}?${q}`;
    if (url !== `${location.pathname}${location.search}`) {
      const state = { ...window.history.state, reDetailFromMap: !!selectedId && (!oldComplex || !!window.history.state?.reDetailFromMap) };
      if (firstUrl.current || (oldComplex && !selectedId) || previousNavigation.current === JSON.stringify([sido, sgg, dong, period, view, page, selectedId])) window.history.replaceState(state, "", url);
      else window.history.pushState(state, "", url);
    }
    firstUrl.current = false;
    previousNavigation.current = JSON.stringify([sido, sgg, dong, period, view, page, selectedId]);
  }, [sido, sgg, dong, period, view, filters, page, selectedId]);
  useEffect(() => {
    if (!sidoNode || (sgg && !sggNode)) return;
    try { localStorage.setItem("re_last_region", JSON.stringify({ sido, sgg, dong })); } catch { /* optional preference */ }
  }, [sido, sgg, dong, sidoNode, sggNode]);
  useEffect(() => {
    if (!selectedId || sheetItem?.id === selectedId) return;
    let cancelled = false;
    setDetailError("");
    api.realEstateComplex(selectedId, period).then(res => {
      if (!cancelled && res.item) setSheetItem(res.item);
      else if (!cancelled) setDetailError("이 단지의 상세 정보를 찾지 못했습니다.");
    }).catch(() => { if (!cancelled) setDetailError("단지 정보를 불러오지 못했습니다. 다시 시도해 주세요."); });
    return () => { cancelled = true; };
  }, [selectedId, sheetItem?.id, period, retry]);
  const toggleCompare = (item: RealEstateItem) => {
    if (compare.some(x => x.id === item.id)) { setCompare(compare.filter(x => x.id !== item.id)); return; }
    if (compare.length >= 3) { setNotice("비교는 최대 3개까지 가능합니다. 기존 단지를 제외한 뒤 추가해 주세요."); return; }
    setCompare([...compare, item]); setNotice(`${item.name}을 비교에 추가했습니다.`);
  };

  /** Where a click on this complex leads, as a button label — null at 동 level. */
  const drillLabel = (item: RealEstateItem): string | null =>
    item.id.split(":")[0] !== sgg ? `${item.sgg} 지도로 이동` : item.dong !== dong ? `${item.dong} 지도로 이동` : null;

  const openItem = (item: RealEstateItem) => {
    setHovered(null);
    setSelectedId(item.id);
    setSheetItem(item);
  };

  /** A tile or a group drills one level down: 시·도 → 시·군·구 → 읍·면·동. */
  const drill = (item: RealEstateItem | null, group?: string) => {
    if (!sidoNode) return;
    setPage(0);
    if (item && item.id.split(":")[0] !== sgg) {
      const code = item.sgg_code ?? item.id.split(":")[0];
      const target = regions.find(r => r.sgg.some(g => g.code === code));
      if (target) { setSido(target.code); setSgg(code); setDong(""); setFilters({ ...FILTER_DEFAULTS }); }
      return;
    }
    if (!sgg) {
      const name = item?.sgg ?? group;
      const target = sidoNode.sgg.find((g) => g.name === name);
      if (target) {
        setSgg(target.code);
        setDong("");
      }
    } else if (!dong || item) {
      const name = item?.dong ?? group;
      if (name) setDong(name);
    }
    setHovered(null);
  };

  const levelLabel = dong || sggNode?.name || sidoNode?.name || "";
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
      clickHint: "선택하면 평형별 상세 보기",
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
          taglineKo: "아파트 실거래 탐색 — 타일 크기는 기준가, 색은 등락",
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
                {levelLabel} · 조건에 맞는 아파트 {data?.matched_count?.toLocaleString() ?? "—"}개
                {data?.latest_deal_date && <span className="kospi-map-updated"> · 최근 계약일 {dateDots(data.latest_deal_date)}</span>}
              </p>
            </div>
            <div className="kospi-map-view-toggle">
              {/* One button, to the view not on screen. */}
              {view === "map" ? (
                <button type="button" onClick={() => setView("table")}>
                  표로 보기
                </button>
              ) : (
                <button type="button" onClick={() => setView("map")}>
                  맵 보기
                </button>
              )}
              <MapExportButtons exp={mapExport} disabled={zones.length === 0} />
              <button type="button" disabled={!items.length || loading} onClick={() => csvDownload(items, levelLabel, periodInfo.label, data?.generated_at ?? "")}>CSV 저장</button>
            </div>
          </div>
        </div>

        {(error || regionsError) && <div className="error-state" role="alert">{regionsError ? "지역 목록을 불러오지 못했습니다." : error}<button type="button" onClick={() => setRetry(x => x + 1)}>다시 시도</button></div>}
        {status && !status.configured && (
          <div className="error-state re-map-notice">
            실시간 자료 연결이 준비되지 않아 저장된 자료를 표시합니다. 기준 거래일을 확인해 주세요.
          </div>
        )}
        <details className="re-saved-shelf"><summary>관심 단지 <b>{saved.length}</b><span>이 브라우저에 저장</span></summary>
          {saved.length ? <div className="re-saved-list">{saved.map(item => <div key={item.id}><button type="button" onClick={() => openItem(item)}>{item.name}<small>{item.sgg} {item.dong} · 전용 {item.area}㎡</small></button><button type="button" aria-label={`${item.name} 관심 해제`} onClick={() => toggleSaved(item)}>해제</button></div>)}</div> : <p>단지 상세나 목록에서 ☆ 관심을 눌러 다시 찾을 단지를 저장하세요.</p>}
          {storageError && <p role="status">{storageError}</p>}
        </details>
        {(notice || detailError) && <div className="re-feedback" role="status">{detailError || notice}{detailError && <><button type="button" onClick={() => setRetry(x => x + 1)}>다시 시도</button><button type="button" onClick={() => closeSheet()}>닫기</button></>}</div>}
        {selectedId && !sheetItem && !detailError && <p role="status">단지 상세를 불러오는 중… <button type="button" onClick={() => closeSheet()}>취소</button></p>}

        <div className={`kospi-map-workspace${view === "table" ? " is-table" : ""}`}>
          <aside className="kospi-map-period-rail re-map-rail" aria-label="조회 기간과 지역 지도">
            <div className="kospi-map-period-head">
              <small>REAL TRADES</small>
              <strong>조회 기간</strong>
            </div>
            <div className="kospi-map-period-options">
              {PERIODS.map((option) => (
                <label key={option.key} className={period === option.key ? "active" : ""}>
                  <input type="radio" name="re-period" checked={period === option.key} onChange={() => { setPeriod(option.key); setPage(0); }} />
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
                onClick={toggleRegionMap}
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
                      setPage(0);
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
                  : `표시 ${items.length.toLocaleString()}곳 · 기간 거래 ${tradedCount}곳 · 등락 비교 ${movedCount}곳`}
              {status?.error && status.collecting && <div className="re-map-status-error">최근 오류: {status.error}</div>}
            </div>
            <p className="kospi-map-period-note">
              기준가는 마지막 유효 거래일 이전 90일 안의 최대 3건 중간값입니다. 오래된 거래도 포함될 수 있습니다. 중개거래가 없으면 직거래 참고값을 사용합니다. 기간 전 자료가 없으면 기간 내 최초 거래와 비교하며, 계약 해제는 제외합니다.
            </p>
          </aside>

          <div className="kospi-map-workspace-main" ref={mainRef}>
            <div className="kospi-map-legend re-map-legend" ref={filtersRef}>
              <div className="kospi-map-legend-info">
                <span className="kospi-map-legend-label">하락</span>
                <span className="kospi-map-legend-bar" />
                <span className="kospi-map-legend-label">상승</span>
                <span className="kospi-map-legend-scale">±10% · 회색 = 기간 거래 없음 / 비교 기준 부족</span>
              </div>
              <div className="re-map-filters">
                <label className="kospi-map-sector-filter">
                  <span className="kospi-map-sector-filter-label">시·도</span>
                  <select
                    value={sido}
                    onChange={(e) => {
                      setSido(e.target.value);
                      setPage(0);
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
                      setPage(0);
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
                  <select value={dong} onChange={(e) => { setDong(e.target.value); setPage(0); }} disabled={!sgg} aria-label="읍·면·동">
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

            <RealEstateExploreControls filters={filters} busy={loading} onChange={value => { setFilters(value); setPage(0); }} />
            <div className="re-results-summary" aria-live="polite" aria-busy={loading}>
              {loading ? "실거래 자료를 조회하고 있습니다…" : `${data?.matched_count?.toLocaleString() ?? 0}개 검색 결과 · 현재 ${items.length}개 표시`}
              {data?.generated_at && <small>자료 생성 {new Date(data.generated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small>}
            </div>
            {!loading && !items.length && !error && <div className="re-explore-empty"><strong>{status?.collecting ? "이 지역의 자료를 수집하고 있습니다" : "현재 조건에 맞는 단지가 없습니다"}</strong><p>검색 지역을 넓히거나 가격·면적 조건을 줄여 보세요. 미수집 자료는 결과에 포함되지 않습니다.</p><button type="button" onClick={() => { setFilters({ ...FILTER_DEFAULTS }); setPage(0); }}>조건 초기화</button>{sgg && <button type="button" onClick={() => { setSgg(""); setDong(""); setPage(0); }}>시·도 전체 검색</button>}</div>}

            {/* Phones only (maps.css): pinned over the treemap while it scrolls, so
                the region in view stays named and each level above it is one tap
                away — the selectors that do the same sit a screen further up. */}
            {sidoNode && (
              <nav className="re-map-crumbs" aria-label="현재 지역">
                <span className="re-map-crumbs-path">
                  <button
                    type="button"
                    disabled={!sgg}
                    onClick={() => {
                      setPage(0);
                      setSgg("");
                      setDong("");
                    }}
                  >
                    {sidoNode.name}
                  </button>
                  {sggNode && (
                    <>
                      <i aria-hidden="true">›</i>
                      <button type="button" disabled={!dong} onClick={() => { setDong(""); setPage(0); }}>
                        {sggNode.name}
                      </button>
                    </>
                  )}
                  {sgg && dong && (
                    <>
                      <i aria-hidden="true">›</i>
                      <b aria-current="location">{dong}</b>
                    </>
                  )}
                </span>
                <span className="re-map-crumbs-period">{periodInfo.label}</span>
                <button type="button" className="re-map-crumbs-change" onClick={revealFilters}>
                  지역 변경
                </button>
              </nav>
            )}

            {view === "map" && (loading || items.length > 0) && (
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
                            aria-label={`${it.name}, 전용 ${it.area}제곱미터, ${fullPrice(it.price)}, ${tradeState(it)}. 상세 보기`}
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

            {view === "table" && !loading && items.length > 0 && <RealEstateResults items={items} saved={saved} compared={compare} onOpen={openItem} onSave={toggleSaved} onCompare={toggleCompare} />}
            {(data?.matched_count ?? 0) > sidoTop && <nav className="re-pagination" aria-label="검색 결과 페이지">
              <button type="button" disabled={loading || page === 0} onClick={() => { setPage(p => p - 1); revealTreemap(); }}>이전</button>
              <span>{page + 1} / {Math.ceil((data?.matched_count ?? 0) / sidoTop)} 페이지</span>
              <button type="button" disabled={loading || (page + 1) * sidoTop >= (data?.matched_count ?? 0)} onClick={() => { setPage(p => p + 1); revealTreemap(); }}>다음</button>
            </nav>}
            <p className="re-map-source">
              자료: 국토교통부 아파트 매매 실거래가. 타일 크기는 선택 평형의 실거래 기준가이며 단지 전체 자산가치가 아닙니다. 그룹 등락은 현재 표시 단지의 가격 가중 평균으로 전체 지역 집계와 다를 수 있습니다. 최근 계약은 신고 지연으로 누락될 수 있습니다. 브랜드는 단지명 기준 자동 분류이며 로고 출처는 Wikimedia Commons(힐스테이트·우미린 CC BY-SA) 및 각 사 공식 사이트입니다.
            </p>
          </div>
        </div>

        {sheetItem && (
          <RealEstateSheet
            key={sheetItem.id}
            item={sheetItem}
            ctx={popupContext(sheetItem)}
            period={period}
            goLabel={drillLabel(sheetItem)}
            onGo={() => {
              const item = sheetItem;
              closeSheet(false);
              drill(item);
            }}
            onClose={closeSheet}
            saved={saved.some(x => x.id === sheetItem.id)}
            compared={compare.some(x => x.id === sheetItem.id)}
            onSave={toggleSaved}
            onCompare={toggleCompare}
            feedback={notice || storageError}
          />
        )}
        {hovered && !touchUi && !sheetItem && (
          <FloatingTip
            className="kospi-map-tooltip re-pop-tip"
            portalClassName="d2 mm app kospi-map-page re-map-page re-sheet-portal"
            x={hoverPos.x}
            y={hoverPos.y}
          >
            <RealEstatePopup item={hovered} ctx={popupContext(hovered)} />
          </FloatingTip>
        )}
        {compare.length > 0 && <div className="re-compare-tray" aria-label="비교할 단지"><span>{compare.length} / 3 선택</span><div>{compare.map(item => <button type="button" key={item.id} aria-label={`${item.name} 비교 제외`} onClick={() => setCompare(compare.filter(x => x.id !== item.id))}>{item.name} ×</button>)}</div><button type="button" className="re-primary" onClick={() => setCompareOpen(true)}>비교하기</button></div>}
        {compareOpen && compare.length > 0 && <RealEstateCompare items={compare} period={period} onClose={() => setCompareOpen(false)} onRemove={id => { setCompare(compare.filter(x => x.id !== id)); if (compare.length === 1) setCompareOpen(false); }} />}
        <MapPreviewModal exp={mapExport} />
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
