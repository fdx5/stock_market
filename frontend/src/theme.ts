import { useSyncExternalStore } from "react";
import { getTone, isNeoDesign, subscribeDesignSettings } from "./neo/settings";

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
  /** Stable categorical colors; chart legends and source tables carry identity as well. */
  series: string[];
}

const DARK: ThemeColors = {
  surface: "#1a1a19", textPrimary: "#ffffff", textSecondary: "#c3c2b7", textMuted: "#898781",
  gridline: "#2c2c2a", baseline: "#383835", up: "#e66767", down: "#3987e5",
  blue: "#3987e5", aqua: "#199e70", yellow: "#c98500", violet: "#9085e9", good: "#0ca30c", critical: "#d03b3b",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"],
};
const NEO: ThemeColors = {
  surface: "#1e1922", textPrimary: "#f3ecdc", textSecondary: "#c3b5c5", textMuted: "#a99aaa",
  gridline: "#3d3042", baseline: "#77637c", up: "#ff6c83", down: "#64aaff",
  blue: "#64aaff", aqua: "#a8bca0", yellow: "#d6b54e", violet: "#bf85ff", good: "#a8bca0", critical: "#ff6c83",
  series: ["#64aaff", "#f27560", "#a8bca0", "#d6b54e", "#ed8dd4", "#f1e4c4", "#bf85ff"],
};
// Light tone of the neon terminal: cool white planes, slate ink, deep neon accents.
const NEO_LIGHT: ThemeColors = {
  surface: "#ffffff", textPrimary: "#25222b", textSecondary: "#5d5568", textMuted: "#7a7285",
  gridline: "#e6e2ec", baseline: "#b9b1c4", up: "#c8304a", down: "#1f63c4",
  blue: "#1f63c4", aqua: "#38735f", yellow: "#94700f", violet: "#7642b8", good: "#2f7a5a", critical: "#c8304a",
  series: ["#1f63c4", "#c9502f", "#38735f", "#94700f", "#b4428f", "#6b6455", "#7642b8"],
};
// A single dark appearance. Stored former light-mode preferences are left intact,
// but no longer control the UI. Presentation never mutates saved user data.
const listeners = new Set<() => void>();
function applyDomAttribute() {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getTone() === "light" ? "#f7f5fa" : isNeoDesign() ? "#100d13" : "#0d0d0d");
}
applyDomAttribute();
export function getThemeMode(): ThemeMode { return "dark"; }
export function syncThemeForPath(_path: string): void { applyDomAttribute(); }
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useThemeMode(): ThemeMode { return useSyncExternalStore(subscribe, getThemeMode, getThemeMode); }
export function getThemeColors(): ThemeColors { return isNeoDesign() ? getTone() === "light" ? NEO_LIGHT : NEO : DARK; }
export function watchTheme(callback: (colors: ThemeColors) => void): () => void { return subscribe(() => callback(getThemeColors())); }
subscribeDesignSettings(() => { applyDomAttribute(); listeners.forEach(listener => listener()); });
