import { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";

const MODULE_EXPANDED_STORAGE_KEY = "cw.module.expanded";

function getStoredBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === "undefined") {
    return fallback;
  }

  const value = localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function useShellPreferences() {
  const [moduleExpanded, setModuleExpanded] = useState<boolean>(() =>
    getStoredBool(MODULE_EXPANDED_STORAGE_KEY, true)
  );
  const { themeMode, resolvedTheme, setThemeMode, isDark } = useTheme();

  useEffect(() => {
    localStorage.setItem(MODULE_EXPANDED_STORAGE_KEY, String(moduleExpanded));
  }, [moduleExpanded]);

  return {
    moduleExpanded,
    setModuleExpanded,
    themeMode,
    resolvedTheme,
    setThemeMode,
    isDark,
  };
}
