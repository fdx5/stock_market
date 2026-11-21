import { useEffect, useRef } from "react";
import { useRoute } from "../router";
import { useLanguage } from "../i18n/LanguageContext";
import { MARKET_ASSETS } from "../marketAssets";

type AdWindow = Window & { adsbygoogle?: { push(request: object): unknown } };

const bannerRoutes = new Set([
  "/", "/desk", "/global", "/world-markets", "/map", "/kosdaq-map", "/sp500-map",
  "/nasdaq100-map", "/realestate-map", "/pulse-board", "/pulse-board-ship", "/hot-issues",
  "/kospi-100", "/kosdaq-100", "/nasdaq-100", "/etf/kr", "/etf/us",
  "/kospi", "/kosdaq", "/nasdaq", "/stocks", "/news", "/global-top100", "/market-brief",
  "/markets", "/market-inside", "/stock-tradeoffs", "/recovery-lab", "/market-radar",
  "/stock-screener", "/stock-compare", "/sector-strength", "/decision-brief", "/global-peers",
  "/etf-overlap", "/data-confidence", "/session-planner", ...MARKET_ASSETS.flatMap(asset => [`/prices/${asset.key}`, `/prices/${asset.key}/`]),
]);

/** Pages that carry ads at all (content pages; never the admin, games or account pages). */
export function adRoute(path: string) {
  const isStockDetail = /^\/stock\/[A-Za-z0-9.-]{1,16}\/?$/.test(path);
  const isBrief = /^\/market-brief\/(?:latest\/(?:kospi|kosdaq|samsung|hynix|hyundai|sksquare|semco)|\d{4}-\d{2}-\d{2}\/(?:kospi|kosdaq|samsung|hynix|hyundai|sksquare|semco|\d{6}))\/?$/i.test(path);
  return bannerRoutes.has(path) || isStockDetail || isBrief;
}

type BannerOptions = { labelled?: boolean; contentReady?: boolean };
const slotIds = {
  banner: "9440754514",
  secondary: "4040463452",
  rectangle: "9025269231",
  "secondary-rectangle": "4327083118",
} as const;
type AdVariant = keyof typeof slotIds;
type AdSize = { width: number; height: number };

const bannerSizes: readonly AdSize[] = [
  { width: 728, height: 90 },
  { width: 468, height: 60 },
  { width: 320, height: 50 },
  { width: 300, height: 50 },
  { width: 234, height: 60 },
];
const rectangleSizes: readonly AdSize[] = [{ width: 300, height: 250 }];
const pairedRectangleSizes: readonly AdSize[] = [...rectangleSizes, { width: 250, height: 250 }, { width: 200, height: 200 }];
const compactBannerSizes: readonly AdSize[] = [
  { width: 234, height: 60 },
  { width: 200, height: 60 },
  { width: 160, height: 60 },
];
const compactRectangleSizes: readonly AdSize[] = [{ width: 125, height: 125 }];
const handheldAds = "(max-width: 899px), (pointer: coarse)";

export function AdSenseBannerPair({
  labelled = false, contentReady = true, expandedDesktop = false, compactPortrait = false,
}: BannerOptions & { expandedDesktop?: boolean; compactPortrait?: boolean } = {}) {
  const options = { labelled, contentReady };
  const banner = <AdSenseBanner {...options} />;
  return (
    <div className={compactPortrait ? "ng-adsense-pair ng-adsense-pair--portrait" : "ng-adsense-pair"}>
      {expandedDesktop ? (
        <div className="ng-adsense-stack">
          {banner}
          <AdSenseBanner {...options} variant="secondary" />
        </div>
      ) : banner}
      {expandedDesktop && <AdSenseBanner {...options} variant="secondary-rectangle" />}
      <AdSenseBanner {...options} variant="rectangle" />
    </div>
  );
}

export default function AdSenseBanner({
  labelled = false, variant = "banner", fluid = false, contentReady = true,
}: BannerOptions & { variant?: AdVariant; fluid?: boolean } = {}) {
  const path = useRoute();
  const { lang } = useLanguage();
  if (!import.meta.env.PROD || !adRoute(path)) return null;
  return <AdSlot key={`${path}:${variant}`} variant={variant} fluid={fluid} contentReady={contentReady} label={labelled ? (lang === "ko" ? "광고" : "Advertisement") : undefined} />;
}

