import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type AppTheme = "light" | "dark" | "eyecare";

const STORAGE_KEY = "ece-hub-buddy-theme";
const THEMES: AppTheme[] = ["light", "dark", "eyecare"];

function readStoredTheme(): AppTheme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  // This is purely a display preference — never anything session/role
  // related — so it's fine to read/write localStorage directly here,
  // unlike auth state which AuthContext deliberately keeps out of it.
  return THEMES.includes(stored as AppTheme) ? (stored as AppTheme) : "light";
}

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(readStoredTheme);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
