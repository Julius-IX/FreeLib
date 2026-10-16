import { createContext, useContext, ReactNode } from "react";
import { ThemeProvider, CssBaseline, useMediaQuery } from "@mui/material";
import { themes, ThemeName } from "./themes";
import { useSetting } from "@/lib/settings";

type ModePref = "light" | "dark" | "system";
type Ctx = {
  name: ThemeName; setName: (n: ThemeName) => void;
  mode: ModePref;  setMode: (m: ModePref) => void;
};
const ThemeCtx = createContext<Ctx | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useSetting<ThemeName>("theme", "violet", (v): v is ThemeName => typeof v === "string" && v in themes);
  const [mode, setMode] = useSetting<ModePref>("mode", "system", (v): v is ModePref => v === "light" || v === "dark" || v === "system");

  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;

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
