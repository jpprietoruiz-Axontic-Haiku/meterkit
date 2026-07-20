import { describe, expect, it } from "bun:test";
import { evaluateQuota } from "../../src/lib/quotas";

describe("evaluateQuota (unit, sin DB)", () => {
  it("no bloquea ni avisa si no hay cuota configurada", () => {
    const result = evaluateQuota(999_999, 1, null);
    expect(result).toMatchObject({ blocked: false, warning: false });
  });

  it("soft: permite superar el limite pero marca warning", () => {
    const result = evaluateQuota(95, 10, { limit: 100, enforcement: "soft" });
    expect(result.blocked).toBe(false);
    expect(result.warning).toBe(true);
    expect(result.projectedTotal).toBe(105);
  });

  it("soft: no avisa si se queda dentro del limite", () => {
    const result = evaluateQuota(50, 10, { limit: 100, enforcement: "soft" });
    expect(result.warning).toBe(false);
  });

  it("hard: bloquea si la llamada superaria el limite", () => {
    const result = evaluateQuota(95, 10, { limit: 100, enforcement: "hard" });
    expect(result.blocked).toBe(true);
    expect(result.warning).toBe(true);
  });

  it("hard: permite llegar exactamente al limite, sin bloquear", () => {
    const result = evaluateQuota(90, 10, { limit: 100, enforcement: "hard" });
    expect(result.blocked).toBe(false);
    expect(result.projectedTotal).toBe(100);
  });

  it("hard: bloquea si ya se habia superado el limite en llamadas previas", () => {
    const result = evaluateQuota(150, 1, { limit: 100, enforcement: "hard" });
    expect(result.blocked).toBe(true);
  });
});
