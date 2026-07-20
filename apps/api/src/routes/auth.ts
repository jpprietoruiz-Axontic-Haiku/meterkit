import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../db";
import { tenants, users } from "../db/schema";
import { generateApiKey } from "../lib/api-key";
import { signAuthToken } from "../lib/jwt";
import { hashPassword, verifyPassword } from "../lib/password";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import type { AppEnv } from "../types";

const registerSchema = z.object({
  tenantName: z.string().trim().min(1, "tenantName is required").max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function toPublicUser(user: { id: string; email: string; role: string; tenantId: string }) {
  return { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId };
}

export const authRoutes = new Hono<AppEnv>()
  .post("/register", async (c) => {
    const body = registerSchema.parse(await c.req.json());

    const existing = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (existing) {
      throw new HTTPException(409, { message: "An account with that email already exists" });
    }

    const passwordHash = await hashPassword(body.password);

    // Registration always creates a brand-new tenant with its first user as owner:
    // MeterKit does not (yet) support inviting users to an existing tenant via self-serve.
    const { tenant, user } = await db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ name: body.tenantName }).returning();
      if (!tenant) throw new Error("Failed to create the tenant");

      const [user] = await tx
        .insert(users)
        .values({
          tenantId: tenant.id,
          email: body.email,
          passwordHash,
          role: "owner",
        })
        .returning();
      if (!user) throw new Error("Failed to create the user");

      return { tenant, user };
    });

    const token = await signAuthToken({
      sub: user.id,
      tenantId: tenant.id,
      role: user.role,
      email: user.email,
    });

    return c.json(
      { token, user: toPublicUser(user), tenant: { id: tenant.id, name: tenant.name } },
      201,
    );
  })
  .post("/login", async (c) => {
    const body = loginSchema.parse(await c.req.json());

    const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    const validPassword = user ? await verifyPassword(body.password, user.passwordHash) : false;

    if (!user || !validPassword) {
      throw new HTTPException(401, { message: "Incorrect email or password" });
    }

    const token = await signAuthToken({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    });

    return c.json({ token, user: toPublicUser(user) });
  })
  .get("/me", requireAuth, async (c) => {
    const authUser = c.get("user");

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, authUser.tenantId) });
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }

    return c.json({
      user: { id: authUser.sub, email: authUser.email, role: authUser.role },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
        apiKeyPrefix: tenant.apiKeyPrefix,
        subscriptionStatus: tenant.subscriptionStatus,
      },
    });
  })
  // Issues/rotates the tenant's API key. The plaintext value is only ever returned in this
  // response; from here on only its hash is persisted (see lib/api-key.ts).
  .post("/api-key", requireAuth, requireRole("owner", "admin"), async (c) => {
    const authUser = c.get("user");
    const generated = await generateApiKey();

    await db
      .update(tenants)
      .set({ apiKeyHash: generated.hash, apiKeyPrefix: generated.prefix, updatedAt: new Date() })
      .where(eq(tenants.id, authUser.tenantId));

    return c.json({ apiKey: generated.plaintext, prefix: generated.prefix });
  });
