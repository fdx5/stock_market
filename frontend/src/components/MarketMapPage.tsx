import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { MarketMapItem } from "../api/client";
import { wonSuffix } from "../i18n/format";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { loadStockIconUrl } from "../stockIcon";
import { useThemeMode } from "../theme";
import { TreemapRect, changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";
import { useDocumentTitle } from "../useDocumentTitle";
import Footer from "./Footer";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketTickerBar from "./MarketTickerBar";
import StockIcon from "./StockIcon";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";

interface SectorZone {
  sector: string;
  rect: TreemapRect;
  headerH: number;
  avgChangePct: number;
  tiles: (TreemapRect & { item: MarketMapItem })[];
}

function formatMarcap(marcap: number, lang: Lang): string {
  const eok = marcap / 100_000_000;
  if (lang === "en") {
    if (eok >= 10_000) return `${(eok / 10_000).toFixed(1)}T KRW`;
    return `${(eok / 10).toFixed(1)}B KRW`;
  }
  if (eok >= 10_000) return `${(eok / 10_000).toFixed(1)}조원`;
  return `${Math.round(eok).toLocaleString()}억원`;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

const TILE_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', sans-serif";
let measureCtx: CanvasRenderingContext2D | null | undefined;

// Resolves any CSS color expression (var(), color-mix(), etc.) to its rendered
// rgb/rgba string by letting the browser compute it on a throwaway element —
// avoids hand-duplicating the theme's color formulas for the PNG export below.
function resolveCssColor(value: string): string {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return resolved;
}

// Binary-searches the longest text-plus-ellipsis that still fits maxWidth, mirroring
// the CSS text-overflow:ellipsis the on-screen tiles get for free — canvas text has
// no such primitive, so the map PNG export needs it done by hand.
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : "";
}

function downloadTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Sentinel for the sector filter's "show everything" option — distinct from any real
// sector label (including "기타") so it can never collide with backend-assigned data.
const ALL_SECTORS = "__all__";

// Used to decide whether a tile has room to show its company icon: only when the name
// still fits at full length (no CSS ellipsis) after making room for the icon, so the
// icon never pushes a name into truncation.
function measureTextWidth(text: string, fontSizePx: number, weight = 700): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * fontSizePx * 0.6;
  measureCtx.font = `${weight} ${fontSizePx}px ${TILE_FONT_FAMILY}`;
  return measureCtx.measureText(text).width;
}

// Scales name/pct text with how much area the tile actually has, instead of a single
// fixed size for every tile that clears the "show text" threshold — a tile many times
// larger than another (e.g. Samsung vs. a mid-cap name) reads noticeably larger too.
function tileFontSizes(w: number, h: number): { name: number; pct: number } {
  const minDim = Math.min(w, h);
  const name = Math.min(26, 11 + Math.max(0, minDim - 30) * 0.09);
  const pctSize = Math.min(19, 10 + Math.max(0, minDim - 30) * 0.07);
  return { name, pct: pctSize };
}

// Shared by the on-screen tile render and the PNG export below, so both ever agree
// on which tiles show a name/pct/icon and at what size — duplicating these thresholds
// risks the export silently drifting from what the map actually displays.
function tileDisplayInfo(w: number, h: number, name: string) {
  const showName = w >= 46 && h >= 30;
  const showPctOnly = !showName && w >= 24 && h >= 16;
  const fontSizes = tileFontSizes(w, h);
  const iconSize = Math.round(fontSizes.name);
  const TILE_H_PADDING = 10; // .kospi-map-tile's 5px left/right padding
  const ICON_GAP = 4;
  const availableWithIcon = w - TILE_H_PADDING - iconSize - ICON_GAP;
  // Only worth showing the icon when the name still fits at full length afterward —
  // a truncated "Sam… 🏷" reads worse than no icon at all.
  const showIcon = showName && measureTextWidth(name, fontSizes.name) <= availableWithIcon;
  return { showName, showPctOnly, fontSizes, showIcon, iconSize, iconGap: ICON_GAP };
}

