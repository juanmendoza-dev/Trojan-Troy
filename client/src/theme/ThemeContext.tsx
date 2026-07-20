import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveDomAttrs, type ThemeName, type Scheme } from "./theme";

const STORAGE_KEY = "trojan-troy-theme";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "apple" || stored === "iris" || stored === "pulse" ? stored : "iris";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(readStoredTheme);
  const [systemScheme, setSystemScheme] = useState<Scheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setSystemScheme(event.matches ? "dark" : "light");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const attrs = resolveDomAttrs(theme, systemScheme);
    document.documentElement.dataset.theme = attrs.theme;
    if (attrs.scheme) {
      document.documentElement.dataset.scheme = attrs.scheme;
    } else {
      delete document.documentElement.dataset.scheme;
    }
  }, [theme, systemScheme]);

  function setTheme(next: ThemeName) {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  const value = useMemo(() => ({ theme, setTheme }), [theme, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