function AdSlot({ variant, fluid, contentReady, label }: { variant: AdVariant; fluid: boolean; contentReady: boolean; label?: string }) {
  const rectangle = variant === "rectangle" || variant === "secondary-rectangle";
  const host = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLModElement>(null);

  const requestedMinWidth = useRef<number>();

  useEffect(() => {
    const area = host.current;
    const ad = slot.current;
    const loader = document.getElementById("adsense-loader");
    if (!area || !ad || !loader) return;

    const handheld = window.matchMedia(handheldAds);
    const pair = area.closest(".ng-adsense-pair");
    const rectangles = area.closest(".wm-rectangle-pair") ? pairedRectangleSizes : rectangleSizes;
    const portraitPair = pair?.classList.contains("ng-adsense-pair--portrait");
    const mobileBanner = variant === "banner" || (variant === "secondary" && pair === null);
    const isCompact = () => getComputedStyle(area).getPropertyValue("--ng-ad-compact").trim() === "1";
    const canHold = () => handheld.matches && (mobileBanner || (portraitPair && isCompact()));
    const fit = () => {
      if (area.dataset.adInView && !canHold()) delete area.dataset.adInView;
      const width = area.clientWidth;
      // A filled creative keeps its original size. Responsive hiding keeps it
      // out of the layout if the column shrinks, without requesting it again.
      if (area.dataset.adFailed === "true") return;
      const previous = requestedMinWidth.current;
      if (previous !== undefined) {
        area.dataset.adFits = String(width >= previous);
        return;
      }
      // AdSense push is shared by the document. Waiting for the loader keeps
      // a navigation from leaving queued requests for slots that have unmounted.
      if (!contentReady || loader.dataset.loaded !== "true" || document.hidden || width === 0) return;
      const compact = portraitPair && isCompact();
      const sizes = compact
        ? (rectangle ? compactRectangleSizes : compactBannerSizes)
        : (rectangle ? rectangles : bannerSizes);
      const size = fluid ? undefined : sizes.find(candidate => candidate.width <= width);
      if (!fluid && !size) return;
      requestedMinWidth.current = size?.width ?? 1;
      area.dataset.adFits = "true";
      if (size) {
        ad.style.width = `${size.width}px`;
        ad.style.height = `${size.height}px`;
        area.style.setProperty("--ng-ad-height", ad.style.height);
      }
      const ads = window as AdWindow;
      try {
        const queue = ads.adsbygoogle ?? (ads.adsbygoogle = [] as object[]);
        queue.push({});
      } catch {
        area.dataset.adFits = "false";
        area.dataset.adFailed = "true";
      }
    };

    // Keep a visible, unfilled banner at its reserved height until it leaves
    // the viewport. A slot that already collapsed must stay collapsed.
    const visibility = !fluid && (mobileBanner || portraitPair) && typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => {
        if (!canHold() || !entry.isIntersecting || entry.boundingClientRect.height === 0) {
          delete area.dataset.adInView;
        } else if (ad.dataset.adStatus !== "unfilled") {
          area.dataset.adInView = "true";
        }
      })
      : undefined;
    visibility?.observe(area);

    const observer = new ResizeObserver(fit);
    observer.observe(area);
    loader.addEventListener("load", fit);
    window.addEventListener("pageshow", fit);
    document.addEventListener("visibilitychange", fit);
    fit();
    return () => {
      observer.disconnect();
      visibility?.disconnect();
      loader.removeEventListener("load", fit);
      window.removeEventListener("pageshow", fit);
      document.removeEventListener("visibilitychange", fit);
    };
  }, [contentReady, fluid, rectangle, variant]);

  return (
    <div ref={host} className={`ng-adsense-slot ng-adsense-slot--${variant}`}>
      {label && <span className="ng-adsense-inline-label">{label}</span>}
      <ins
        ref={slot}
        className="adsbygoogle ng-adsense-banner"
        data-ad-client="ca-pub-8278980164088928"
        data-ad-slot={slotIds[variant]}
        data-ad-format={fluid ? "auto" : undefined}
        data-full-width-responsive="false"
      />
    </div>
  );
}
