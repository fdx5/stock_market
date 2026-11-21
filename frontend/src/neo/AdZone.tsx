import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
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
export type AdZoneKind = "rail" | "side" | "feed-banner" | "feed-rect" | "break" | "break-rect" | "tower";

const CLIENT = "ca-pub-8278980164088928";
const SLOT: Record<AdZoneKind, string> = {
  rail: "4327083118",
  side: "9025269231",
  "feed-banner": "9440754514",
  "feed-rect": "4040463452",
  break: "9440754514",
  "break-rect": "4040463452",
  tower: "4327083118",
};
const SIZES: Record<AdZoneKind, Size[]> = {
  rail: [{ width: 300, height: 600 }, { width: 300, height: 250 }],
  side: [{ width: 300, height: 250 }],
  "feed-banner": [{ width: 320, height: 100 }, { width: 320, height: 50 }],
  "feed-rect": [{ width: 300, height: 250 }, { width: 250, height: 250 }],
  // A break between two sections: as wide as the column allows, never taller than a strip.
  break: [{ width: 970, height: 90 }, { width: 728, height: 90 }, { width: 468, height: 60 }, { width: 320, height: 100 }, { width: 300, height: 50 }],
  // The same, but a phone gets a rectangle (for a break inside a long list).
  "break-rect": [{ width: 970, height: 90 }, { width: 728, height: 90 }, { width: 468, height: 60 }, { width: 300, height: 250 }, { width: 250, height: 250 }],
  // A narrow side column (e.g. under the map's controls): a skyscraper there, a strip on phones.
  tower: [{ width: 300, height: 250 }, { width: 160, height: 600 }, { width: 120, height: 600 }, { width: 320, height: 100 }, { width: 300, height: 50 }],
};
export const AD_MEDIA: Record<AdZoneKind, string> = {
  rail: "(min-width: 1680px)",
  side: "(min-width: 768px) and (max-width: 1679px)",
  "feed-banner": "(max-width: 767px)",
  "feed-rect": "(max-width: 767px)",
  break: "all",
  "break-rect": "all",
  tower: "all",
};

/** The shell's sticky ad column is showing: in-page breaks stand down, one ad in view is enough. */
export const AdRailContext = createContext(false);
export const SHELL_RAIL_MEDIA = "(min-width: 1680px)";

// Remembered for the tab: some pages rewrite their own query string.
const preview = () => { try { if (new URLSearchParams(window.location.search).has("adpreview")) sessionStorage.setItem("adpreview", "1"); return sessionStorage.getItem("adpreview") === "1"; } catch { return false; } };

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), update = () => setMatch(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return match;
}

export function useMediaQuery(query: string) { return useMedia(query); }

/** `ready`: a page's ad waits for its content, so no ad is ever shown on an empty screen. */
export default function AdZone({ kind, className = "", ready = true, onState }: { kind: AdZoneKind; className?: string; ready?: boolean; onState?: (state: "pending" | "filled" | "empty") => void }) {
  const show = useMedia(AD_MEDIA[kind]);
  const railShowing = useContext(AdRailContext);
  const dry = preview();
  if (!show || !ready || (railShowing && kind.startsWith("break")) || (!import.meta.env.PROD && !dry)) return null;
  return <AdBox key={kind} kind={kind} dry={dry} className={className} onState={onState} />;
}

