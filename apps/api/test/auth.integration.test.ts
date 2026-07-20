import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { closeDb, db } from "../src/db";
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

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

describe("POST /auth/register", () => {
  it("crea un tenant nuevo con su usuario owner y devuelve un JWT", async () => {
    const { res, body } = await register("Acme Inc", "owner@acme.test");

    expect(res.status).toBe(201);
    expect(body.token).toBeTypeOf("string");
    expect(body.user.role).toBe("owner");
    expect(body.tenant.name).toBe("Acme Inc");
  });

  it("rechaza un email duplicado con 409", async () => {
    await register("Acme Inc", "owner@acme.test");
    const { res } = await register("Otra empresa", "owner@acme.test");

    expect(res.status).toBe(409);
  });

  it("rechaza payloads invalidos con 400", async () => {
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantName: "", email: "no-es-un-email", password: "123" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("devuelve un JWT valido con credenciales correctas", async () => {
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

  it("rechaza contrasena incorrecta con 401 sin filtrar si el email existe", async () => {
    await register("Acme Inc", "owner@acme.test", "correcthorsebattery");

    const wrongPassword = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@acme.test", password: "incorrecta" }),
    });
    const unknownEmail = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "no-existe@acme.test", password: "cualquiera" }),
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
  });
});

describe("Aislamiento multi-tenant", () => {
  it("un tenant no puede ver ni modificar datos de otro tenant via /auth/me y /auth/api-key", async () => {
    const tenantA = await register("Tenant A", "owner-a@test.com");
    const tenantB = await register("Tenant B", "owner-b@test.com");

    // El owner de A rota su API key.
    const rotate = await app.request("/auth/api-key", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantA.body.token}` },
    });
    expect(rotate.status).toBe(200);

    // /auth/me de cada tenant solo debe reflejar sus propios datos.
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
    // La rotacion de API key de A no debe haber tocado a B.
    expect(meBBody.tenant.apiKeyPrefix).toBeFalsy();

    // Verificacion directa en base de datos: el hash de B sigue siendo null.
    const tenantBRow = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantB.body.tenant.id),
    });
    expect(tenantBRow?.apiKeyHash).toBeNull();

    // Los usuarios de cada tenant solo existen bajo su propio tenant_id.
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
  it("un member no puede rotar la API key del tenant (403)", async () => {
    const tenantA = await register("Tenant A", "owner-a@test.com");

    // No hay endpoint de invitacion en este hito; se inserta un member directamente
    // para probar el enforcement de rol sobre un endpoint owner/admin.
    const [member] = await db
      .insert(users)
      .values({
        tenantId: tenantA.body.tenant.id,
        email: "member-a@test.com",
        passwordHash: "not-used-in-this-test",
        role: "member",
      })
      .returning();
    if (!member) throw new Error("setup fallido");

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

  it("rechaza peticiones sin token con 401", async () => {
    const res = await app.request("/auth/me");
    expect(res.status).toBe(401);
  });
});
