import { sql } from "drizzle-orm";
import { db } from "../db";
import { usageAggregates, usageEvents } from "../db/schema";
import { startOfUtcDay } from "./period";

export type RecordUsageInput = {
  tenantId: string;
  metric: string;
  quantity: number;
  unitCost?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Records a usage event and updates its daily aggregate (total + estimated
 * cost) in a single transaction. The aggregate is maintained with an atomic
 * upsert (INSERT ... ON CONFLICT DO UPDATE total = total + delta): a single
 * round-trip, no read-before-write, safe under concurrent writes because the
 * increment happens within the row at the engine level, not in the
 * application. See DECISIONS.md.
 *
 * `at` exists so realistic historical data can be generated in the seed
 * (milestone 6); in production the implicit `now()` from `recordUsageEvent` is
 * always used.
 */
export async function recordUsageEventAt(input: RecordUsageInput, at: Date) {
  const period = startOfUtcDay(at);
  const quantityStr = input.quantity.toString();
  const costStr = (input.unitCost ? input.quantity * input.unitCost : 0).toString();

  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(usageEvents)
      .values({
        tenantId: input.tenantId,
        metric: input.metric,
        quantity: quantityStr,
        unitCost: input.unitCost?.toString(),
        metadata: input.metadata ?? null,
        createdAt: at,
      })
      .returning();
    if (!event) throw new Error("Failed to record the usage event");

    const [aggregate] = await tx
      .insert(usageAggregates)
      .values({
        tenantId: input.tenantId,
        period,
        metric: input.metric,
        total: quantityStr,
        costTotal: costStr,
      })
      .onConflictDoUpdate({
        target: [usageAggregates.tenantId, usageAggregates.period, usageAggregates.metric],
        set: {
          total: sql`${usageAggregates.total} + ${quantityStr}::numeric`,
          costTotal: sql`${usageAggregates.costTotal} + ${costStr}::numeric`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!aggregate) throw new Error("Failed to update the usage aggregate");

    return { event, aggregate };
  });
}

export async function recordUsageEvent(input: RecordUsageInput) {
  return recordUsageEventAt(input, new Date());
}
