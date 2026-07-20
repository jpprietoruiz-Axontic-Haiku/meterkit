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
      // Other events are acknowledged (and deduplicated) without changing state.
      break;
  }
}

export const webhookRoutes = new Hono<AppEnv>().post("/stripe", async (c) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new HTTPException(500, { message: "STRIPE_WEBHOOK_SECRET is not configured" });
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    throw new HTTPException(400, { message: "Missing stripe-signature header" });
  }

  const rawBody = await c.req.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    // constructEventAsync (not constructEvent): on Bun, the Stripe SDK uses a
    // SubtleCrypto-based crypto provider (always asynchronous) instead of
    // Node's — the synchronous variant throws "cannot be used in a synchronous
    // context" on this runtime.
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    throw new HTTPException(400, { message: "Invalid webhook signature" });
  }

  // Standard deduplication: a stripe_event_id is only processed once. If the
  // INSERT inserts nothing, it means it was already processed (a Stripe
  // retry), and we respond 200 without repeating side effects.
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
