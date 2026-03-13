import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getStoredThemeMode,
  getSystemTheme,
  resolveThemeMode,
  Theme,
  ThemeMode,
  THEME_MODE_STORAGE_KEY,
} from "@/utils/theme";

interface ThemeContextType {
  themeMode: ThemeMode;
  resolvedTheme: Theme;
  isDark: boolean;
  setThemeMode: (themeMode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  themeMode: "system",
  resolvedTheme: "light",
  isDark: false,
  setThemeMode: () => {},
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    getStoredThemeMode()
  );
  const [systemTheme, setSystemTheme] = useState<Theme>(() => getSystemTheme());

  const resolvedTheme = resolveThemeMode(themeMode, systemTheme);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemTheme(getSystemTheme());
    updateSystemTheme();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateSystemTheme);
      return () => mediaQuery.removeEventListener("change", updateSystemTheme);
    }

    mediaQuery.addListener(updateSystemTheme);
    return () => mediaQuery.removeListener(updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.setAttribute("data-theme-mode", themeMode);
    localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
    localStorage.setItem("cw-theme", resolvedTheme);
  }, [resolvedTheme, themeMode]);

  const toggleTheme = () =>
    setThemeMode((mode) =>
      resolveThemeMode(mode, systemTheme) === "dark" ? "light" : "dark"
    );

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        resolvedTheme,
        isDark: resolvedTheme === "dark",
        setThemeMode,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
