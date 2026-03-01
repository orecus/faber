import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";

export type Theme = "dark-glass" | "dark-flat" | "light-glass" | "light-flat";

const THEMES: Theme[] = ["dark-glass", "dark-flat", "light-glass", "light-flat"];

/** Detect OS dark mode preference. */
function osPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

/** Pick the right default theme based on OS preference. */
function getDefaultTheme(): Theme {
  const dark = osPrefersDark();
  return dark ? "dark-glass" : "light-glass";
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
  isGlass: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isValidTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.includes(value as Theme);
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const defaultTheme = getDefaultTheme();
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  // Apply the default theme immediately (before persisted theme loads)
  useEffect(() => {
    applyTheme(defaultTheme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load persisted theme on mount
  useEffect(() => {
    invoke<string | null>("get_setting", { key: "theme" })
      .then((saved) => {
        if (isValidTheme(saved)) {
          const effective = saved;
          setThemeState(effective);
          applyTheme(effective);
        }
      })
      .catch(() => {
        // Backend unavailable — keep default
      });
  }, []);

  const setTheme = useCallback((next: Theme) => {
    const effective = next;
    setThemeState(effective);
    applyTheme(effective);
    invoke("set_setting", { key: "theme", value: effective }).catch(() => {
      // Persist failure is non-fatal
    });
  }, []);

  const isDark = theme.startsWith("dark");
  const isGlass = theme.endsWith("glass");

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isDark, isGlass }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
