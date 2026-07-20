import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";

describe("GET /health", () => {
  it("responde 200 con status ok", async () => {
    const app = createApp();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
