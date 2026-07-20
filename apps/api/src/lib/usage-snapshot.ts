import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { quotas, usageAggregates } from "../db/schema";
import { startOfUtcMonth } from "./period";

export type UsageSnapshot = {
  generatedAt: string;
  monthStart: string;
  usage: Array<{ metric: string; total: number; cost: number }>;
  quotas: Array<{
    metric: string;
    limit: number;
    enforcement: string;
    currentTotal: number;
    percentUsed: number;
  }>;
};

/**
 * Snapshot of the current month's consumption for the live dashboard: totals +
 * estimated cost per metric, and the % of each quota consumed. Reused both by
 * the SSE endpoint (milestone 6) and, potentially, by any view that needs
 * "where am I right now" without requesting history.
 */
export async function buildUsageSnapshot(tenantId: string): Promise<UsageSnapshot> {
  const monthStart = startOfUtcMonth(new Date());

  const [usageRows, quotaRows] = await Promise.all([
    db
      .select({
        metric: usageAggregates.metric,
        total: sql<string>`coalesce(sum(${usageAggregates.total}), 0)`,
        cost: sql<string>`coalesce(sum(${usageAggregates.costTotal}), 0)`,
      })
      .from(usageAggregates)
      .where(and(eq(usageAggregates.tenantId, tenantId), gte(usageAggregates.period, monthStart)))
      .groupBy(usageAggregates.metric),
    db.query.quotas.findMany({ where: eq(quotas.tenantId, tenantId) }),
  ]);

  const totalsByMetric = new Map(usageRows.map((row) => [row.metric, Number(row.total)]));

  return {
    generatedAt: new Date().toISOString(),
    monthStart: monthStart.toISOString(),
    usage: usageRows.map((row) => ({
      metric: row.metric,
      total: Number(row.total),
      cost: Number(row.cost),
    })),
    quotas: quotaRows.map((quota) => {
      const currentTotal = totalsByMetric.get(quota.metric) ?? 0;
      const limit = Number(quota.limit);
      return {
        metric: quota.metric,
        limit,
        enforcement: quota.enforcement,
        currentTotal,
        percentUsed: limit > 0 ? Math.round((currentTotal / limit) * 1000) / 10 : 0,
      };
    }),
  };
}
