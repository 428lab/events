import { createContext, useContext, useMemo, useState } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { DEFAULT_THEME_KEY, THEMES } from "./themes.js";
import { FireworksBackground } from "../components/FireworksBackground.js";

interface ThemeCtx {
  themeKey: string;
  setThemeKey: (k: string) => void;
  fireworksOn: boolean;
  setFireworksOn: (v: boolean) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const THEME_LS = "eventer.theme";
const FW_LS = "eventer.fireworks";

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeKey, setThemeKeyState] = useState<string>(() => {
    const saved = localStorage.getItem(THEME_LS);
    return saved && THEMES[saved] ? saved : DEFAULT_THEME_KEY;
  });
  const [fireworksOn, setFireworksOnState] = useState<boolean>(
    () => localStorage.getItem(FW_LS) !== "off",
  );

  const setThemeKey = (k: string) => {
    setThemeKeyState(k);
    localStorage.setItem(THEME_LS, k);
  };
  const setFireworksOn = (v: boolean) => {
    setFireworksOnState(v);
    localStorage.setItem(FW_LS, v ? "on" : "off");
  };

  const def = THEMES[themeKey] ?? THEMES[DEFAULT_THEME_KEY];
  const value = useMemo(
    () => ({ themeKey, setThemeKey, fireworksOn, setFireworksOn }),
    [themeKey, fireworksOn],
  );

  return (
    <Ctx.Provider value={value}>
      <ThemeProvider theme={def.theme}>
        <CssBaseline />
        {fireworksOn && def.fireworks && (
          <FireworksBackground colors={def.fireworks} />
        )}
        {/* コンテンツを花火canvas(z0)より前面に。花火は背面でかすかに見える */}
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </ThemeProvider>
    </Ctx.Provider>
  );
}

export function useThemeSettings(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useThemeSettings must be used within AppThemeProvider");
  return v;
}