// Shares the same cached-icon-URL resolution as the on-screen <StockIcon> tiles (see
// ../stockIcon.ts), so exporting the PNG never re-fetches a logo the map has already
// loaded. crossOrigin="anonymous" is needed for the direct-URL fallback (Cache Storage
// unavailable) to keep the export canvas untainted; it's a no-op for the common case
// where loadStockIconUrl already resolved to a same-origin blob: URL.
const iconImageCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadIconImage(code: string): Promise<HTMLImageElement | null> {
  let cached = iconImageCache.get(code);
  if (!cached) {
    cached = loadStockIconUrl(code).then(
      (url) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = url;
        })
    );
    iconImageCache.set(code, cached);
  }
  return cached;
}

export interface MarketMapPageProps {
  pageTitle: string;
  loadingLabel: string;
  subtitlePrefix: string;
  /** Downloaded PNG filename prefix, e.g. "kospi" -> kospi_MMDDHHmmss.png */
  filePrefix: string;
  fetchMap: (limit: number, fresh?: boolean) => Promise<{ generated_at: string; count: number; items: MarketMapItem[] }>;
  /** Rank 1..tier1Limit refreshes every 10s, tier1Limit+1..tier2Limit every 30s, the
   * rest (up to fullLimit) every 1min — matches the backend's cache TTL tiers. */
  tier1Limit: number;
  tier2Limit: number;
  fullLimit: number;
  /** Extra nav links shown next to the live badge (besides the back-link and visitor badge). */
  navLinks: { to: string; label: string; icon?: ReactNode; className?: string }[];
}

