import { describe, expect, it } from "bun:test";
import { startOfUtcDay, startOfUtcMonth } from "../../src/lib/period";

describe("startOfUtcDay", () => {
  it("trunca a medianoche UTC preservando el dia", () => {
    const input = new Date("2026-07-20T18:42:07.123Z");
    expect(startOfUtcDay(input).toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });
});

describe("startOfUtcMonth", () => {
  it("trunca al primer dia del mes en UTC", () => {
    const input = new Date("2026-07-20T18:42:07.123Z");
    expect(startOfUtcMonth(input).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
