import { beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { resetDatabase } from "./helpers/db";

type AuthResponse = {
  token: string;
  user: { id: string; email: string; role: string; tenantId: string };
  tenant: { id: string; name: string };
};

type ApiKeyResponse = { apiKey: string; prefix: string };

type UsageListResponse = {
  range: { from: string; to: string };
  aggregates: Array<{ period: string; metric: string; total: string }>;
};

const app = createApp();

async function createTenantWithApiKey(tenantName: string, email: string) {
  const registerRes = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantName, email, password: "correcthorsebattery" }),
  });
  const auth = (await registerRes.json()) as AuthResponse;

  const apiKeyRes = await app.request("/auth/api-key", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const { apiKey } = (await apiKeyRes.json()) as ApiKeyResponse;

  return { token: auth.token, tenantId: auth.tenant.id, apiKey };
}

function postUsage(apiKey: string, body: Record<string, unknown>) {
  return app.request("/v1/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
}

// No afterAll(closeDb): the Postgres client is a singleton shared by all
// test files within the same `bun test` process.
beforeEach(resetDatabase);

describe("POST /v1/usage", () => {
  it("rejects requests without an API key with 401", async () => {
    const res = await app.request("/v1/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric: "api_calls", quantity: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid API key with 401", async () => {
    const res = await postUsage("mk_live_no-existe", { metric: "api_calls", quantity: 1 });
    expect(res.status).toBe(401);
  });

  it("rejects invalid payloads with 400", async () => {
    const { apiKey } = await createTenantWithApiKey("Acme", "owner@acme.test");
    const res = await postUsage(apiKey, { metric: "", quantity: -1 });
    expect(res.status).toBe(400);
  });

  it("records an event and creates its daily aggregate", async () => {
    const { apiKey } = await createTenantWithApiKey("Acme", "owner@acme.test");

    const res = await postUsage(apiKey, { metric: "api_calls", quantity: 5, unitCost: 0.002 });
    const body = (await res.json()) as {
      event: { metric: string; quantity: string };
      aggregate: { metric: string; total: string };
    };

    expect(res.status).toBe(201);
    expect(body.event.metric).toBe("api_calls");
    expect(Number(body.event.quantity)).toBe(5);
    expect(Number(body.aggregate.total)).toBe(5);
  });

  it("accumulates the aggregate total across successive calls for the same day and metric", async () => {
    const { apiKey } = await createTenantWithApiKey("Acme", "owner@acme.test");

    await postUsage(apiKey, { metric: "tokens", quantity: 100 });
    await postUsage(apiKey, { metric: "tokens", quantity: 250 });
    const third = await postUsage(apiKey, { metric: "tokens", quantity: 1 });
    const body = (await third.json()) as { aggregate: { total: string } };

    expect(Number(body.aggregate.total)).toBe(351);
  });

  it("does not lose increments under concurrent writes (atomic upsert)", async () => {
    const { apiKey } = await createTenantWithApiKey("Acme", "owner@acme.test");

    const CONCURRENT_WRITES = 20;
    await Promise.all(
      Array.from({ length: CONCURRENT_WRITES }, () =>
        postUsage(apiKey, { metric: "concurrent_metric", quantity: 1 }),
      ),
    );

    // We verify the total via the authenticated endpoint of the tenant that owns the key.
    const registerRes = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@acme.test", password: "correcthorsebattery" }),
    });
    const { token } = (await registerRes.json()) as AuthResponse;

    const listRes = await app.request("/v1/usage?metric=concurrent_metric", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()) as UsageListResponse;

    expect(list.aggregates).toHaveLength(1);
    expect(Number(list.aggregates[0]?.total)).toBe(CONCURRENT_WRITES);
  });
});

describe("GET /v1/usage — multi-tenant isolation", () => {
  it("a tenant never sees another tenant's aggregates, even if they use the same metric name", async () => {
    const tenantA = await createTenantWithApiKey("Tenant A", "owner-a@test.com");
    const tenantB = await createTenantWithApiKey("Tenant B", "owner-b@test.com");

    await postUsage(tenantA.apiKey, { metric: "api_calls", quantity: 10 });
    await postUsage(tenantB.apiKey, { metric: "api_calls", quantity: 999 });

    const listA = await app.request("/v1/usage", {
      headers: { Authorization: `Bearer ${tenantA.token}` },
    });
    const bodyA = (await listA.json()) as UsageListResponse;

    expect(bodyA.aggregates).toHaveLength(1);
    expect(Number(bodyA.aggregates[0]?.total)).toBe(10);
  });

  it("rejects reads without a JWT with 401", async () => {
    const res = await app.request("/v1/usage");
    expect(res.status).toBe(401);
  });
});
