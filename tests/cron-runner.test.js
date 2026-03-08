import { describe, expect, it } from "vitest";
import { getNextRunAt } from "../server/models/cronRunner.js";

describe("cronRunner", () => {
  it("computes the next run for 5-field cron expressions", () => {
    const nextRun = getNextRunAt("*/2 * * * *");

    expect(Number.isNaN(Date.parse(nextRun))).toBe(false);
  });

  it("computes the next run for 6-field cron expressions", () => {
    const nextRun = getNextRunAt("*/10 * * * * *");

    expect(Number.isNaN(Date.parse(nextRun))).toBe(false);
  });
});
