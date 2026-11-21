import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import "./adZone.css";

/* Dedicated ad zones (11-21). Each zone is its own box, never inside or over
   content: a sticky rail beside the page on wide screens, the column next to
   a short section on laptops/tablets, and a gap between sections on phones.

   - A zone only exists (and only requests an ad) where its media query matches,
     so no ad is ever requested into a hidden box.
   - It reserves its creative's size while the ad loads (no jump), and folds to
     nothing when AdSense leaves it unfilled, so no empty frame is left behind.
   - `?adpreview=1` draws the boxes without requesting ads, for layout checks. */

type AdWindow = Window & { adsbygoogle?: { push(request: object): unknown } };
type Size = { width: number; height: number };
export type AdZoneKind = "rail" | "side" | "feed-banner" | "feed-rect";

const CLIENT = "ca-pub-8278980164088928";
const SLOT: Record<AdZoneKind, string> = {
  rail: "4327083118",
  side: "9025269231",
  "feed-banner": "9440754514",
  "feed-rect": "4040463452",
};
const SIZES: Record<AdZoneKind, Size[]> = {
  rail: [{ width: 300, height: 600 }, { width: 300, height: 250 }],
  side: [{ width: 300, height: 250 }],
  "feed-banner": [{ width: 320, height: 100 }, { width: 320, height: 50 }],
  "feed-rect": [{ width: 300, height: 250 }, { width: 250, height: 250 }],
};
export const AD_MEDIA: Record<AdZoneKind, string> = {
  rail: "(min-width: 1680px)",
  side: "(min-width: 768px) and (max-width: 1679px)",
  "feed-banner": "(max-width: 767px)",
  "feed-rect": "(max-width: 767px)",
};

const preview = () => { try { return new URLSearchParams(window.location.search).has("adpreview"); } catch { return false; } };

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), update = () => setMatch(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return match;
}

export default function AdZone({ kind, className = "" }: { kind: AdZoneKind; className?: string }) {
  const show = useMedia(AD_MEDIA[kind]);
  const dry = preview();
  if (!show || (!import.meta.env.PROD && !dry)) return null;
  return <AdBox key={kind} kind={kind} dry={dry} className={className} />;
}

function AdBox({ kind, dry, className }: { kind: AdZoneKind; dry: boolean; className: string }) {
  const { lang } = useLanguage();
  const host = useRef<HTMLElement>(null), slot = useRef<HTMLModElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [state, setState] = useState<"pending" | "filled" | "empty">("pending");

  useEffect(() => {
    const area = host.current;
    if (!area) return;
    // The rail's tall creative only when the window is tall enough to show all of it under the header.
    const room = kind === "rail" ? window.innerHeight - 160 : Infinity;
    // The zone sizes itself to its creative, so measure the column it sits in (minus the frame's 18px).
    const width = (area.parentElement?.clientWidth ?? window.innerWidth) - 18;
    const pick = SIZES[kind].find(s => s.width <= width && s.height <= room) ?? SIZES[kind][SIZES[kind].length - 1];
    setSize(pick);
  }, [kind]);

  useEffect(() => {
    const ad = slot.current, loader = document.getElementById("adsense-loader");
    if (!size || dry || !ad || !loader) return;
    let pushed = false;
    const push = () => {
      if (pushed || loader.dataset.loaded !== "true" || document.hidden) return;
      pushed = true;
      try { ((window as AdWindow).adsbygoogle ??= [] as unknown as { push(request: object): unknown }).push({}); }
      catch { setState("empty"); }
    };
    // AdSense marks the <ins>: filled, or unfilled / unfill-optimized when there is nothing to show.
    const status = new MutationObserver(() => {
      const value = ad.dataset.adStatus;
      if (value === "filled") setState("filled");
      else if (value && value.startsWith("unfill")) setState("empty");
    });
    status.observe(ad, { attributes: true, attributeFilter: ["data-ad-status"] });
    if (loader.dataset.failed === "true") setState("empty");
    loader.addEventListener("load", push);
    document.addEventListener("visibilitychange", push);
    push();
    return () => { status.disconnect(); loader.removeEventListener("load", push); document.removeEventListener("visibilitychange", push); };
  }, [size, dry]);

  return <aside ref={host} className={`ad-zone ad-zone--${kind} ${className}`} data-state={dry ? "preview" : state}
    aria-label={lang === "ko" ? "광고" : "Advertisement"} style={size ? { "--ad-w": `${size.width}px`, "--ad-h": `${size.height}px` } as CSSProperties : undefined}>
    <span className="ad-zone-label" aria-hidden="true">{lang === "ko" ? "광고" : "AD"}</span>
    {size && (dry
      ? <div className="ad-zone-dummy">{kind} · {size.width}×{size.height}</div>
      : <ins ref={slot} className="adsbygoogle ad-zone-ins" style={{ display: "inline-block", width: size.width, height: size.height }}
          data-ad-client={CLIENT} data-ad-slot={SLOT[kind]} data-full-width-responsive="false" />)}
  </aside>;
}
