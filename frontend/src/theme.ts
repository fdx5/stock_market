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
};

// Deepened relative to their dark-theme counterparts so text/lines drawn in these
// hues keep roughly the same contrast against a white/near-white page instead of
// washing out (verified against WCAG contrast targets, not just eyeballed).
const LIGHT: ThemeColors = {
  surface: "#ffffff",
  textPrimary: "#17160f",
  textSecondary: "#55534b",
  textMuted: "#6e6b62",
  gridline: "#e5e2d8",
  baseline: "#d2cfc3",
  up: "#d1445b",
  down: "#2f6fd6",
  blue: "#2f6fd6",
  aqua: "#128a5e",
  yellow: "#a06600",
  violet: "#6a5ed1",
};

// Fixed across both modes (status palette is never themed).
export const STATUS_GOOD = "#0ca30c";
export const STATUS_CRITICAL = "#d03b3b";

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
