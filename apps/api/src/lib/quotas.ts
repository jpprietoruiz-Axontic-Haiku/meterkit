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
 * Decision pura de enforcement: dado el consumo ya acumulado en el periodo,
 * la cantidad entrante y la cuota configurada (si la hay), decide si se
 * bloquea (hard) o solo se avisa (soft). Sin I/O — testeable de forma
 * aislada.
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

/** Suma los agregados diarios del tenant/metric desde el inicio del mes calendario UTC. */
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

/** Enforcement mensual: consulta la cuota y el consumo acumulado y aplica `evaluateQuota`. */
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
