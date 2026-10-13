import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { ThemeProvider, CssBaseline, useMediaQuery } from "@mui/material";
import { themes, ThemeName } from "./themes";

type ModePref = "light" | "dark" | "system";
type Ctx = {
  name: ThemeName; setName: (n: ThemeName) => void;
  mode: ModePref;  setMode: (m: ModePref) => void;
};
const ThemeCtx = createContext<Ctx | null>(null);

const load = <T extends string>(key: string, valid: (v: string) => boolean, fallback: T) => {
  const v = localStorage.getItem(key);
  return v && valid(v) ? (v as T) : fallback;
};

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<ThemeName>(() => load("theme", (v) => v in themes, "violet"));
  const [mode, setMode] = useState<ModePref>(() =>
    load("mode", (v) => ["light", "dark", "system"].includes(v), "system"));

  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => localStorage.setItem("theme", name), [name]);
  useEffect(() => localStorage.setItem("mode", mode), [mode]);

  return (
    <ThemeCtx.Provider value={{ name, setName, mode, setMode }}>
      <ThemeProvider theme={themes[name][resolved]}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeCtx.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useAppTheme must be used inside AppThemeProvider");
  return ctx;
}
