import { useEffect, useRef } from "react";
import { useRoute } from "../router";
import { useLanguage } from "../i18n/LanguageContext";

type AdWindow = Window & { adsbygoogle?: { push(request: object): unknown } };

const bannerRoutes = new Set([
  "/", "/desk", "/global", "/map", "/kosdaq-map", "/sp500-map",
  "/nasdaq100-map", "/realestate-map", "/pulse-board", "/pulse-board-ship", "/hot-issues",
  "/kospi-100", "/kosdaq-100", "/nasdaq-100", "/etf/kr", "/etf/us",
]);

type BannerOptions = { labelled?: boolean };
type AdSize = { width: number; height: number };

const bannerSizes: readonly AdSize[] = [
  { width: 728, height: 90 },
  { width: 468, height: 60 },
  { width: 320, height: 50 },
  { width: 300, height: 50 },
  { width: 234, height: 60 },
];
const rectangleSizes: readonly AdSize[] = [{ width: 300, height: 250 }];

export function AdSenseBannerPair({ labelled = false }: BannerOptions = {}) {
  return (
    <div className="ng-adsense-pair">
      <AdSenseBanner labelled={labelled} />
      <AdSenseBanner labelled={labelled} rectangle />
    </div>
  );
}

export default function AdSenseBanner({
  labelled = false, rectangle = false, fluid = false,
}: BannerOptions & { rectangle?: boolean; fluid?: boolean } = {}) {
  const path = useRoute();
  const { lang } = useLanguage();
  const isStockDetail = /^\/stock\/[A-Za-z0-9.-]{1,16}\/?$/.test(path);
  if (!import.meta.env.PROD || !(bannerRoutes.has(path) || isStockDetail)) return null;
  return <AdSlot key={path} rectangle={rectangle} fluid={fluid} label={labelled ? (lang === "ko" ? "??" : "Advertisement") : undefined} />;
}

function AdSlot({ rectangle, fluid, label }: { rectangle: boolean; fluid: boolean; label?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLModElement>(null);

  const requestedMinWidth = useRef<number>();

  useEffect(() => {
    const area = host.current;
    const ad = slot.current;
    if (!area || !ad) return;

    const fit = () => {
      const width = area.clientWidth;
      // A filled creative keeps its original size. Responsive hiding keeps it
      // out of the layout if the column shrinks, without requesting it again.
      if (area.dataset.adFailed === "true") return;
      const previous = requestedMinWidth.current;
      if (previous !== undefined) {
        area.dataset.adFits = String(width >= previous);
        return;
      }
      if (document.hidden || width === 0) return;
      const size = fluid ? undefined : (rectangle ? rectangleSizes : bannerSizes).find(candidate => candidate.width <= width);
      if (!fluid && !size) return;
      requestedMinWidth.current = size?.width ?? 1;
      area.dataset.adFits = "true";
      if (size) {
        ad.style.width = `${size.width}px`;
        ad.style.height = `${size.height}px`;
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

    const observer = new ResizeObserver(fit);
    observer.observe(area);
    window.addEventListener("pageshow", fit);
    document.addEventListener("visibilitychange", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("pageshow", fit);
      document.removeEventListener("visibilitychange", fit);
    };
  }, [fluid, rectangle]);

  return (
    <div ref={host} className={rectangle ? "ng-adsense-slot ng-adsense-slot--rectangle" : "ng-adsense-slot"}>
      {label && <span className="ng-adsense-inline-label">{label}</span>}
      <ins
        ref={slot}
        className="adsbygoogle ng-adsense-banner"
        data-ad-client="ca-pub-8278980164088928"
        data-ad-slot={rectangle ? "9025269231" : "9440754514"}
        data-ad-format={fluid ? "auto" : undefined}
        data-full-width-responsive="false"
      />
    </div>
  );
}
