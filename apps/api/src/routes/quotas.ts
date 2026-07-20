import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { quotas } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import type { AppEnv } from "../types";

const upsertQuotaSchema = z.object({
  metric: z.string().trim().min(1).max(100),
  limit: z.number().positive(),
  enforcement: z.enum(["soft", "hard"]),
});

export const quotaRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const tenantId = c.get("user").tenantId;
    const rows = await db.query.quotas.findMany({ where: eq(quotas.tenantId, tenantId) });
    return c.json({ quotas: rows });
  })
  // Crea o actualiza el limite de un metric para el tenant. owner/admin unicamente.
  .post("/", requireAuth, requireRole("owner", "admin"), async (c) => {
    const body = upsertQuotaSchema.parse(await c.req.json());
    const tenantId = c.get("user").tenantId;

    const [quota] = await db
      .insert(quotas)
      .values({
        tenantId,
        metric: body.metric,
        limit: body.limit.toString(),
        enforcement: body.enforcement,
      })
      .onConflictDoUpdate({
        target: [quotas.tenantId, quotas.metric],
        set: { limit: body.limit.toString(), enforcement: body.enforcement },
      })
      .returning();

    return c.json({ quota }, 201);
  });
