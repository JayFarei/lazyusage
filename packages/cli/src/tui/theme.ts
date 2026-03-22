/**
 * Intentional TUI themes. The default is optimized for dense terminal contrast.
 * Optional selection is environment-driven so public users are not locked into
 * a single hardcoded palette.
 */
import { createStore, reconcile } from "solid-js/store";

export interface Theme {
  base: string;
  surface0: string;
  surface1: string;
  text: string;
  subtext: string;
  cyan: string;
  yellow: string;
  green: string;
  red: string;
  blue: string;
  chartYellow: string;
  chartCyan: string;
  borderActive: string;
  borderInactive: string;
  selectionBg: string;
}

export const catppuccinMocha: Theme = {
  base: "#1e1e2e",
  surface0: "#313244",
  surface1: "#45475a",
  text: "#cdd6f4",
  subtext: "#a6adc8",
  cyan: "#89dceb",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  red: "#f38ba8",
  blue: "#89b4fa",
  chartYellow: "#FFFF00",
  chartCyan: "#89dceb",
  borderActive: "#a6e3a1",
  borderInactive: "#45475a",
  selectionBg: "#313244",
};

export const monochrome: Theme = {
  base: "#111111",
  surface0: "#1f1f1f",
  surface1: "#2b2b2b",
  text: "#f1f1f1",
  subtext: "#b8b8b8",
  cyan: "#d0d0d0",
  yellow: "#e4e4e4",
  green: "#f1f1f1",
  red: "#a8a8a8",
  blue: "#d8d8d8",
  chartYellow: "#f1f1f1",
  chartCyan: "#d8d8d8",
  borderActive: "#f1f1f1",
  borderInactive: "#4a4a4a",
  selectionBg: "#2b2b2b",
};

const THEMES: Record<string, Theme> = {
  "catppuccin-mocha": catppuccinMocha,
  monochrome,
};

function resolveDefaultTheme(): Theme {
  const requested = process.env.LAZYUSAGE_THEME?.trim().toLowerCase();
  return requested && THEMES[requested] ? THEMES[requested] : catppuccinMocha;
}

const [themeStore, setThemeStore] = createStore<Theme>({ ...resolveDefaultTheme() });

export function useTheme(): Theme {
  return themeStore;
}

export function setTheme(preset: Theme): void {
  setThemeStore(reconcile(preset));
}
