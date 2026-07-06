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

const LIGHT: ThemeColors = {
  surface: "#fcfcfb",
  textPrimary: "#0b0b0b",
  textSecondary: "#52514e",
  textMuted: "#898781",
  gridline: "#e1e0d9",
  baseline: "#c3c2b7",
  up: "#e34948",
  down: "#2a78d6",
  blue: "#2a78d6",
  aqua: "#1baf7a",
  yellow: "#eda100",
  violet: "#4a3aa7",
};

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

// Fixed across both modes (status palette is never themed).
export const STATUS_GOOD = "#0ca30c";
export const STATUS_CRITICAL = "#d03b3b";

export function getThemeColors(): ThemeColors {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return isDark ? DARK : LIGHT;
}

export function watchTheme(callback: (colors: ThemeColors) => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => callback(getThemeColors());
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
