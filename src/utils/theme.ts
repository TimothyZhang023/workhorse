export type Theme = "light" | "dark";
export type ThemeMode = "system" | Theme;

export const THEME_MODE_STORAGE_KEY = "cw-theme-mode";
export const LEGACY_THEME_STORAGE_KEYS = ["cw-theme", "timo-theme"] as const;

export function getSystemTheme(
  matchMediaImpl:
    | ((query: string) => MediaQueryList)
    | undefined = typeof window !== "undefined"
    ? window.matchMedia.bind(window)
    : undefined
): Theme {
  if (!matchMediaImpl) {
    return "light";
  }

  return matchMediaImpl("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveThemeMode(
  themeMode: ThemeMode,
  systemTheme: Theme
): Theme {
  return themeMode === "system" ? systemTheme : themeMode;
}

export function getStoredThemeMode(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage !==
  "undefined"
    ? localStorage
    : undefined
): ThemeMode {
  if (!storage) {
    return "system";
  }

  const mode = storage.getItem(THEME_MODE_STORAGE_KEY);
  if (mode === "system" || mode === "light" || mode === "dark") {
    return mode;
  }

  for (const legacyKey of LEGACY_THEME_STORAGE_KEYS) {
    const legacyTheme = storage.getItem(legacyKey);
    if (legacyTheme === "light" || legacyTheme === "dark") {
      return legacyTheme;
    }
  }

  return "system";
}