function AdBox({ kind, dry, className, onState }: { kind: AdZoneKind; dry: boolean; className: string; onState?: (state: "pending" | "filled" | "empty") => void }) {
  const { lang } = useLanguage();
  const host = useRef<HTMLElement>(null), slot = useRef<HTMLModElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [state, setState] = useState<"pending" | "filled" | "empty">("pending");
  useEffect(() => { onState?.(state); }, [state, onState]);

  useEffect(() => {
    const area = host.current;
    if (!area) return;
    // The rail's tall creative only when the window is tall enough to show all of it under the header.
    const room = kind === "rail" ? window.innerHeight - 160 : Infinity;
    // The zone sizes itself to its creative, so measure the column it sits in (minus the frame's 18px).
    const width = (area.parentElement?.clientWidth ?? window.innerWidth) - 18;
    // A phone-width break uses the phone sizes only (a 468x60 on a 412px phone would be skipped anyway).
    const phone = window.matchMedia("(max-width: 767px)").matches;
    const sizes = kind.startsWith("break") ? SIZES[kind].filter(s => phone ? s.width <= 320 : s.height <= 90)
      : kind === "tower" ? SIZES[kind].filter(s => phone ? s.height <= 100 : s.height >= 250) : SIZES[kind];
    const pick = sizes.find(s => s.width <= width && s.height <= room) ?? sizes[sizes.length - 1];
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

/** A responsive AdSense unit (in-article or multiplex) set into the page like part of it.
 * Requested only when the reader nears it, so a filled ad never pushes the text being
 * read; only where `media` matches; folds away when nothing is served. */
function FluidAd({ slot: slotId, layout, format, media = "all", className, dummy }: { slot: string; layout?: string; format: "fluid" | "autorelaxed"; media?: string; className: string; dummy: string }) {
  const show = useMedia(media);
  const dry = preview();
  if (!show || (!import.meta.env.PROD && !dry)) return null;
  return <FluidBox slotId={slotId} layout={layout} format={format} dry={dry} className={className} dummy={dummy} />;
}

function FluidBox({ slotId, layout, format, dry, className, dummy }: { slotId: string; layout?: string; format: string; dry: boolean; className: string; dummy: string }) {
  const host = useRef<HTMLElement>(null), slot = useRef<HTMLModElement>(null);
  const [near, setNear] = useState(false);
  const [state, setState] = useState<"pending" | "filled" | "empty">("pending");
  useEffect(() => {
    const area = host.current;
    if (!area) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: "700px 0px" });
    io.observe(area);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const ad = slot.current, loader = document.getElementById("adsense-loader");
    if (!near || dry || !ad || !loader) return;
    let pushed = false;
    const push = () => {
      if (pushed || loader.dataset.loaded !== "true" || ad.clientWidth === 0) return;
      pushed = true;
      try { ((window as AdWindow).adsbygoogle ??= [] as unknown as { push(request: object): unknown }).push({}); } catch { setState("empty"); }
    };
    const status = new MutationObserver(() => {
      const value = ad.dataset.adStatus;
      if (value === "filled") setState("filled"); else if (value && value.startsWith("unfill")) setState("empty");
    });
    status.observe(ad, { attributes: true, attributeFilter: ["data-ad-status"] });
    if (loader.dataset.failed === "true") setState("empty");
    loader.addEventListener("load", push);
    push();
    return () => { status.disconnect(); loader.removeEventListener("load", push); };
  }, [near, dry]);
  return <aside ref={host} className={className} data-state={dry ? "preview" : state} aria-label="광고">
    <span className="ad-zone-label" aria-hidden="true">광고</span>
    {dry ? <div className="ad-zone-dummy ad-fluid-dummy">{dummy}</div>
      : near && <ins ref={slot} className="adsbygoogle" style={{ display: "block", textAlign: layout ? "center" : undefined }} data-ad-layout={layout} data-ad-format={format} data-ad-client={CLIENT} data-ad-slot={slotId} />}
  </aside>;
}

/** In-article unit between paragraphs or stories (오늘의 핫이슈). */
export function InArticleAd({ className = "" }: { className?: string }) {
  return <FluidAd slot="6932390106" layout="in-article" format="fluid" className={`ad-inarticle ${className}`} dummy="in-article · fluid" />;
}

/** Multiplex (related-content grid) units. */
export function MultiplexAd({ slot, media, className = "" }: { slot: "5479707639" | "5096564255"; media?: string; className?: string }) {
  return <FluidAd slot={slot} format="autorelaxed" media={media} className={`ad-multiplex ${className}`} dummy={`multiplex · ${slot}`} />;
}
