import { useEffect, useLayoutEffect } from "react";
import { useBroadsheetFonts } from "./fonts";
import "./desk2.css";
import { pinnedScrollOffset, stopScrollRestoration } from "../scrollNavigation";

/* What every broadsheet page (the desk, 종목정보, 종목상세) needs from outside its
 * own tree: the type families, the <html> class the design tokens hang off, and the
 * ⌘K / "/" shortcut that opens the finder. Kept in one place so the three pages can
 * never disagree about which fonts they load or which class scopes them. */


/** Loads fonts once and scopes the page before paint. Theme belongs to the router. */
export function useBroadsheet(): void {
  useBroadsheetFonts();

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("is-desk2");
    return () => {
      root.classList.remove("is-desk2");
    };
  }, []);
}

/** ⌘K / Ctrl-K anywhere toggles the finder; "/" opens it when nothing is being typed. */
export function useFinderHotkey(setOpen: (update: (open: boolean) => boolean) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(() => true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

/** Height of whatever broadsheet bar is pinned to the top, for scroll targets. */
export function stickyOffset(): number {
  return pinnedScrollOffset();
}

export function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  stopScrollRestoration();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - stickyOffset()), behavior: reduce ? "instant" as ScrollBehavior : "smooth" });
}

/** Scrollspy on a band a third of the way down the screen. */
export function useScrollSpy(ids: string[], onActive: (id: string) => void, deps: unknown[] = []): void {
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) onActive(hit.target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), ...deps]);
}
