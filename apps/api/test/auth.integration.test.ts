import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { db } from "../src/db";
import { tenants, users } from "../src/db/schema";
import { signAuthToken } from "../src/lib/jwt";
import { resetDatabase } from "./helpers/db";

type AuthResponse = {
  token: string;
  user: { id: string; email: string; role: string; tenantId: string };
  tenant: { id: string; name: string };
};

type MeResponse = {
  user: { id: string; email: string; role: string };
  tenant: { id: string; name: string; plan: string; apiKeyPrefix: string | null };
};

const app = createApp();

async function register(tenantName: string, email: string, password = "correcthorsebattery") {
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantName, email, password }),
  });
  return { res, body: (await res.json()) as AuthResponse };
}

// No afterAll(closeDb) here: the Postgres client (src/db) is a singleton
// shared by the entire `bun test` process, which runs all test files in
// the same process. Closing it at the end of one file breaks the
// connection for the following ones. The test process ends and releases
// the socket on its own; there's no need to close it manually.
beforeEach(resetDatabase);

describe("POST /auth/register", () => {
  it("creates a new tenant with its owner user and returns a JWT", async () => {
    const { res, body } = await register("Acme Inc", "owner@acme.test");

    expect(res.status).toBe(201);
    expect(body.token).toBeTypeOf("string");
    expect(body.user.role).toBe("owner");
    expect(body.tenant.name).toBe("Acme Inc");
  });

  it("rejects a duplicate email with 409", async () => {
    await register("Acme Inc", "owner@acme.test");
    const { res } = await register("Otra empresa", "owner@acme.test");

    expect(res.status).toBe(409);
  });

  it("rejects invalid payloads with 400", async () => {
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantName: "", email: "not-an-email", password: "123" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("returns a valid JWT with correct credentials", async () => {
    await register("Acme Inc", "owner@acme.test", "correcthorsebattery");

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@acme.test", password: "correcthorsebattery" }),
    });
    const body = (await res.json()) as AuthResponse;

    expect(res.status).toBe(200);
    expect(body.token).toBeTypeOf("string");
  });

  it("rejects an incorrect password with 401 without leaking whether the email exists", async () => {
    await register("Acme Inc", "owner@acme.test", "correcthorsebattery");

    const wrongPassword = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@acme.test", password: "wrong-password" }),
    });
    const unknownEmail = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "does-not-exist@acme.test", password: "whatever" }),
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
  });
});

describe("Multi-tenant isolation", () => {
  it("a tenant cannot view or modify another tenant's data via /auth/me and /auth/api-key", async () => {
    const tenantA = await register("Tenant A", "owner-a@test.com");
    const tenantB = await register("Tenant B", "owner-b@test.com");

    // A's owner rotates their API key.
    const rotate = await app.request("/auth/api-key", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantA.body.token}` },
    });
    expect(rotate.status).toBe(200);

    // /auth/me for each tenant must only reflect its own data.
    const meA = await app.request("/auth/me", {
      headers: { Authorization: `Bearer ${tenantA.body.token}` },
    });
    const meB = await app.request("/auth/me", {
      headers: { Authorization: `Bearer ${tenantB.body.token}` },
    });
    const meABody = (await meA.json()) as MeResponse;
    const meBBody = (await meB.json()) as MeResponse;

    expect(meABody.tenant.id).toBe(tenantA.body.tenant.id);
    expect(meABody.tenant.apiKeyPrefix).toBeTruthy();
    expect(meBBody.tenant.id).toBe(tenantB.body.tenant.id);
    // A's API key rotation must not have affected B.
    expect(meBBody.tenant.apiKeyPrefix).toBeFalsy();

    // Direct database check: B's hash is still null.
    const tenantBRow = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantB.body.tenant.id),
    });
    expect(tenantBRow?.apiKeyHash).toBeNull();

    // Each tenant's users only exist under their own tenant_id.
    const usersOfA = await db.query.users.findMany({
      where: eq(users.tenantId, tenantA.body.tenant.id),
    });
    const usersOfB = await db.query.users.findMany({
      where: eq(users.tenantId, tenantB.body.tenant.id),
    });

    expect(usersOfA).toHaveLength(1);
    expect(usersOfB).toHaveLength(1);
    expect(usersOfA[0]?.email).toBe("owner-a@test.com");
    expect(usersOfB[0]?.email).toBe("owner-b@test.com");
  });
});

describe("RBAC", () => {
  it("a member cannot rotate the tenant's API key (403)", async () => {
    const tenantA = await register("Tenant A", "owner-a@test.com");

    // There's no invitation endpoint at this milestone; a member is inserted directly
    // to test role enforcement on an owner/admin endpoint.
    const [member] = await db
      .insert(users)
      .values({
        tenantId: tenantA.body.tenant.id,
        email: "member-a@test.com",
        passwordHash: "not-used-in-this-test",
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

    const res = await app.request("/auth/api-key", {
      method: "POST",
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(res.status).toBe(403);
  });

  it("rejects requests without a token with 401", async () => {
    const res = await app.request("/auth/me");
    expect(res.status).toBe(401);
  });
});
