import { useEffect, useRef } from "react";
import { useRoute } from "../router";
import { useLanguage } from "../i18n/LanguageContext";

type AdWindow = Window & { adsbygoogle?: { push(request: object): unknown } };

const bannerRoutes = new Set([
  "/", "/desk", "/global", "/map", "/kosdaq-map", "/sp500-map",
  "/nasdaq100-map", "/realestate-map", "/pulse-board", "/hot-issues",
  "/kospi-100", "/kosdaq-100", "/nasdaq-100", "/etf/kr", "/etf/us",
]);

export default function AdSenseBanner({
  format = "auto", labelled = false,
}: { format?: "auto" | "horizontal"; labelled?: boolean } = {}) {
  const path = useRoute();
  const { lang } = useLanguage();
  const isStockDetail = /^\/stock\/[A-Za-z0-9.-]{1,16}\/?$/.test(path);
  if (!import.meta.env.PROD || !(bannerRoutes.has(path) || isStockDetail)) return null;
  const slot = <AdSlot key={path} format={format} />;
  if (!labelled) return slot;

  return (
    <div className="ng-adsense-inline">
      <span className="ng-adsense-inline-label">{lang === "ko" ? "광고" : "Advertisement"}</span>
      {slot}
    </div>
  );
}

function AdSlot({ format }: { format: "auto" | "horizontal" }) {
  const ref = useRef<HTMLModElement>(null);
  const requested = useRef(false);

  useEffect(() => {
    const slot = ref.current;
    if (!slot || requested.current) return;

    const request = () => {
      if (requested.current || slot.clientWidth === 0) return;
      requested.current = true;
      observer.disconnect();
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
  }, []);

  if (!import.meta.env.PROD) return null;
  return (
    <ins
      ref={ref}
      className="adsbygoogle ng-adsense-banner"
      style={{ display: "block" }}
      data-ad-client="ca-pub-8278980164088928"
      data-ad-slot="9440754514"
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  );
}
