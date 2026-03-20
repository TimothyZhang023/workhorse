import { describe, expect, it } from "vitest";

import {
  guessPrimaryCommand,
  parseInstallShareUrl,
} from "../src/utils/installShare";

describe("install share utils", () => {
  it("parses a workhorse install deep link", () => {
    expect(
      parseInstallShareUrl("workhorse://install?bundle=abc123")
    ).toEqual({
      bundle: "abc123",
      pathname: "",
    });
  });

  it("rejects non-workhorse urls", () => {
    expect(parseInstallShareUrl("https://example.com/install?bundle=abc")).toBeNull();
    expect(parseInstallShareUrl("workhorse://install")).toBeNull();
  });

  it("selects a reasonable default command", () => {
    expect(
      guessPrimaryCommand({
        macos: "open 'workhorse://install?bundle=abc'",
        linux: "xdg-open 'workhorse://install?bundle=abc'",
        windows: 'start "" "workhorse://install?bundle=abc"',
      })
    ).toContain("open");
  });
});
