import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import type { QuotaEnforcement } from "../db/schema";
import { quotas, usageAggregates } from "../db/schema";
import { startOfUtcMonth } from "./period";

export type QuotaLimit = { limit: number; enforcement: QuotaEnforcement };

export type QuotaEvaluation = {
  blocked: boolean;
  warning: boolean;
  currentTotal: number;
  projectedTotal: number;
  quota: QuotaLimit | null;
};

/**
 * Pure enforcement decision: given the consumption already accumulated in the
 * period, the incoming quantity, and the configured quota (if any), decides
 * whether to block (hard) or just warn (soft). No I/O — testable in
 * isolation.
 */
export function evaluateQuota(
  currentTotal: number,
  quantity: number,
  quota: QuotaLimit | null,
): QuotaEvaluation {
  const projectedTotal = currentTotal + quantity;

  if (!quota) {
    return { blocked: false, warning: false, currentTotal, projectedTotal, quota: null };
  }

  const wouldExceed = projectedTotal > quota.limit;

  return {
    blocked: wouldExceed && quota.enforcement === "hard",
    warning: wouldExceed,
    currentTotal,
    projectedTotal,
    quota,
  };
}

/** Sums the daily aggregates for the tenant/metric since the start of the UTC calendar month. */
export async function getCurrentMonthTotal(tenantId: string, metric: string): Promise<number> {
  const monthStart = startOfUtcMonth(new Date());

  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${usageAggregates.total}), 0)` })
    .from(usageAggregates)
    .where(
      and(
        eq(usageAggregates.tenantId, tenantId),
        eq(usageAggregates.metric, metric),
        gte(usageAggregates.period, monthStart),
      ),
    );

  return Number(row?.total ?? 0);
}

/** Monthly enforcement: looks up the quota and accumulated consumption and applies `evaluateQuota`. */
export async function checkQuota(
  tenantId: string,
  metric: string,
  quantity: number,
): Promise<QuotaEvaluation> {
  const [quotaRow, currentTotal] = await Promise.all([
    db.query.quotas.findFirst({
      where: and(eq(quotas.tenantId, tenantId), eq(quotas.metric, metric)),
    }),
    getCurrentMonthTotal(tenantId, metric),
  ]);

  const quota: QuotaLimit | null = quotaRow
    ? { limit: Number(quotaRow.limit), enforcement: quotaRow.enforcement }
    : null;

  return evaluateQuota(currentTotal, quantity, quota);
}
