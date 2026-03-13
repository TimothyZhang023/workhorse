import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthHeaders, resolveApiUrl } from "../src/services/request";

describe("request utils", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps relative api paths in browser dev mode", () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:" },
    });

    expect(resolveApiUrl("/api/system/overview")).toBe("/api/system/overview");
  });

  it("targets the local backend when running in desktop mode", () => {
    vi.stubGlobal("window", {
      location: { protocol: "tauri:" },
    });

    expect(resolveApiUrl("/api/system/overview")).toBe(
      "http://127.0.0.1:8080/api/system/overview"
    );
  });

  it("only includes auth headers when a token exists", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => (key === "token" ? "abc123" : null)),
    });

    expect(createAuthHeaders()).toEqual({
      Authorization: "Bearer abc123",
    });
  });
});
