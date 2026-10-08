import { useCallback, useLayoutEffect, useState } from "react";

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
  if (isBrowsingPage(url)) {
    write(`position:${url.split("#")[0]}`, position);
    write(`last-url:${url.split(/[?#]/)[0]}`, url.split("#")[0]);
  }
  if (MAPS.has(url.split(/[?#]/)[0])) write("last-map", url.split("#")[0]);
}
export function lastMapUrl(): string | null {
  const url = read<unknown>("last-map");
  return typeof url === "string" && url.length < 500 && MAPS.has(url.split(/[?#]/)[0]) ? url : null;
}
export function hasReadingPosition(): boolean {
  return read(`position:${readingUrl().split("#")[0]}`) !== null;
}
export function resolvedBrowsingUrl(url: string): string {
  if (!isBrowsingPage(url) || /[?#]/.test(url)) return url;
  const saved = read<unknown>(`last-url:${url}`);
  return typeof saved === "string" && saved.length < 500 && saved.split(/[?#]/)[0] === url ? saved : url;
}

/** Retry during lazy/async layout, then yield immediately to reader interaction. */
export function useReadingRestoration(url: string, entry: string, returning: boolean) {
  useLayoutEffect(() => {
    const saved = read<Position>(`entry:${entry}:${url}`) ?? (isBrowsingPage(url) ? read<Position>(`position:${url.split("#")[0]}`) : null);
    const position = saved && Number.isFinite(saved.y) && saved.y >= 0 && Number.isFinite(saved.offset) ? saved : null;
    const hash = window.location.hash.slice(1);
    if (!hash && !position) { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); return; }
    let stopped = false;
    let frame = 0;
    const apply = () => {
      if (stopped) return;
      const anchor = document.getElementById(hash || position?.anchor || "");
      const top = anchor ? window.scrollY + anchor.getBoundingClientRect().top - (hash ? 90 : position!.offset) : position?.y ?? 0;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" as ScrollBehavior });
    };
    const schedule = () => { if (!frame && !stopped) frame = requestAnimationFrame(() => { frame = 0; apply(); }); };
    const stop = () => { stopped = true; observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true });
    const cancel = (event: Event) => {
      if (event instanceof KeyboardEvent && !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " ", "Tab"].includes(event.key)) return;
      stop(); mutation.disconnect();
    };
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(type, cancel, { passive: true });
    apply();
    const timeout = window.setTimeout(() => { stop(); mutation.disconnect(); }, 10_000);
    return () => {
      stop(); mutation.disconnect(); window.clearTimeout(timeout);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(type, cancel);
    };
  }, [url, entry, returning]);
}
