import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { MarketMapItem, MarketMapResponse, MarketSession } from "../api/client";
import { wonSuffix } from "../i18n/format";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { TILE_FONT_FAMILY, pct, tileDisplayInfo } from "../mapTile";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { loadStockIconUrl } from "../stockIcon";
import { useThemeMode } from "../theme";
import { TreemapRect, changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";
import { useDocumentTitle } from "../useDocumentTitle";
import { usCompanyLogoProxyUrl } from "../usLogo";
import DashboardIcon from "./DashboardIcon";
import Footer from "./Footer";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketTickerBar from "./MarketTickerBar";
import RankIcon from "./RankIcon";
import SessionBadge from "./SessionBadge";
import SessionSplit from "./SessionSplit";
import StockIcon from "./StockIcon";
import ThemeToggle from "./ThemeToggle";
import UsStockIcon from "./UsStockIcon";
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

// US maps have no absolute market-cap figure (see `marcap`'s meaning below) and price
// a share in dollars rather than won, so every currency-shaped display value branches
// on `market` instead of `lang` — `lang` only ever changes the UI's language, not
// which market's data is being shown.
function formatPrice(close: number, market: "kr" | "us", lang: Lang): string {
  if (market === "us") {
    return `$${close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${close.toLocaleString()}${wonSuffix(lang)}`;
}

function formatChangeAmount(change: number, market: "kr" | "us", lang: Lang): string {
  if (market === "us") {
    const sign = change >= 0 ? "+" : "-";
    return `${sign}$${Math.abs(change).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${change >= 0 ? "+" : ""}${change.toLocaleString()}${wonSuffix(lang)}`;
}

// For KR maps `marcap` is a real won figure. For US maps it's instead the
// constituent's weight (%) in its index — slickcharts doesn't expose an absolute
// market cap, but index weight is exactly the market-cap-share a cap-weighted index
// computes, so it's both an honest number to show and the right value to drive the
// treemap's tile sizing.
function formatMarcapOrWeight(marcap: number, market: "kr" | "us", lang: Lang): string {
  if (market === "us") return `${marcap.toFixed(2)}%`;
  return formatMarcap(marcap, lang);
}

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

/** iOS-family browsers, where `<a download>` opens the image in a viewer instead of
 * saving it — the one platform that genuinely needs the share sheet to get a file into
 * Photos/Files.
 *
 * A user-agent test, which is normally the wrong tool, because the thing that has to
 * be known here is not detectable: `download` is present on the anchor prototype in
 * iOS Safari and simply does not do what it says. There is nothing to feature-detect.
 *
 * iPadOS reports itself as a Mac, so it is identified by a Mac that has a touchscreen.
 */
const IS_IOS_LIKE =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// Sentinel for the sector filter's "show everything" option — distinct from any real
// sector label (including "기타") so it can never collide with backend-assigned data.
const ALL_SECTORS = "__all__";

// The TOP 100 card boards, offered beside the live badge on every map. Labels are
// left untranslated on purpose: they are the boards' own page titles ("KOSPI TOP
// 100"), which read identically in both languages.
const BOARD_LINKS = [
  { to: "/kospi-100", label: "KOSPI TOP 100" },
  { to: "/kosdaq-100", label: "KOSDAQ TOP 100" },
  { to: "/nasdaq-100", label: "NASDAQ TOP 100" },
];

// Arbitrary relative sizes for the loading skeleton's placeholder blocks - not real
// data, just enough variation for squarify to produce a plausible-looking treemap
// silhouette (one dominant block, a few mid-size ones, several small ones).
const SKELETON_SECTOR_WEIGHTS = [30, 22, 16, 12, 10, 6, 4];
const SKELETON_TABLE_ROWS = Array.from({ length: 12 }, (_, i) => i);

// Everything the export draws has to reach the canvas without tainting it, or the
// toBlob() at the end throws SecurityError and the download produces nothing. Each
// market gets there differently:
//
// - KR reuses the on-screen icon cache (../stockIcon.ts), so the export never re-fetches
//   a logo the map already loaded. crossOrigin="anonymous" covers the direct-URL
//   fallback (Cache Storage unavailable) and is a no-op for the common case, where
//   loadStockIconUrl already resolved to a same-origin blob: URL.
// - US can't reuse its on-screen URL at all: that host sends no CORS header, so the
//   image would either refuse to load (with crossOrigin set) or taint the canvas
//   (without). It goes through our own backend instead — see ../usLogo's
//   usCompanyLogoProxyUrl, which is only ever called from here.
const iconImageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    // A ticker this host has no logo for resolves to null, exactly like a KR code whose
    // icon 404s — the tile just draws its text, which is what it did before logos.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function loadIconImage(code: string, market: "kr" | "us"): Promise<HTMLImageElement | null> {
  // Keyed by market as well as code: the two resolve through different hosts, and a
  // 6-digit KR code and a US ticker sharing this map would otherwise be one entry.
  const key = `${market}:${code}`;
  let cached = iconImageCache.get(key);
  if (!cached) {
    cached = market === "us" ? loadImage(usCompanyLogoProxyUrl(code)) : loadStockIconUrl(code).then(loadImage);
    iconImageCache.set(key, cached);
  }
  return cached;
}

/** Draws `icon` into an `size`x`size` box the way CSS `object-fit: contain` would —
 * scaled to fit, centered, aspect preserved. Canvas has no such primitive: drawImage
 * with an explicit width and height stretches. That never showed on the KR maps because
 * Naver's icons are square, but the US logos are frequently wide wordmarks (FOX, Intel,
 * ASML), and stretching those into a square is both ugly and visibly different from the
 * tile the export is supposed to be reproducing. */
function drawContained(
  ctx: CanvasRenderingContext2D,
  icon: HTMLImageElement,
  x: number,
  y: number,
  size: number
): void {
  const scale = Math.min(size / icon.width, size / icon.height) || 0;
  const w = icon.width * scale;
  const h = icon.height * scale;
  ctx.drawImage(icon, x + (size - w) / 2, y + (size - h) / 2, w, h);
}

export interface MarketMapPageProps {
  pageTitle: string;
  loadingLabel: string;
  subtitlePrefix: string;
  /** Downloaded PNG filename prefix, e.g. "kospi" -> kospi_MMDDHHmmss.png */
  filePrefix: string;
  fetchMap: (limit: number, fresh?: boolean) => Promise<MarketMapResponse>;
  /** Rank 1..tier1Limit refreshes every 10s, tier1Limit+1..tier2Limit every 30s, the
   * rest (up to fullLimit) every 1min — matches the backend's cache TTL tiers. */
  tier1Limit: number;
  tier2Limit: number;
  fullLimit: number;
  /** Extra nav links shown next to the live badge (besides the back-link and visitor badge). */
  navLinks: { to: string; label: string; icon?: ReactNode; className?: string }[];
  /** "us" switches currency formatting to USD, shows the ticker (not the translated
   * company name) as each tile/table row's primary label, drops the KR-only company
   * logo and Dashboard-search-on-click behaviors, and skips the Korean-name
   * translation pass (US names are already in English). Defaults to "kr". */
  market?: "kr" | "us";
  /** Label for the marcap column/tooltip row/legend — e.g. "지수 내 비중" for US maps,
   * which show index weight rather than an absolute market cap. Defaults to "시가총액". */
  marcapLabel?: string;
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
  market = "kr",
  marcapLabel = "시가총액",
}: MarketMapPageProps) {
  const { lang } = useLanguage();
  const t = useT();
  const themeMode = useThemeMode();
  useDocumentTitle("K-Stock Hub");

  const [items, setItems] = useState<MarketMapItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  // Which US session the whole snapshot came from — the KR maps never send it, so it
  // stays undefined there and the badge below never renders.
  const [session, setSession] = useState<MarketSession | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "table">("map");
  const [selectedSector, setSelectedSector] = useState<string>(ALL_SECTORS);
  const [hovered, setHovered] = useState<MarketMapItem | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mapPreview, setMapPreview] = useState<{ blob: Blob; url: string; filename: string } | null>(null);
  // A share in flight. The ref is the one the handlers read — see confirmMapDownload
  // for why the state alone cannot close the double-tap window — and the state exists
  // only to re-render the button into its busy form.
  const sharingRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  const [mapDownloadError, setMapDownloadError] = useState<string | null>(null);
  // Navigating away with the preview open otherwise leaks the PNG for the tab's
  // lifetime. Tracked through a ref and released only on unmount: a cleanup keyed on
  // `mapPreview` would revoke the live URL on StrictMode's double-invoke in dev and
  // blank the image.
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = mapPreview?.url ?? null;
  }, [mapPreview]);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

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
          setSession(res.session);
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
          setSession(res.session);
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
    // The canvas div now mounts immediately (see render below) instead of only after
    // data arrives, so size is already known by the time the real treemap is ready to
    // draw - no extra measure-then-render round trip standing between "data landed"
    // and "tiles visible".
  }, [view]);

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

  // Placeholder blocks shown in place of the real sector zones while the first
  // response is still in flight — run through the same squarify layout with made-up
  // weights, so the skeleton already has the treemap's blocky silhouette instead of a
  // blank card, and doesn't jump/reflow into a differently-shaped layout once the
  // real data swaps in.
  const skeletonRects = useMemo(() => {
    if (size.w === 0 || size.h === 0) return [];
    return squarify(
      SKELETON_SECTOR_WEIGHTS.map((value, i) => ({ id: `skeleton-${i}`, value })),
      0,
      0,
      size.w,
      size.h
    );
  }, [size]);

  const handleTileClick = (code: string) => {
    navigate(market === "us" ? `/global?code=${code}` : `/dashboard?code=${code}`);
  };

  // One batched translation request for every name currently loaded (tiles, table,
  // tooltip all read from this same array), rather than one call per row. US names
  // are already in English, so there's nothing to translate — pass an empty array
  // instead of wasting a translation request on text that never needs it.
  const translatedNames = useTranslatedTexts(market === "kr" ? items.map((it) => it.name) : []);
  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((it, i) => map.set(it.code, translatedNames[i] ?? it.name));
    return map;
  }, [items, translatedNames]);
  // On US maps the ticker (not the full company name) is the primary label shown on
  // tiles/table rows; the full English name only shows in the hover/tap tooltip.
  const tileLabel = (code: string, name: string) => (market === "us" ? code : nameByCode.get(code) ?? name);

  const liveBadgeText = lang === "en" ? "Live (rank-based refresh: 10s–1min)" : "실시간 (순위별 10초 ~ 1분단위 갱신)";
  const isExtendedSession = session === "pre" || session === "post";

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
    const [, skhyFlagImg] = await Promise.all([
      Promise.all(
        sectorZones.flatMap((zone) =>
          zone.tiles.map(async (tile) => {
            const name = tileLabel(tile.item.code, tile.item.name);
            const { showIcon } = tileDisplayInfo(tile.w, tile.h, name);
            if (!showIcon) return;
            const img = await loadIconImage(tile.item.code, market);
            if (img) iconByCode.set(tile.item.code, img);
          })
        )
      ),
      // Same one flag SVG regardless of how many tiles need it (just SKHY, today) —
      // loaded once here rather than through iconByCode's per-ticker cache, since it
      // isn't keyed by ticker/market the way a company logo is.
      loadImage("/img/flag/kr.svg"),
    ]);

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

        const name = tileLabel(tile.item.code, tile.item.name);
        const { showName, showPctOnly, fontSizes, showIcon, iconSize, iconGap } = tileDisplayInfo(
          tile.w,
          tile.h,
          name
        );
        if (!showName && !showPctOnly) continue;

        const pctText = pct(tile.item.change_pct);
        const padX = 5;
        const tileTextColor = textColorForRgb(rgb, themeMode);
        ctx.fillStyle = tileTextColor;

        if (showName) {
          const icon = showIcon ? iconByCode.get(tile.item.code) : undefined;
          let textX = tile.x + padX;
          if (icon) {
            if (market === "us") {
              // The white plate .kospi-map-tile-icon--us gives these logos on screen,
              // for the same reason: they are mostly dark glyphs on transparency, and a
              // treemap tile is a saturated red or green underneath them.
              ctx.fillStyle = "#fff";
              ctx.fillRect(tile.x + padX, tile.y + 2, iconSize, iconSize);
              ctx.fillStyle = tileTextColor;
            }
            drawContained(ctx, icon, tile.x + padX, tile.y + 2, iconSize);
            textX += iconSize + iconGap;
          }

          ctx.font = `700 ${fontSizes.name}px ${TILE_FONT_FAMILY}`;
          ctx.textBaseline = "top";
          const shownName = truncateToWidth(ctx, name, tile.x + tile.w - padX - textX);
          ctx.fillText(shownName, textX, tile.y + 2);

          // The same actual flag image the on-screen tile shows next to SKHY's label
          // (see the img next to .kospi-map-tile-name in the DOM render below) rather
          // than a flag emoji baked into the name string — most Windows browsers have
          // no colour flag glyphs at all and would draw bare "KR" letters instead.
          if (skhyFlagImg && tile.item.code === "SKHY") {
            const flagH = fontSizes.name * 0.62;
            const flagW = flagH * (skhyFlagImg.width / skhyFlagImg.height || 1.5);
            const flagX = textX + ctx.measureText(shownName).width + 4;
            if (flagX + flagW <= tile.x + tile.w - padX) {
              ctx.drawImage(skhyFlagImg, flagX, tile.y + 2 + (fontSizes.name - flagH) / 2, flagW, flagH);
            }
          }

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
    // Refused while a share sheet is up. The sheet is system UI drawn over the page,
    // so a tap meant for it can land on the overlay behind — and closing here revokes
    // the object URL the share target is still reading from, which turns a working
    // save into a failure the user never asked for.
    if (sharingRef.current) return;
    setMapPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setMapDownloadError(null);
  };

  // Whether to offer the share sheet at all. Computed at render rather than inside the
  // handler so the modal can decide what control to draw — the user should see which
  // save affordance they get, not discover it after a tap.
  //
  // Restricted to iOS-family browsers, which is narrower than "the platform can share".
  // Android can share too, but the download link beside it already saves the file
  // there, so the sheet is a redundant second path — and on at least one device (a
  // Galaxy Fold's inner display) invoking it leaves the share UI flickering and
  // unusable. A redundant control that breaks on real hardware is worth removing;
  // on iOS it is not redundant, it is the only way to save.
  const canShareMapFile = useMemo(() => {
    if (!mapPreview || !IS_IOS_LIKE) return false;
    if (typeof navigator.canShare !== "function" || typeof navigator.share !== "function") {
      return false;
    }
    try {
      const file = new File([mapPreview.blob], mapPreview.filename, { type: "image/png" });
      return navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  }, [mapPreview]);

  /** Hands the PNG to the native share sheet, where the user can save it to
   * Photos/Files. Share only — it never falls back to a download, because summoning a
   * second save UI on top of the sheet is what made this unusable on Android. */
  const shareMapImage = async () => {
    // A ref rather than the state flag alone: two taps can land in the same render and
    // `sharing` would still read false in the second handler's closure.
    if (!mapPreview || sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    setMapDownloadError(null);
    try {
      const file = new File([mapPreview.blob], mapPreview.filename, { type: "image/png" });
      await navigator.share({ files: [file] });
      sharingRef.current = false;
      // The sheet already confirmed the save; leaving the preview up makes the user
      // dismiss the same thing twice.
      closeMapPreview();
    } catch (err) {
      // A dismissed sheet is not a failure and needs no message.
      if ((err as Error)?.name !== "AbortError") {
        setMapDownloadError(t("저장에 실패했습니다. 이미지를 길게 눌러 저장해 주세요."));
      }
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
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
          <Link to="/dashboard" className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> {t("홈")}
          </Link>
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
      </header>

      <div className="app-header-trailing">
        <div className="kospi-map-titlebar">
          <div>
            <div className="app-title-row">
              <h1 className="app-title">{pageTitle}</h1>
              <span className="kospi-map-live-badge">
                <span className="kospi-map-live-dot" />
                {liveBadgeText}
              </span>
              {/* Outside regular US hours every tile is priced off its pre/post print,
                  and the map has no other way to say so — the tiles themselves are just
                  colored rectangles. Sits next to the live badge because the two answer
                  the same question: how current is what I'm looking at. */}
              <SessionBadge session={session} />
              {isExtendedSession && (
                <span className="kospi-map-session-note">{t("정규장 종가 + 시간외 변동 반영")}</span>
              )}
              {/* The three card boards, right where a reader has just been told this
                  map is live — the map answers "what is the whole market doing", the
                  boards answer "what is each name doing", so this is the point in the
                  page where the second question is most likely to occur. Shown on all
                  four maps, this one included: the set of boards doesn't depend on
                  which map you're standing on, and leaving one map out would make the
                  boards look like they belong to the others. */}
              <span className="kospi-map-board-links">
                {BOARD_LINKS.map((board) => (
                  <Link key={board.to} to={board.to} className="kospi-map-board-link">
                    <RankIcon className="kospi-map-board-icon" />
                    {board.label}
                  </Link>
                ))}
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
      </div>

      <MarketTickerBar />

      {error && <div className="error-state">{t(error)}</div>}
      {loading && (
        <span className="sr-only" role="status">
          {t(loadingLabel)}
        </span>
      )}

      {!error && (
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
              {loading &&
                skeletonRects.map((rect, i) => (
                  <div
                    key={rect.id}
                    className="kospi-map-skeleton-block"
                    style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, animationDelay: `${i * 70}ms` }}
                  />
                ))}
              {!loading && sectorZones.map((zone) => (
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
                    const name = tileLabel(tile.item.code, tile.item.name);
                    const { showName, showPctOnly, fontSizes, showIcon, iconSize } = tileDisplayInfo(
                      tile.w,
                      tile.h,
                      name
                    );
                    // Both markets have a logo source now — Naver's icon host for KR
                    // codes, companiesmarketcap for US tickers (see ../usLogo).
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
                              {showIcon &&
                                (market === "us" ? (
                                  <UsStockIcon
                                    className="kospi-map-tile-icon kospi-map-tile-icon--us"
                                    style={{ width: iconSize, height: iconSize }}
                                    code={tile.item.code}
                                  />
                                ) : (
                                  <StockIcon
                                    className="kospi-map-tile-icon"
                                    style={{ width: iconSize, height: iconSize }}
                                    code={tile.item.code}
                                  />
                                ))}
                              <span className="kospi-map-tile-name" style={{ fontSize: fontSizes.name }}>
                                {name}
                              </span>
                              {tile.item.code === "SKHY" && (
                                <img
                                  className="kospi-map-tile-flag"
                                  src="/img/flag/kr.svg"
                                  alt=""
                                  loading="lazy"
                                  style={{ height: fontSizes.name * 0.62 }}
                                />
                              )}
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
                    <th>{t(marcapLabel)}</th>
                    <th>{t("현재가")}</th>
                    <th>{t("등락률")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? SKELETON_TABLE_ROWS.map((i) => (
                        <tr key={`skeleton-${i}`} className="kospi-map-skeleton-row-tr" aria-hidden="true">
                          <td colSpan={6}>
                            <div className="kospi-map-skeleton-row" style={{ animationDelay: `${i * 60}ms` }} />
                          </td>
                        </tr>
                      ))
                    : visibleItems.map((item, idx) => (
                        <tr key={item.code} onClick={() => handleTileClick(item.code)}>
                          <td>{idx + 1}</td>
                          <td className="kospi-map-table-name">
                            {tileLabel(item.code, item.name)}
                            {item.code === "SKHY" && (
                              <img className="kospi-map-tile-flag kospi-map-table-flag" src="/img/flag/kr.svg" alt="" loading="lazy" />
                            )}
                            {market === "kr" && <span className="top100-code">{item.code}</span>}
                          </td>
                          <td>{t(item.sector)}</td>
                          <td>{formatMarcapOrWeight(item.marcap, market, lang)}</td>
                          <td>{formatPrice(item.close, market, lang)}</td>
                          <td style={{ color: item.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                            {pct(item.change_pct)}
                            {/* Same split as the map tooltip, so the table view isn't the
                                one place that can't tell an after-hours move apart from
                                a regular-session one. */}
                            <SessionSplit quote={item} className="kospi-map-table-session" />
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
            {nameByCode.get(hovered.code) ?? hovered.name}
            {hovered.code === "SKHY" && (
              <img className="kospi-map-tile-flag kospi-map-tooltip-flag" src="/img/flag/kr.svg" alt="" loading="lazy" />
            )}{" "}
            <span className="top100-code">{hovered.code}</span>
          </div>
          <div className="kospi-map-tooltip-row">{t("업종")} {t(hovered.sector)}</div>
          <div className="kospi-map-tooltip-row">{t(marcapLabel)} {formatMarcapOrWeight(hovered.marcap, market, lang)}</div>
          <div className="kospi-map-tooltip-row">
            {t("현재가")} {formatPrice(hovered.close, market, lang)}
            <SessionBadge session={hovered.session} compact />
          </div>
          <div
            className="kospi-map-tooltip-row"
            style={{ color: hovered.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
          >
            {t("등락")} {formatChangeAmount(hovered.change, market, lang)} ({pct(hovered.change_pct)})
          </div>
          {/* The row above is the move versus yesterday's close, which after the bell
              already contains the extended leg — this splits it back apart. Renders
              nothing during regular hours. */}
          <SessionSplit quote={hovered} className="kospi-map-tooltip-row" />
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
              <button
                type="button"
                className="kospi-map-preview-close"
                onClick={closeMapPreview}
                disabled={sharing}
                aria-label={t("닫기")}
              >
                ×
              </button>
            </div>
            <div className="kospi-map-preview-body">
              <img src={mapPreview.url} alt={mapPreview.filename} className="kospi-map-preview-image" />
            </div>
            <div className="kospi-map-preview-footer">
              {mapDownloadError && (
                <span className="kospi-map-preview-error" role="alert">
                  {mapDownloadError}
                </span>
              )}
              {/* One control, whichever one actually saves on this platform. Both were
                  shown at once briefly and that is worse than either alone: on iOS the
                  download link navigates the page to the image instead of saving it,
                  and on Android the share sheet is a redundant second path that
                  misbehaves on some hardware. */}
              {canShareMapFile ? (
                <button
                  type="button"
                  className="kospi-map-preview-share"
                  onClick={shareMapImage}
                  disabled={sharing}
                  aria-busy={sharing}
                >
                  {sharing ? t("저장 중...") : t("저장")}
                </button>
              ) : (
                /* A real anchor the user taps, not a <button> that builds a hidden one
                   and fires a synthetic .click() at it. That synthetic click was the
                   only thing here that could summon Android's system "실행" chooser,
                   and a genuine tap on a genuine link is what the browser's own
                   download path is built for. */
                <a
                  className="kospi-map-preview-download"
                  href={mapPreview.url}
                  download={mapPreview.filename}
                  onClick={() => setMapDownloadError(null)}
                >
                  {t("다운로드")}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
