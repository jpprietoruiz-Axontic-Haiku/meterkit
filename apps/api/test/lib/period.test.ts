import { describe, expect, it } from "bun:test";
import { startOfUtcDay, startOfUtcMonth } from "../../src/lib/period";

describe("startOfUtcDay", () => {
  it("truncates to UTC midnight while preserving the day", () => {
    const input = new Date("2026-07-20T18:42:07.123Z");
    expect(startOfUtcDay(input).toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });
});

describe("startOfUtcMonth", () => {
  it("truncates to the first day of the month in UTC", () => {
    const input = new Date("2026-07-20T18:42:07.123Z");
    expect(startOfUtcMonth(input).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
