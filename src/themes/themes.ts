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
    dark: { primary: { main: "#D0BCFF" }, background: { default: "#141218", paper: "#1D1B20" } },
  },
  ocean: {
    light: { primary: { main: "#006782" }, background: { default: "#F5FAFC", paper: "#E8F1F5" } },
    dark: { primary: { main: "#7FD1E8" }, background: { default: "#0B1D26", paper: "#102B38" } },
  },
  forest: {
    light: { primary: { main: "#386A20" }, background: { default: "#F8FBF1", paper: "#EBF0E4" } },
    dark: { primary: { main: "#9CD67D" }, background: { default: "#10150E", paper: "#1A2117" } },
  },
  greenApple: {
    light: { primary: { main: "#005927" }, background: { default: "#F6FBF2", paper: "#EAEFE6" } },
    dark: { primary: { main: "#7ADB8F" }, background: { default: "#0F1510", paper: "#1C211C" } },
  },
  lavender: {
    light: { primary: { main: "#6D41C8" }, background: { default: "#EDE2FF", paper: "#E4D5F8" } },
    dark: { primary: { main: "#A177FF" }, background: { default: "#111129", paper: "#1D193B" } },
  },
  midnightDusk: {
    light: { primary: { main: "#BB0054" }, background: { default: "#FFFBFF", paper: "#F9E6F1" } },
    dark: { primary: { main: "#F02475" }, background: { default: "#16151D", paper: "#281624" } },
  },
  strawberry: {
    light: { primary: { main: "#A10833" }, background: { default: "#FAFAFA", paper: "#F6EAED" } },
    dark: { primary: { main: "#FFB2B8" }, background: { default: "#201A1A", paper: "#322727" } },
  },
  tako: {
    light: { primary: { main: "#66577E" }, background: { default: "#F7F5FF", paper: "#E8E0EB" } },
    dark: { primary: { main: "#F3B375" }, background: { default: "#21212E", paper: "#2A2A3C" } },
  },
  tealTurquoise: {
    light: { primary: { main: "#008080" }, background: { default: "#FAFAFA", paper: "#EBF3F1" } },
    dark: { primary: { main: "#40E0D0" }, background: { default: "#202125", paper: "#233133" } },
  },
  tidalWave: {
    light: { primary: { main: "#006780" }, background: { default: "#FDFBFF", paper: "#E8EFF5" } },
    dark: { primary: { main: "#5ED4FC" }, background: { default: "#001C3B", paper: "#082B4B" } },
  },
  yinYang: {
    light: { primary: { main: "#000000" }, background: { default: "#FDFDFD", paper: "#E8E8E8" } },
    dark: { primary: { main: "#FFFFFF" }, background: { default: "#1E1E1E", paper: "#313131" } },
  },
  yotsuba: {
    light: { primary: { main: "#AE3200" }, background: { default: "#FCFCFC", paper: "#F6EBE7" } },
    dark: { primary: { main: "#FFB59D" }, background: { default: "#211A18", paper: "#332723" } },
  },
} satisfies Record<string, Record<Mode, PaletteOptions>>;

export type ThemeName = keyof typeof defs;
export const themeNames = Object.keys(defs) as ThemeName[];

export const themes = Object.fromEntries(
  themeNames.map((n) => [n, { light: make("light", defs[n].light), dark: make("dark", defs[n].dark) }])
) as Record<ThemeName, Record<Mode, Theme>>;
