import { beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { signAuthToken } from "../src/lib/jwt";
import { resetDatabase } from "./helpers/db";

type AuthResponse = {
  token: string;
  user: { id: string; email: string; role: string; tenantId: string };
  tenant: { id: string; name: string };
};

type ApiKeyResponse = { apiKey: string };

type UsageListResponse = {
  aggregates: Array<{ period: string; metric: string; total: string }>;
};

const app = createApp();

async function createTenant(tenantName: string, email: string) {
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

function setQuota(token: string, body: Record<string, unknown>) {
  return app.request("/quotas", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function postUsage(apiKey: string, body: Record<string, unknown>) {
  return app.request("/v1/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
}

async function getUsageTotal(token: string, metric: string) {
  const res = await app.request(`/v1/usage?metric=${metric}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as UsageListResponse;
  return body.aggregates.reduce((sum, row) => sum + Number(row.total), 0);
}

// No afterAll(closeDb): the Postgres client is a singleton shared by all
// test files within the same `bun test` process.
beforeEach(resetDatabase);

describe("POST /quotas", () => {
  it("only owner/admin can configure quotas (member -> 403)", async () => {
    const tenant = await createTenant("Acme", "owner@acme.test");
    const [member] = await db
      .insert(users)
      .values({
        tenantId: tenant.tenantId,
        email: "member@acme.test",
        passwordHash: "not-used",
        role: "member",
      })
      .returning();
    if (!member) throw new Error("setup failed");
    const memberToken = await signAuthToken({
      sub: member.id,
      tenantId: member.tenantId,
      role: member.role,
      email: member.email,
    });

    const res = await setQuota(memberToken, {
      metric: "api_calls",
      limit: 100,
      enforcement: "hard",
    });
    expect(res.status).toBe(403);
  });

  it("owner can create and update (upsert) a quota", async () => {
    const tenant = await createTenant("Acme", "owner@acme.test");

    const created = await setQuota(tenant.token, {
      metric: "api_calls",
      limit: 100,
      enforcement: "soft",
    });
    expect(created.status).toBe(201);

    const updated = await setQuota(tenant.token, {
      metric: "api_calls",
      limit: 200,
      enforcement: "hard",
    });
    expect(updated.status).toBe(201);

    const list = await app.request("/quotas", {
      headers: { Authorization: `Bearer ${tenant.token}` },
    });
    const body = (await list.json()) as {
      quotas: Array<{ metric: string; limit: string; enforcement: string }>;
    };

    expect(body.quotas).toHaveLength(1);
    expect(Number(body.quotas[0]?.limit)).toBe(200);
    expect(body.quotas[0]?.enforcement).toBe("hard");
  });
});

describe("Soft enforcement", () => {
  it("allows exceeding the limit but includes quotaWarning in the response", async () => {
    const tenant = await createTenant("Acme", "owner@acme.test");
    await setQuota(tenant.token, { metric: "soft_metric", limit: 100, enforcement: "soft" });

    const withinLimit = await postUsage(tenant.apiKey, { metric: "soft_metric", quantity: 50 });
    const withinBody = (await withinLimit.json()) as { quotaWarning?: unknown };
    expect(withinLimit.status).toBe(201);
    expect(withinBody.quotaWarning).toBeUndefined();

    const overLimit = await postUsage(tenant.apiKey, { metric: "soft_metric", quantity: 60 });
    const overBody = (await overLimit.json()) as { quotaWarning?: { limit: number } };
    expect(overLimit.status).toBe(201);
    expect(overBody.quotaWarning?.limit).toBe(100);

    expect(await getUsageTotal(tenant.token, "soft_metric")).toBe(110);
  });
});

describe("Hard enforcement", () => {
  it("blocks with 429 and a clear message, without recording the event that exceeds it", async () => {
    const tenant = await createTenant("Acme", "owner@acme.test");
    await setQuota(tenant.token, { metric: "hard_metric", limit: 100, enforcement: "hard" });

    const withinLimit = await postUsage(tenant.apiKey, { metric: "hard_metric", quantity: 90 });
    expect(withinLimit.status).toBe(201);

    const overLimit = await postUsage(tenant.apiKey, { metric: "hard_metric", quantity: 20 });
    const overBody = (await overLimit.json()) as { error: string };
    expect(overLimit.status).toBe(429);
    expect(overBody.error).toContain("hard_metric");
    expect(overBody.error.toLowerCase()).toContain("quota");

    // The blocked attempt must not have been added to the aggregate.
    expect(await getUsageTotal(tenant.token, "hard_metric")).toBe(90);

    // Right at the limit (100) it should be allowed.
    const atLimit = await postUsage(tenant.apiKey, { metric: "hard_metric", quantity: 10 });
    expect(atLimit.status).toBe(201);
    expect(await getUsageTotal(tenant.token, "hard_metric")).toBe(100);
  });

  it("one tenant's quotas do not affect another tenant with the same metric name", async () => {
    const tenantA = await createTenant("Tenant A", "owner-a@test.com");
    const tenantB = await createTenant("Tenant B", "owner-b@test.com");

    await setQuota(tenantA.token, { metric: "shared_metric", limit: 10, enforcement: "hard" });
    // Tenant B does not configure a quota: it should not experience any enforcement.

    const blockedForA = await postUsage(tenantA.apiKey, { metric: "shared_metric", quantity: 50 });
    const allowedForB = await postUsage(tenantB.apiKey, { metric: "shared_metric", quantity: 50 });

    expect(blockedForA.status).toBe(429);
    expect(allowedForB.status).toBe(201);
  });
});
