import { createTheme, Theme, ThemeOptions, PaletteOptions } from "@mui/material/styles";

export type Mode = "light" | "dark";

const base: ThemeOptions = {
  shape: { borderRadius: 16 },
  typography: { fontFamily: "Roboto, sans-serif" },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 999, textTransform: "none" } },
    },
  },
};

const make = (mode: Mode, palette: PaletteOptions) =>
  createTheme({ ...base, palette: { ...palette, mode } });

// Add a theme = add one entry with a light and a dark palette
const defs = {
  violet: {
    light: { primary: { main: "#6750A4" }, background: { default: "#FEF7FF", paper: "#F3EDF7" } },
    dark:  { primary: { main: "#D0BCFF" }, background: { default: "#141218", paper: "#1D1B20" } },
  },
  ocean: {
    light: { primary: { main: "#006782" }, background: { default: "#F5FAFC", paper: "#E8F1F5" } },
    dark:  { primary: { main: "#7FD1E8" }, background: { default: "#0B1D26", paper: "#102B38" } },
  },
  forest: {
    light: { primary: { main: "#386A20" }, background: { default: "#F8FBF1", paper: "#EBF0E4" } },
    dark:  { primary: { main: "#9CD67D" }, background: { default: "#10150E", paper: "#1A2117" } },
  },
} satisfies Record<string, Record<Mode, PaletteOptions>>;

export type ThemeName = keyof typeof defs;
export const themeNames = Object.keys(defs) as ThemeName[];

export const themes = Object.fromEntries(
  themeNames.map((n) => [n, { light: make("light", defs[n].light), dark: make("dark", defs[n].dark) }])
) as Record<ThemeName, Record<Mode, Theme>>;
