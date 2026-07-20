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
 * Registra un evento de uso y actualiza su agregado diario (total + coste
 * estimado) en una sola transaccion. El agregado se mantiene con un upsert
 * atomico (INSERT ... ON CONFLICT DO UPDATE total = total + delta): un solo
 * round-trip, sin leer-antes-de-escribir, seguro bajo escritura concurrente
 * porque el incremento ocurre dentro de la fila a nivel de motor, no en la
 * aplicacion. Ver DECISIONS.md.
 *
 * `at` existe para poder generar historico realista en el seed (hito 6); en
 * produccion siempre se usa el `now()` implicito de `recordUsageEvent`.
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
    if (!event) throw new Error("No se pudo registrar el evento de uso");

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
    if (!aggregate) throw new Error("No se pudo actualizar el agregado de uso");

    return { event, aggregate };
  });
}

export async function recordUsageEvent(input: RecordUsageInput) {
  return recordUsageEventAt(input, new Date());
}