// Shared by KospiMapPage and KosdaqMapPage — both are a Finviz-style sector treemap over
// a ranked market-cap snapshot, differing only in data source, rank-tier sizes, and
// header copy. CSS classes below keep the "kospi-map-*" naming from when this was KOSPI
// MAP-only; they're generic layout hooks now, shared by both markets.
export default function MarketMapPage({
  pageTitle,
  loadingLabel,
  subtitlePrefix,
  filePrefix,
  fetchMap,
  tier1Limit,
  tier2Limit,
  fullLimit,
  navLinks,
}: MarketMapPageProps) {
  const { lang } = useLanguage();
  const t = useT();
  const themeMode = useThemeMode();
  useDocumentTitle("K-Stock Hub");

  const [items, setItems] = useState<MarketMapItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "table">("map");
  const [selectedSector, setSelectedSector] = useState<string>(ALL_SECTORS);
  const [hovered, setHovered] = useState<MarketMapItem | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mapPreview, setMapPreview] = useState<{ blob: Blob; url: string; filename: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const TIER1_REFRESH_MS = 10_000;
  const TIER2_REFRESH_MS = 30_000;
  const FULL_REFRESH_MS = 60_000;

  useEffect(() => {
    let cancelled = false;

    const mergeItems = (prev: MarketMapItem[], fresh: MarketMapItem[]): MarketMapItem[] => {
      const byCode = new Map(prev.map((it) => [it.code, it]));
      for (const item of fresh) byCode.set(item.code, item);
      return Array.from(byCode.values());
    };

    // Only the very first load shows the loading state — refreshes swap the data in
    // place so the map keeps rendering the previous snapshot instead of flashing empty.
    // Every load (including the first) passes fresh=false to reuse the backend's
    // stale-while-revalidate cache: forcing a synchronous re-scrape of up to hundreds
    // of Naver pages on every page entry (fresh=isInitial, the previous behavior) could
    // block a request thread for 10s+, and on the single-worker free-tier deploy that
    // was enough concurrent page entries to exhaust the thread pool and stall every
    // other request site-wide. The 10-60s tiered TTLs already keep data close to live.
    const loadPartial = (limit: number, isInitial: boolean) => {
      if (isInitial) setLoading(true);

      fetchMap(limit, false)
        .then((res) => {
          if (cancelled) return;
          setItems((prev) => mergeItems(prev, res.items));
          setGeneratedAt(res.generated_at);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          if (isInitial) setError(err.message || "데이터를 불러오지 못했습니다.");
          // A failed background refresh keeps showing the last good snapshot rather
          // than replacing a working map with an error screen.
        })
        .finally(() => {
          if (isInitial && !cancelled) setLoading(false);
        });
    };

    const loadFullList = () => {
      fetchMap(fullLimit, false)
        .then((res) => {
          if (cancelled) return;
          // The full snapshot is authoritative (unlike the partial tiers above), so it
          // replaces state outright — that's also what drops names that fell off the tail.
          setItems(res.items);
          setGeneratedAt(res.generated_at);
        })
        .catch(() => {
          // Long-tail refresh failing quietly keeps whatever is already on screen.
        });
    };

    loadPartial(tier1Limit, true);
    loadPartial(tier2Limit, true);
    loadFullList();

    const stopTier1 = startVisibilityAwareInterval(() => loadPartial(tier1Limit, false), TIER1_REFRESH_MS);
    const stopTier2 = startVisibilityAwareInterval(() => loadPartial(tier2Limit, false), TIER2_REFRESH_MS);
    const stopFull = startVisibilityAwareInterval(() => loadFullList(), FULL_REFRESH_MS);

    return () => {
      cancelled = true;
      stopTier1();
      stopTier2();
      stopFull();
    };
  }, [fetchMap, tier1Limit, tier2Limit, fullLimit]);

  useEffect(() => {
    if (!containerRef.current || view !== "map") return;
    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // `loading` is included so this re-attaches once the canvas div actually mounts
    // (it doesn't exist yet on first render, while the map data is still loading).
  }, [view, loading]);

  // Sector options are derived from the loaded data (not the fixed backend keyword
  // list) so the dropdown only ever offers sectors that actually have stocks in the
  // current snapshot, ordered the same way the unfiltered map groups its zones
  // (by total market cap) so the list reads largest-sector-first.
  const sectorOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) {
      totals.set(item.sector, (totals.get(item.sector) ?? 0) + item.marcap);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([sector]) => sector);
  }, [items]);

  const visibleItems = useMemo(
    () => (selectedSector === ALL_SECTORS ? items : items.filter((it) => it.sector === selectedSector)),
    [items, selectedSector]
  );

  const sectorZones = useMemo<SectorZone[]>(() => {
    if (visibleItems.length === 0 || size.w === 0 || size.h === 0) return [];

    const bySector = new Map<string, MarketMapItem[]>();
    for (const item of visibleItems) {
      const list = bySector.get(item.sector) ?? [];
      list.push(item);
      bySector.set(item.sector, list);
    }

    const sectorInputs = Array.from(bySector.entries())
      .map(([sector, list]) => ({
        sector,
        stocks: list.sort((a, b) => b.marcap - a.marcap),
        totalMarcap: list.reduce((sum, it) => sum + it.marcap, 0),
      }))
      .sort((a, b) => b.totalMarcap - a.totalMarcap);

    const sectorRects = squarify(
      sectorInputs.map((s) => ({ id: s.sector, value: s.totalMarcap })),
      0,
      0,
      size.w,
      size.h
    );

    return sectorRects.map((rect) => {
      const group = sectorInputs.find((s) => s.sector === rect.id)!;
      const headerH = rect.h > 46 ? 20 : 0;
      const pad = rect.w > 6 && rect.h - headerH > 6 ? 1 : 0;
      const innerRects = squarify(
        group.stocks.map((s) => ({ id: s.code, value: s.marcap })),
        rect.x + pad,
        rect.y + headerH,
        Math.max(rect.w - pad * 2, 0),
        Math.max(rect.h - headerH - pad, 0)
      );
      const byCode = new Map(group.stocks.map((s) => [s.code, s]));
      const weightedChange = group.stocks.reduce((sum, s) => sum + s.change_pct * s.marcap, 0);
      return {
        sector: rect.id,
        rect,
        headerH,
        avgChangePct: group.totalMarcap > 0 ? weightedChange / group.totalMarcap : 0,
        tiles: innerRects.map((t) => ({ ...t, item: byCode.get(t.id)! })),
      };
    });
  }, [visibleItems, size]);

  const totalMarcap = useMemo(() => visibleItems.reduce((sum, it) => sum + it.marcap, 0), [visibleItems]);

  const handleTileClick = (code: string) => navigate(`/?code=${code}`);

  // One batched translation request for every name currently loaded (tiles, table,
  // tooltip all read from this same array), rather than one call per row.
  const translatedNames = useTranslatedTexts(items.map((it) => it.name));
  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((it, i) => map.set(it.code, translatedNames[i] ?? it.name));
    return map;
  }, [items, translatedNames]);

  const liveBadgeText = lang === "en" ? "Live (rank-based refresh: 10s–1min)" : "실시간 (순위별 10초 ~ 1분단위 갱신)";

  // Redraws the current sector zones/tiles from scratch onto an off-screen canvas
  // instead of screenshotting the live DOM: that would need html2canvas or similar to
  // rasterize the actual tile buttons, and this way reuses the exact layout data that
  // renders the on-screen map, so the two can never visually drift apart.
  const handleDownloadMap = async () => {
    if (sectorZones.length === 0 || size.w === 0 || size.h === 0) return;

    const cardBg = resolveCssColor("var(--surface-1)");
    const gapColor = resolveCssColor("var(--map-gap)");
    const headerBg = resolveCssColor("color-mix(in srgb, var(--baseline) 35%, var(--surface-1))");
    const headerBorder = resolveCssColor("var(--gridline)");
    const textPrimary = resolveCssColor("var(--text-primary)");
    const upColor = resolveCssColor("var(--up-color)");
    const downColor = resolveCssColor("var(--down-color)");
    const sectorBorderW = themeMode === "light" ? 1 : 2;

    // Preload every tile's logo up front (same eligibility rule as the on-screen
    // render) so the draw pass below can stay synchronous once it starts.
    const iconByCode = new Map<string, HTMLImageElement>();
    await Promise.all(
      sectorZones.flatMap((zone) =>
        zone.tiles.map(async (tile) => {
          const name = nameByCode.get(tile.item.code) ?? tile.item.name;
          const { showIcon } = tileDisplayInfo(tile.w, tile.h, name);
          if (!showIcon) return;
          const img = await loadIconImage(tile.item.code);
          if (img) iconByCode.set(tile.item.code, img);
        })
      )
    );

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(size.w * scale);
    canvas.height = Math.round(size.h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);

    ctx.fillStyle = cardBg;
    ctx.fillRect(0, 0, size.w, size.h);

    for (const zone of sectorZones) {
      if (zone.headerH > 0) {
        ctx.fillStyle = headerBg;
        ctx.fillRect(zone.rect.x, zone.rect.y, zone.rect.w, zone.headerH);
        ctx.strokeStyle = headerBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(zone.rect.x, zone.rect.y + zone.headerH);
        ctx.lineTo(zone.rect.x + zone.rect.w, zone.rect.y + zone.headerH);
        ctx.stroke();

        const avgText = pct(zone.avgChangePct);
        ctx.font = `700 11px ${TILE_FONT_FAMILY}`;
        ctx.textBaseline = "middle";
        const avgWidth = ctx.measureText(avgText).width;
        const nameMaxWidth = Math.max(0, zone.rect.w - 14 - avgWidth - 6);

        ctx.fillStyle = textPrimary;
        ctx.textAlign = "left";
        ctx.fillText(truncateToWidth(ctx, t(zone.sector), nameMaxWidth), zone.rect.x + 7, zone.rect.y + zone.headerH / 2 + 1);

        ctx.fillStyle = zone.avgChangePct >= 0 ? upColor : downColor;
        ctx.textAlign = "right";
        ctx.fillText(avgText, zone.rect.x + zone.rect.w - 7, zone.rect.y + zone.headerH / 2 + 1);
        ctx.textAlign = "left";
      }

      for (const tile of zone.tiles) {
        const rgb = changeToRgb(tile.item.change_pct, themeMode);
        ctx.fillStyle = rgbToCss(rgb);
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
        ctx.strokeStyle = gapColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, Math.max(tile.w - 1, 0), Math.max(tile.h - 1, 0));

        const name = nameByCode.get(tile.item.code) ?? tile.item.name;
        const { showName, showPctOnly, fontSizes, showIcon, iconSize, iconGap } = tileDisplayInfo(
          tile.w,
          tile.h,
          name
        );
        if (!showName && !showPctOnly) continue;

        const pctText = pct(tile.item.change_pct);
        const padX = 5;
        ctx.fillStyle = textColorForRgb(rgb, themeMode);

        if (showName) {
          const icon = showIcon ? iconByCode.get(tile.item.code) : undefined;
          let textX = tile.x + padX;
          if (icon) {
            ctx.drawImage(icon, tile.x + padX, tile.y + 2, iconSize, iconSize);
            textX += iconSize + iconGap;
          }

          ctx.font = `700 ${fontSizes.name}px ${TILE_FONT_FAMILY}`;
          ctx.textBaseline = "top";
          ctx.fillText(truncateToWidth(ctx, name, tile.x + tile.w - padX - textX), textX, tile.y + 2);

          ctx.font = `600 ${fontSizes.pct}px ${TILE_FONT_FAMILY}`;
          ctx.globalAlpha = 0.92;
          ctx.fillText(pctText, tile.x + padX, tile.y + 2 + fontSizes.name * 1.2 + 1);
          ctx.globalAlpha = 1;
        } else {
          ctx.font = `600 ${fontSizes.pct}px ${TILE_FONT_FAMILY}`;
          ctx.textBaseline = "middle";
          ctx.fillText(pctText, tile.x + padX, tile.y + tile.h / 2);
        }
      }

      ctx.strokeStyle = gapColor;
      ctx.lineWidth = sectorBorderW;
      ctx.strokeRect(
        zone.rect.x + sectorBorderW / 2,
        zone.rect.y + sectorBorderW / 2,
        Math.max(zone.rect.w - sectorBorderW, 0),
        Math.max(zone.rect.h - sectorBorderW, 0)
      );
    }

    // Blob (rather than a data: URL) is required for the mobile save path below:
    // iOS Safari and in-app browsers (KakaoTalk, Naver, etc.) silently ignore
    // <a download> on data: URLs, so the "download" never actually saves a file there.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    setMapPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { blob, url: URL.createObjectURL(blob), filename: `${filePrefix}_${downloadTimestamp()}.png` };
    });
  };

  const closeMapPreview = () => {
    setMapPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const confirmMapDownload = async () => {
    if (!mapPreview) return;
    const { blob, filename } = mapPreview;

    // On mobile, an <a download> click on its own frequently just opens the image
    // instead of saving it (no filesystem access from the browser sandbox). The Web
    // Share API's native share sheet lets the user save straight to Photos/Files, so
    // prefer it whenever the platform can share a file; fall back to the anchor trick
    // for desktop browsers and any mobile browser without file-sharing support.
    if (typeof navigator.canShare === "function" && typeof navigator.share === "function") {
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          // Share failed for a non-cancel reason (e.g. no share target for images) —
          // fall through to the anchor-download path below.
        }
      }
    }

    const a = document.createElement("a");
    a.href = mapPreview.url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="app kospi-map-page">
      <header className="app-header">
        <div className="app-title-row">
          <Link to="/" className="app-brand" aria-label="K-Stock Hub">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`kospi-map-nav-link${link.className ? ` ${link.className}` : ""}`}
            >
              {link.icon}
              {t(link.label)}
            </Link>
          ))}
          <VisitorBadge />
        </div>
        <div className="kospi-map-titlebar">
          <div>
            <div className="app-title-row">
              <h1 className="app-title">{pageTitle}</h1>
              <span className="kospi-map-live-badge">
                <span className="kospi-map-live-dot" />
                {liveBadgeText}
              </span>
            </div>
            <p className="app-subtitle">
              {t(subtitlePrefix)} {t("종목 MAP")}
              {generatedAt && (
                <span className="kospi-map-updated">
                  {lang === "en"
                    ? ` · as of ${generatedAt.replace("T", " ")}`
                    : ` · ${generatedAt.replace("T", " ")} 기준`}
                </span>
              )}
            </p>
          </div>
          <div className="kospi-map-view-toggle">
            <button type="button" className={view === "map" ? "active" : ""} onClick={() => setView("map")}>
              {t("맵 보기")}
            </button>
            <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>
              {t("표로 보기")}
            </button>
            <button
              type="button"
              className="kospi-map-download-btn"
              onClick={handleDownloadMap}
              disabled={sectorZones.length === 0}
            >
              {t("MAP 다운로드")}
            </button>
          </div>
        </div>
      </header>

      <MarketTickerBar />

      {loading && <div className="loading-state">{t(loadingLabel)}</div>}
      {error && <div className="error-state">{t(error)}</div>}

      {!loading && !error && (
        <>
          <div className="kospi-map-legend">
            <div className="kospi-map-legend-info">
              <span className="kospi-map-legend-label">{t("하락")}</span>
              <span className="kospi-map-legend-bar" />
              <span className="kospi-map-legend-label">{t("상승")}</span>
              <span className="kospi-map-legend-scale">{t("-5% ~ +5% 기준 포화")}</span>
            </div>
            <label className="kospi-map-sector-filter">
              <span className="kospi-map-sector-filter-label">{t("업종")}</span>
              <select
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                aria-label={t("업종")}
              >
                <option value={ALL_SECTORS}>{t("전체")}</option>
                {sectorOptions.map((sector) => (
                  <option key={sector} value={sector}>
                    {t(sector)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {view === "map" && (
            <div className="card kospi-map-canvas" ref={containerRef}>
              {sectorZones.map((zone) => (
                <div
                  key={zone.sector}
                  className="kospi-map-sector"
                  style={{ left: zone.rect.x, top: zone.rect.y, width: zone.rect.w, height: zone.rect.h }}
                >
                  {zone.headerH > 0 && (
                    <div className="kospi-map-sector-header" style={{ height: zone.headerH }}>
                      <span className="kospi-map-sector-name">{t(zone.sector)}</span>
                      <span
                        className="kospi-map-sector-avg"
                        style={{ color: zone.avgChangePct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
                      >
                        {pct(zone.avgChangePct)}
                      </span>
                    </div>
                  )}
                  {zone.tiles.map((tile) => {
                    const rgb = changeToRgb(tile.item.change_pct, themeMode);
                    const bg = rgbToCss(rgb);
                    const textColor = textColorForRgb(rgb, themeMode);
                    const localX = tile.x - zone.rect.x;
                    const localY = tile.y - zone.rect.y;
                    const name = nameByCode.get(tile.item.code) ?? tile.item.name;
                    const { showName, showPctOnly, fontSizes, showIcon, iconSize } = tileDisplayInfo(
                      tile.w,
                      tile.h,
                      name
                    );
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        className="kospi-map-tile"
                        style={{
                          left: localX,
                          top: localY,
                          width: tile.w,
                          height: tile.h,
                          background: bg,
                          color: textColor,
                        }}
                        onClick={() => handleTileClick(tile.item.code)}
                        onMouseEnter={(e) => {
                          setHovered(tile.item);
                          setHoverPos({ x: e.clientX, y: e.clientY });
                        }}
                        onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHovered(null)}
                      >
                        {showName && (
                          <>
                            <span className="kospi-map-tile-name-row">
                              {showIcon && (
                                <StockIcon
                                  className="kospi-map-tile-icon"
                                  style={{ width: iconSize, height: iconSize }}
                                  code={tile.item.code}
                                />
                              )}
                              <span className="kospi-map-tile-name" style={{ fontSize: fontSizes.name }}>
                                {name}
                              </span>
                            </span>
                            <span className="kospi-map-tile-pct" style={{ fontSize: fontSizes.pct }}>
                              {pct(tile.item.change_pct)}
                            </span>
                          </>
                        )}
                        {showPctOnly && (
                          <span className="kospi-map-tile-pct" style={{ fontSize: fontSizes.pct }}>
                            {pct(tile.item.change_pct)}
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
              <table className="kospi-map-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("종목명")}</th>
                    <th>{t("업종")}</th>
                    <th>{t("시가총액")}</th>
                    <th>{t("현재가")}</th>
                    <th>{t("등락률")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item, idx) => (
                    <tr key={item.code} onClick={() => handleTileClick(item.code)}>
                      <td>{idx + 1}</td>
                      <td className="kospi-map-table-name">
                        {nameByCode.get(item.code) ?? item.name} <span className="top100-code">{item.code}</span>
                      </td>
                      <td>{t(item.sector)}</td>
                      <td>{formatMarcap(item.marcap, lang)}</td>
                      <td>{item.close.toLocaleString()}{wonSuffix(lang)}</td>
                      <td style={{ color: item.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                        {pct(item.change_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {hovered && (
        <div className="kospi-map-tooltip" style={{ left: hoverPos.x + 16, top: hoverPos.y + 16 }}>
          <div className="kospi-map-tooltip-title">
            {nameByCode.get(hovered.code) ?? hovered.name} <span className="top100-code">{hovered.code}</span>
          </div>
          <div className="kospi-map-tooltip-row">{t("업종")} {t(hovered.sector)}</div>
          <div className="kospi-map-tooltip-row">{t("시가총액")} {formatMarcap(hovered.marcap, lang)}</div>
          <div className="kospi-map-tooltip-row">{t("현재가")} {hovered.close.toLocaleString()}{wonSuffix(lang)}</div>
          <div
            className="kospi-map-tooltip-row"
            style={{ color: hovered.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
          >
            {t("등락")} {hovered.change >= 0 ? "+" : ""}
            {hovered.change.toLocaleString()}{wonSuffix(lang)} ({pct(hovered.change_pct)})
          </div>
          <div className="kospi-map-tooltip-row">
            {t("맵 면적 비중")} {totalMarcap > 0 ? ((hovered.marcap / totalMarcap) * 100).toFixed(2) : "0.00"}%
          </div>
        </div>
      )}

      {mapPreview && (
        <div className="kospi-map-preview-overlay" onClick={closeMapPreview}>
          <div
            className="kospi-map-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("맵 이미지 미리보기")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kospi-map-preview-header">
              <span>{t("맵 이미지 미리보기")}</span>
              <button type="button" className="kospi-map-preview-close" onClick={closeMapPreview} aria-label={t("닫기")}>
                ×
              </button>
            </div>
            <div className="kospi-map-preview-body">
              <img src={mapPreview.url} alt={mapPreview.filename} className="kospi-map-preview-image" />
            </div>
            <div className="kospi-map-preview-footer">
              <button type="button" className="kospi-map-preview-download" onClick={confirmMapDownload}>
                {t("다운로드")}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
