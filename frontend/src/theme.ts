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

// Fixed across both modes (status palette is never themed).
export const STATUS_GOOD = "#0ca30c";
export const STATUS_CRITICAL = "#d03b3b";

// Black theme is applied unconditionally (see styles.css), so chart colors are fixed too.
export function getThemeColors(): ThemeColors {
  return DARK;
}

export function watchTheme(_callback: (colors: ThemeColors) => void): () => void {
  return () => {};
}
