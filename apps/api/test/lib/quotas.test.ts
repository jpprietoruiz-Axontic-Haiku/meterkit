import { describe, expect, it } from "bun:test";
import { evaluateQuota } from "../../src/lib/quotas";

describe("evaluateQuota (unit, no DB)", () => {
  it("does not block or warn when no quota is configured", () => {
    const result = evaluateQuota(999_999, 1, null);
    expect(result).toMatchObject({ blocked: false, warning: false });
  });

  it("soft: allows exceeding the limit but flags a warning", () => {
    const result = evaluateQuota(95, 10, { limit: 100, enforcement: "soft" });
    expect(result.blocked).toBe(false);
    expect(result.warning).toBe(true);
    expect(result.projectedTotal).toBe(105);
  });

  it("soft: does not warn if it stays within the limit", () => {
    const result = evaluateQuota(50, 10, { limit: 100, enforcement: "soft" });
    expect(result.warning).toBe(false);
  });

  it("hard: blocks if the call would exceed the limit", () => {
    const result = evaluateQuota(95, 10, { limit: 100, enforcement: "hard" });
    expect(result.blocked).toBe(true);
    expect(result.warning).toBe(true);
  });

  it("hard: allows reaching exactly the limit, without blocking", () => {
    const result = evaluateQuota(90, 10, { limit: 100, enforcement: "hard" });
    expect(result.blocked).toBe(false);
    expect(result.projectedTotal).toBe(100);
  });

  it("hard: blocks if the limit was already exceeded by previous calls", () => {
    const result = evaluateQuota(150, 1, { limit: 100, enforcement: "hard" });
    expect(result.blocked).toBe(true);
  });
});
