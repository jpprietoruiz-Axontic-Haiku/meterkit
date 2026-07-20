import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db } from "../db";
import { tenants } from "../db/schema";
import { hashApiKey } from "../lib/api-key";
import type { AppEnv } from "../types";

/** Autentica requests de ingestion (POST /v1/usage) via `x-api-key`, resolviendo el tenant. */
export const requireApiKey = createMiddleware<AppEnv>(async (c, next) => {
  const apiKey = c.req.header("x-api-key");

  if (!apiKey) {
    throw new HTTPException(401, { message: "Falta el header x-api-key" });
  }

  const hash = await hashApiKey(apiKey);
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.apiKeyHash, hash) });

  if (!tenant) {
    throw new HTTPException(401, { message: "API key invalida" });
  }

  c.set("apiKeyTenantId", tenant.id);
  await next();
});
