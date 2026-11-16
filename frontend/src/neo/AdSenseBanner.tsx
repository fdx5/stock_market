import { useEffect, useRef } from "react";
import { useRoute } from "../router";
import { useLanguage } from "../i18n/LanguageContext";

type AdWindow = Window & { adsbygoogle?: { push(request: object): unknown } };

const bannerRoutes = new Set([
  "/", "/desk", "/global", "/map", "/kosdaq-map", "/sp500-map",
  "/nasdaq100-map", "/realestate-map", "/pulse-board", "/pulse-board-ship", "/hot-issues",
  "/kospi-100", "/kosdaq-100", "/nasdaq-100", "/etf/kr", "/etf/us",
]);

type BannerOptions = { format?: "auto" | "horizontal"; labelled?: boolean };

export function AdSenseBannerPair({ format = "auto", labelled = false }: BannerOptions = {}) {
  return (
    <div className="ng-adsense-pair">
      <div className="ng-adsense-pair-banner"><AdSenseBanner format={format} labelled={labelled} fixedHeight /></div>
      <div className="ng-adsense-pair-square"><AdSenseBanner slotId="9025269231" labelled={labelled} fixedHeight /></div>
    </div>
  );
}

export default function AdSenseBanner({
  format = "auto", labelled = false, slotId = "9440754514", fixedHeight = false,
}: BannerOptions & { slotId?: string; fixedHeight?: boolean } = {}) {
  const path = useRoute();
  const { lang } = useLanguage();
  const isStockDetail = /^\/stock\/[A-Za-z0-9.-]{1,16}\/?$/.test(path);
  if (!import.meta.env.PROD || !(bannerRoutes.has(path) || isStockDetail)) return null;
  const slot = <AdSlot key={`${path}:${slotId}`} format={format} slotId={slotId} fixedHeight={fixedHeight} />;
  if (!labelled) return slot;

  return (
    <div className="ng-adsense-inline">
      <span className="ng-adsense-inline-label">{lang === "ko" ? "광고" : "Advertisement"}</span>
      {slot}
    </div>
  );
}

function AdSlot({ format, slotId, fixedHeight }: { format: "auto" | "horizontal"; slotId: string; fixedHeight: boolean }) {
  const ref = useRef<HTMLModElement>(null);
  const requested = useRef(false);

  useEffect(() => {
    const slot = ref.current;
    if (!slot || requested.current) return;

    const request = () => {
      if (fixedHeight) {
        slot.style.height = getComputedStyle(slot).getPropertyValue("--ng-ad-height").trim() || "90px";
      }
      if (requested.current || slot.clientWidth === 0) return;
      requested.current = true;
      if (!fixedHeight) observer.disconnect();
      const ads = window as AdWindow;
      try {
        const queue = ads.adsbygoogle ?? (ads.adsbygoogle = [] as object[]);
        queue.push({});
      } catch {
        // An ad blocker or a provider error should leave the page usable.
      }
    };
    const observer = new ResizeObserver(request);
    observer.observe(slot);
    request();
    return () => observer.disconnect();
  }, [fixedHeight]);

  if (!import.meta.env.PROD) return null;
  return (
    <ins
      ref={ref}
      className="adsbygoogle ng-adsense-banner"
      style={{ display: "block", height: fixedHeight ? "90px" : undefined }}
      data-ad-client="ca-pub-8278980164088928"
      data-ad-slot={slotId}
      data-ad-format={fixedHeight ? undefined : format}
      data-full-width-responsive={fixedHeight ? undefined : "true"}
    />
  );
}
