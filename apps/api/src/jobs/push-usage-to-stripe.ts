import { and, eq, isNotNull, sql } from "drizzle-orm";
import { closeDb, db } from "../db";
import { tenants, usageAggregates } from "../db/schema";
import { getStripeClient } from "../lib/stripe";

/**
 * Reports to Stripe (Billing Meters) the not-yet-reported consumption of each
 * tenant with an active subscription. Meant to be invoked periodically from an
 * external scheduler (Railway cron job / GitHub Actions schedule) — see README.
 * It is not a queue worker or a persistent process: it is deliberately a single-pass
 * idempotent script, to keep MeterKit's scope bounded.
 *
 * Convention: each `metric` must have a Billing Meter configured in Stripe
 * whose event_name exactly matches the metric's name.
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
          `Failed to report to Stripe tenant=${tenant.id} metric=${row.metric} period=${row.period.toISOString()}:`,
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
      console.log(`Push to Stripe completed: ${pushed} rows reported, ${failed} failed.`);
      return closeDb();
    })
    .catch((error) => {
      console.error("Usage push to Stripe failed:", error);
      process.exit(1);
    });
}
