import { useSyncExternalStore } from "react";

export type ThemeMode = "dark" | "light";

export interface ThemeColors {
  surface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  gridline: string;
  baseline: string;
  up: string;
  down: string;
  blue: string;
  aqua: string;
  yellow: string;
  violet: string;
  good: string;
  critical: string;
  /** Categorical series slots, assigned by fixed index and never cycled — a chart with
   * several same-kind lines (the DRAM history page's seven spot-price items) needs more
   * distinguishable hues than the four accent tokens above provide.
   *
   * These are a separate set rather than an extension of `blue`/`aqua`/`yellow`/
   * `violet` because the light mode's accents are deliberately dusty, and a palette
   * built from them fails on its own terms at this width: run through the CVD checker
   * against this surface, seven muted hues come back below the chroma floor (aqua and
   * yellow read as gray) with a worst adjacent separation of ΔE 5.8, meaning two of the
   * seven lines are indistinguishable to a deuteranope and nearly so to anyone else.
   * The steps below clear the lightness band, chroma floor, CVD separation and
   * normal-vision floor in both modes.
   *
   * Four of the dark steps are the accent tokens above, so the dark chart still reads
   * as part of this app. On the light surface four of the seven sit below 3:1 contrast,
   * which obliges the relief the history page ships: a labelled legend and a table of
   * the same numbers, so identity never rests on the color alone. */
  series: string[];
}

// Slot order is the colorblind-safety mechanism, not decoration — neighbouring slots
// are the pairs a reader compares, so the ordering is what the separation checks are
// run against. Reordering these requires re-validating, not taste.
const DARK_SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
const LIGHT_SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];

const DARK: ThemeColors = {
  surface: "#1a1a19",
  textPrimary: "#ffffff",
  textSecondary: "#c3c2b7",
  textMuted: "#898781",
  gridline: "#2c2c2a",
  baseline: "#383835",
  up: "#e66767",
  down: "#3987e5",
  blue: "#3987e5",
  aqua: "#199e70",
  yellow: "#c98500",
  violet: "#9085e9",
  good: "#0ca30c",
  critical: "#d03b3b",
  series: DARK_SERIES,
};

// A toned-down, dusty/pastel palette rather than a straight light-mode inversion —
// warm off-white surfaces instead of stark white, and every accent hue pulled a
// notch toward muted/desaturated while still clearing ~3.5:1+ contrast against both
// surfaces (checked with a WCAG calculator, not just eyeballed).
const LIGHT: ThemeColors = {
  surface: "#f8f6f1",
  textPrimary: "#2e2c26",
  textSecondary: "#5c584e",
  textMuted: "#837e72",
  gridline: "#ddd7c8",
  baseline: "#66707d",
  up: "#bd5c66",
  down: "#3f66b8",
  blue: "#3f66b8",
  aqua: "#2f8468",
  yellow: "#9c6a2f",
  violet: "#7367bd",
  good: "#3f8656",
  critical: "#bb5252",
  series: LIGHT_SERIES,
};

const STORAGE_KEY = "site_theme";
const listeners = new Set<() => void>();

function getStoredMode(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

let currentMode: ThemeMode = getStoredMode() ?? "dark";

function applyDomAttribute(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", mode);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", mode === "light" ? "#eae7df" : "#0d0d0d");
}
applyDomAttribute(currentMode);

export function getThemeMode(): ThemeMode {
  return currentMode;
}

export function setThemeMode(mode: ThemeMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  window.localStorage.setItem(STORAGE_KEY, mode);
  applyDomAttribute(mode);
  listeners.forEach((listener) => listener());
}

export function toggleThemeMode(): void {
  setThemeMode(currentMode === "dark" ? "light" : "dark");
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding for the current theme mode — re-renders on toggle, in sync with
 * the DOM `data-theme` attribute the plain-CSS parts of the app key off of. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getThemeMode, getThemeMode);
}

export function getThemeColors(): ThemeColors {
  return currentMode === "light" ? LIGHT : DARK;
}

/** Lets canvas-based charts (lightweight-charts draws to <canvas>, so CSS variables
 * and `transition` don't reach it) re-apply colors imperatively when the theme flips. */
export function watchTheme(callback: (colors: ThemeColors) => void): () => void {
  return subscribe(() => callback(getThemeColors()));
}
