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
}

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
  baseline: "#9a9382",
  up: "#bd5c66",
  down: "#3f66b8",
  blue: "#3f66b8",
  aqua: "#2f8468",
  yellow: "#9c6a2f",
  violet: "#7367bd",
  good: "#3f8656",
  critical: "#bb5252",
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
