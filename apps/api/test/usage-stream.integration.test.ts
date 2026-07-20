import { beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { resetDatabase } from "./helpers/db";

type AuthResponse = { token: string; tenant: { id: string; name: string } };
type ApiKeyResponse = { apiKey: string };

const app = createApp();

async function createTenantWithApiKey() {
  const registerRes = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantName: "Acme",
      email: "owner@acme.test",
      password: "correcthorsebattery",
    }),
  });
  const auth = (await registerRes.json()) as AuthResponse;

  const apiKeyRes = await app.request("/auth/api-key", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const { apiKey } = (await apiKeyRes.json()) as ApiKeyResponse;

  return { token: auth.token, apiKey };
}

async function readFirstSseEvent(res: Response): Promise<unknown> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The response has no stream body");

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout waiting for the first SSE event")), 5000),
  );

  const chunk = await Promise.race([reader.read(), timeout]);
  await reader.cancel().catch(() => {});

  if (chunk.done || !chunk.value) throw new Error("Stream closed without data");
  const text = new TextDecoder().decode(chunk.value);
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error(`No "data:" line found in: ${text}`);
  return JSON.parse(dataLine.slice("data:".length).trim());
}

// No afterAll(closeDb): the Postgres client is a singleton shared by all
// test files within the same `bun test` process.
beforeEach(resetDatabase);

describe("GET /v1/usage/stream", () => {
  it("rejects without a token (neither header nor query param) with 401", async () => {
    const res = await app.request("/v1/usage/stream");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token with 401", async () => {
    const res = await app.request("/v1/usage/stream?token=this-is-not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("accepts the token via query param (EventSource cannot send headers) and emits a snapshot", async () => {
    const { token, apiKey } = await createTenantWithApiKey();

    await app.request("/v1/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ metric: "api_calls", quantity: 42 }),
    });

    const res = await app.request(`/v1/usage/stream?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const snapshot = (await readFirstSseEvent(res)) as {
      usage: Array<{ metric: string; total: number }>;
    };
    expect(snapshot.usage).toContainEqual(
      expect.objectContaining({ metric: "api_calls", total: 42 }),
    );
  });
});
