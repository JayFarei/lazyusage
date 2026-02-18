/**
 * Reactive theming system with hot-swappable presets.
 * Uses SolidJS store for granular per-property reactivity.
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

const [themeStore, setThemeStore] = createStore<Theme>({ ...catppuccinMocha });

export function useTheme(): Theme {
  return themeStore;
}

export function setTheme(preset: Theme): void {
  setThemeStore(reconcile(preset));
}
