import { and, eq, isNotNull, sql } from "drizzle-orm";
import { closeDb, db } from "../db";
import { tenants, usageAggregates } from "../db/schema";
import { getStripeClient } from "../lib/stripe";

/**
 * Reporta a Stripe (Billing Meters) el consumo aun no informado de cada tenant
 * con suscripcion activa. Pensado para invocarse periodicamente desde un
 * scheduler externo (Railway cron job / GitHub Actions schedule) — ver README.
 * No es un worker de cola ni un proceso persistente: es un script idempotente
 * de una sola pasada, a proposito, para mantener el alcance de MeterKit acotado.
 *
 * Convencion: cada `metric` debe tener configurado en Stripe un Billing Meter
 * cuyo event_name coincida exactamente con el nombre del metric.
 */
export async function pushUsageToStripe(): Promise<{ pushed: number; failed: number }> {
  const stripe = getStripeClient();

  const billableTenants = await db.query.tenants.findMany({
    where: isNotNull(tenants.stripeCustomerId),
  });

  let pushed = 0;
  let failed = 0;

  for (const tenant of billableTenants) {
    if (!tenant.stripeCustomerId) continue;

    const pendingRows = await db
      .select()
      .from(usageAggregates)
      .where(
        and(
          eq(usageAggregates.tenantId, tenant.id),
          sql`${usageAggregates.total} > ${usageAggregates.stripePushedTotal}`,
        ),
      );

    for (const row of pendingRows) {
      const delta = Number(row.total) - Number(row.stripePushedTotal);
      if (delta <= 0) continue;

      try {
        await stripe.billing.meterEvents.create({
          event_name: row.metric,
          payload: {
            value: delta.toString(),
            stripe_customer_id: tenant.stripeCustomerId,
          },
          timestamp: Math.floor(row.period.getTime() / 1000),
        });

        await db
          .update(usageAggregates)
          .set({ stripePushedTotal: row.total, updatedAt: new Date() })
          .where(eq(usageAggregates.id, row.id));

        pushed += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `Fallo al reportar a Stripe tenant=${tenant.id} metric=${row.metric} period=${row.period.toISOString()}:`,
          error,
        );
      }
    }
  }

  return { pushed, failed };
}

if (import.meta.main) {
  pushUsageToStripe()
    .then(({ pushed, failed }) => {
      console.log(`Push a Stripe completado: ${pushed} filas reportadas, ${failed} fallidas.`);
      return closeDb();
    })
    .catch((error) => {
      console.error("Fallo el push de usage a Stripe:", error);
      process.exit(1);
    });
}
