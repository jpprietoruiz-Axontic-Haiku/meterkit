import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type Stripe from "stripe";
import { db } from "../db";
import { tenants, webhookEvents } from "../db/schema";
import { env } from "../env";
import { getStripeClient } from "../lib/stripe";
import type { AppEnv } from "../types";

async function updateTenantByCustomerId(
  customerId: string,
  patch: Partial<{ stripeSubscriptionId: string | null; subscriptionStatus: string | null }>,
) {
  await db
    .update(tenants)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tenants.stripeCustomerId, customerId));
}

async function applyStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (typeof session.customer === "string") {
        await updateTenantByCustomerId(session.customer, {
          stripeSubscriptionId:
            typeof session.subscription === "string" ? session.subscription : null,
          subscriptionStatus: "active",
        });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      if (typeof subscription.customer === "string") {
        await updateTenantByCustomerId(subscription.customer, {
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
        });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      if (typeof subscription.customer === "string") {
        await updateTenantByCustomerId(subscription.customer, { subscriptionStatus: "canceled" });
      }
      break;
    }
    default:
      // Otros eventos se reconocen (y quedan deduplicados) sin cambiar estado.
      break;
  }
}

export const webhookRoutes = new Hono<AppEnv>().post("/stripe", async (c) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new HTTPException(500, { message: "STRIPE_WEBHOOK_SECRET no esta configurado" });
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    throw new HTTPException(400, { message: "Falta el header stripe-signature" });
  }

  const rawBody = await c.req.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    // constructEventAsync (no constructEvent): en Bun, el SDK de Stripe usa un
    // crypto provider basado en SubtleCrypto (siempre asincrono) en vez del de
    // Node — la variante sincrona lanza "cannot be used in a synchronous
    // context" en este runtime.
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    throw new HTTPException(400, { message: "Firma de webhook invalida" });
  }

  // Deduplicacion estandar: un stripe_event_id solo se procesa una vez. Si el
  // INSERT no inserta nada es que ya se proceso (reintento de Stripe) y se
  // responde 200 sin repetir efectos secundarios.
  const [inserted] = await db
    .insert(webhookEvents)
    .values({ stripeEventId: event.id, eventType: event.type })
    .onConflictDoNothing({ target: webhookEvents.stripeEventId })
    .returning();

  if (!inserted) {
    return c.json({ received: true, duplicate: true });
  }

  await applyStripeEvent(event);

  return c.json({ received: true });
});
