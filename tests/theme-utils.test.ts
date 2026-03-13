import { describe, expect, it } from "vitest";
import {
  getStoredThemeMode,
  getSystemTheme,
  resolveThemeMode,
} from "../src/utils/theme";

describe("theme utils", () => {
  it("prefers explicit theme mode over legacy keys", () => {
    const storage = {
      getItem(key: string) {
        if (key === "cw-theme-mode") return "system";
        if (key === "cw-theme") return "dark";
        return null;
      },
    };

    expect(getStoredThemeMode(storage)).toBe("system");
  });

  it("falls back to legacy theme keys when mode is absent", () => {
    const storage = {
      getItem(key: string) {
        if (key === "cw-theme") return "dark";
        return null;
      },
    };

    expect(getStoredThemeMode(storage)).toBe("dark");
  });

  it("resolves system mode using the current OS preference", () => {
    expect(
      getSystemTheme(
        () =>
          ({
            matches: true,
          } as MediaQueryList)
      )
    ).toBe("dark");
    expect(resolveThemeMode("system", "light")).toBe("light");
    expect(resolveThemeMode("dark", "light")).toBe("dark");
  });
});
