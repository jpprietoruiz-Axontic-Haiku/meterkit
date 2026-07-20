import { and, eq, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { db } from "../db";
import { usageAggregates } from "../db/schema";
import { verifyAuthToken } from "../lib/jwt";
import { startOfUtcDay } from "../lib/period";
import { checkQuota } from "../lib/quotas";
import { recordUsageEvent } from "../lib/usage";
import { buildUsageSnapshot } from "../lib/usage-snapshot";
import { requireApiKey } from "../middleware/api-key";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const SSE_INTERVAL_MS = 3000;

const recordUsageSchema = z.object({
  metric: z.string().trim().min(1).max(100),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const listUsageQuerySchema = z.object({
  metric: z.string().trim().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const DEFAULT_RANGE_DAYS = 30;

export const usageRoutes = new Hono<AppEnv>()
  // Ingestion: protected by tenant API key, meant for server-to-server calls.
  .post("/", requireApiKey, async (c) => {
    const body = recordUsageSchema.parse(await c.req.json());
    const tenantId = c.get("apiKeyTenantId");

    const quotaCheck = await checkQuota(tenantId, body.metric, body.quantity);
    if (quotaCheck.blocked && quotaCheck.quota) {
      throw new HTTPException(429, {
        message:
          `Quota exceeded for "${body.metric}": monthly limit ${quotaCheck.quota.limit}, ` +
          `current usage ${quotaCheck.currentTotal}. This call (${body.quantity}) would exceed it.`,
      });
    }

    const { event, aggregate } = await recordUsageEvent({ tenantId, ...body });

    return c.json(
      {
        event: {
          id: event.id,
          metric: event.metric,
          quantity: event.quantity,
          unitCost: event.unitCost,
          createdAt: event.createdAt,
        },
        aggregate: { period: aggregate.period, metric: aggregate.metric, total: aggregate.total },
        ...(quotaCheck.warning && !quotaCheck.blocked && quotaCheck.quota
          ? {
              quotaWarning: {
                metric: body.metric,
                limit: quotaCheck.quota.limit,
                currentTotal: quotaCheck.projectedTotal,
              },
            }
          : {}),
      },
      201,
    );
  })
  // Read: protected by JWT, consumed by the dashboard.
  .get("/", requireAuth, async (c) => {
    const query = listUsageQuerySchema.parse({
      metric: c.req.query("metric"),
      from: c.req.query("from"),
      to: c.req.query("to"),
    });
    const tenantId = c.get("user").tenantId;

    const to = query.to ? startOfUtcDay(query.to) : startOfUtcDay(new Date());
    const from = query.from
      ? startOfUtcDay(query.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

    const conditions = [
      eq(usageAggregates.tenantId, tenantId),
      gte(usageAggregates.period, from),
      lte(usageAggregates.period, to),
    ];
    if (query.metric) {
      conditions.push(eq(usageAggregates.metric, query.metric));
    }

    const rows = await db
      .select({
        period: usageAggregates.period,
        metric: usageAggregates.metric,
        total: usageAggregates.total,
        cost: usageAggregates.costTotal,
      })
      .from(usageAggregates)
      .where(and(...conditions))
      .orderBy(usageAggregates.period);

    return c.json({ range: { from, to }, aggregates: rows });
  })
  // Live dashboard. EventSource (the browser's native API) cannot send custom
  // headers, so here we also accept the JWT via the query param ?token=...
  // in addition to Authorization: Bearer — only on this endpoint.
  .get("/stream", async (c) => {
    const headerToken = c.req.header("Authorization")?.replace(/^Bearer\s+/, "");
    const token = headerToken ?? c.req.query("token");

    if (!token) {
      throw new HTTPException(401, { message: "Missing token (header or ?token=)" });
    }

    const authUser = await verifyAuthToken(token).catch(() => null);
    if (!authUser) {
      throw new HTTPException(401, { message: "Invalid or expired token" });
    }

    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      while (!aborted) {
        const snapshot = await buildUsageSnapshot(authUser.tenantId);
        await stream.writeSSE({ event: "usage-snapshot", data: JSON.stringify(snapshot) });
        await stream.sleep(SSE_INTERVAL_MS);
      }
    });
  });
