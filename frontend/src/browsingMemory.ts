import { useCallback, useLayoutEffect, useState } from "react";
import { ownScrollRestoration, pinnedScrollOffset } from "./scrollNavigation";

const PREFIX = "kstock_browse_v1:";
const memory = new Map<string, unknown>();
const MAPS = new Set(["/map", "/kosdaq-map", "/sp500-map", "/nasdaq100-map", "/realestate-map"]);
export const isBrowsingPage = (url: string) => MAPS.has(url.split(/[?#]/)[0]) || ["/desk", "/desk2"].includes(url.split(/[?#]/)[0]);
export const readingUrl = () => window.location.pathname + window.location.search + window.location.hash;

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* Browsing still works with storage disabled. */ }
  return (memory.get(key) as T) ?? null;
}
function write(key: string, value: unknown) {
  memory.set(key, value);
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* Tab-local fallback. */ }
}

/** Only public view choices are stored, scoped to this tab and exact page URL. */
export function useBrowsingChoice<T extends string | null>(name: string, initial: T, valid: (value: unknown) => value is T): [T, (value: T) => void] {
  const [key] = useState(() => `view:${readingUrl().split("#")[0]}:${name}`);
  const [value, update] = useState<T>(() => {
    const saved = read<unknown>(key);
    return valid(saved) ? saved : initial;
  });
  const set = useCallback((next: T) => { write(key, next); update(next); }, [key]);
  return [value, set];
}

interface Position { y: number; anchor: string | null; offset: number }
export function saveReadingPosition(url: string, entry: string) {
  const sections = [...document.querySelectorAll<HTMLElement>("main section[id]")];
  const anchor = sections.reverse().find((el) => el.getBoundingClientRect().top <= 160);
  const position: Position = { y: window.scrollY, anchor: anchor?.id ?? null, offset: anchor?.getBoundingClientRect().top ?? 0 };
  write(`entry:${entry}:${url}`, position);
  // replaceState changes view parameters without creating a new history entry.
  write(`entry:${entry}`, position);
  if (isBrowsingPage(url)) {
    write(`position:${url.split("#")[0]}`, position);
    write(`last-url:${url.split(/[?#]/)[0]}`, url.split("#")[0]);
  }
  if (MAPS.has(url.split(/[?#]/)[0])) write("last-map", url.split("#")[0]);
}
export function lastMapUrl(): string | null {
  const url = read<unknown>("last-map");
  return typeof url === "string" && url.length < 500 && MAPS.has(url.split(/[?#]/)[0]) ? restoredBrowsingUrl(url) : null;
}
export function hasReadingPosition(): boolean {
  return read(`position:${readingUrl().split("#")[0]}`) !== null;
}
/** A normal menu visit may restore public view choices, but never development access.
 * Only the returned URL changes; existing browsing records remain untouched. */
function restoredBrowsingUrl(url: string): string {
  const parsed = new URL(url, window.location.origin);
  if (!parsed.searchParams.has('devgame')) return url;
  parsed.searchParams.delete('devgame');
  return parsed.pathname + parsed.search + parsed.hash;
}
export function resolvedBrowsingUrl(url: string): string {
  if (!isBrowsingPage(url) || /[?#]/.test(url)) return url;
  const saved = read<unknown>(`last-url:${url}`);
  return typeof saved === "string" && saved.length < 500 && saved.split(/[?#]/)[0] === url ? restoredBrowsingUrl(saved) : url;
}

/** Runs inside Suspense after the route has committed. Fresh links always start at the top. */
export function useReadingRestoration(url: string, entry: string, returning: boolean) {
  useLayoutEffect(() => {
    const saved = returning ? read<Position>(`entry:${entry}`) ?? read<Position>(`entry:${entry}:${url}`) : null;
    const position = saved && Number.isFinite(saved.y) && saved.y >= 0 && Number.isFinite(saved.offset) ? saved : null;
    let hash = returning && position ? "" : window.location.hash.slice(1);
    try { hash = decodeURIComponent(hash); } catch { /* Malformed fragment is simply unmatched. */ }
    const mapStart = !hash && !position && MAPS.has(url.split(/[?#]/)[0]);
    if (!hash && !position && !mapStart) { window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior }); return; }
    let stopped = false;
    let frame = 0;
    let settled = 0;
    let timeout = 0;
    let release = () => {};
    const apply = () => {
      if (stopped) return;
      const anchor = mapStart ? document.querySelector<HTMLElement>('[data-scroll-start="map"]') : document.getElementById(hash || position?.anchor || "");
      const top = Math.max(0, anchor ? window.scrollY + anchor.getBoundingClientRect().top - (hash || mapStart ? pinnedScrollOffset() : position!.offset) : position?.y ?? 0);
      if (Math.abs(window.scrollY - top) > 1) {
        window.clearTimeout(settled); settled = 0;
        window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
      }
      // Stop after a short quiet layout, rather than following live DOM updates for ten seconds.
      const ready = (!hash && !mapStart || anchor) && anchor?.getAttribute("data-scroll-ready") !== "false" && document.fonts?.status !== "loading";
      if (ready && Math.abs(window.scrollY - top) <= 1) {
        if (!settled) settled = window.setTimeout(stop, 350);
      } else if (settled) { window.clearTimeout(settled); settled = 0; }
    };
    const schedule = () => { if (!frame && !stopped) frame = requestAnimationFrame(() => { frame = 0; apply(); }); };
    const stop = () => {
      stopped = true; observer.disconnect(); mutation.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(settled); window.clearTimeout(timeout);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown", "click"]) window.removeEventListener(type, cancel);
      release();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-scroll-ready"] });
    void document.fonts?.ready.then(schedule);
    const cancel = (event: Event) => {
      if (event instanceof KeyboardEvent && !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " ", "Tab"].includes(event.key)) return;
      stop();
    };
    release = ownScrollRestoration(stop);
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown", "click"]) window.addEventListener(type, cancel, { passive: true });
    apply();
    timeout = window.setTimeout(stop, mapStart ? 8_000 : 4_000);
    return stop;
  }, [url, entry, returning]);
}

export function ReadingRestoration({ url, entry, returning }: { url: string; entry: string; returning: boolean }) {
  useReadingRestoration(url, entry, returning);
  return null;
}
