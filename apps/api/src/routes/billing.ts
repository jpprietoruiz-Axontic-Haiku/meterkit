import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../db";
import { tenants } from "../db/schema";
import { env } from "../env";
import { getStripeClient } from "../lib/stripe";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import type { AppEnv } from "../types";

async function getOwnTenant(tenantId: string) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) {
    throw new HTTPException(404, { message: "Tenant not found" });
  }
  return tenant;
}

export const billingRoutes = new Hono<AppEnv>()
  // Creates (or reuses) the tenant's Stripe Customer and opens a metered
  // subscription Checkout. Test mode: uses a test STRIPE_SECRET_KEY /
  // STRIPE_METERED_PRICE_ID.
  .post("/checkout", requireAuth, requireRole("owner", "admin"), async (c) => {
    if (!env.STRIPE_METERED_PRICE_ID) {
      throw new HTTPException(500, { message: "STRIPE_METERED_PRICE_ID is not configured" });
    }

    const authUser = c.get("user");
    const stripe = getStripeClient();
    const tenant = await getOwnTenant(authUser.tenantId);

    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: authUser.email,
        name: tenant.name,
        metadata: { tenantId: tenant.id },
      });
      customerId = customer.id;
      await db
        .update(tenants)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: env.STRIPE_METERED_PRICE_ID }],
      success_url: `${env.APP_BASE_URL}/billing?checkout=success`,
      cancel_url: `${env.APP_BASE_URL}/billing?checkout=canceled`,
    });

    return c.json({ url: session.url });
  })
  // Stripe Billing Portal session (change card, view invoices, cancel).
  .get("/portal", requireAuth, requireRole("owner", "admin"), async (c) => {
    const authUser = c.get("user");
    const stripe = getStripeClient();
    const tenant = await getOwnTenant(authUser.tenantId);

    if (!tenant.stripeCustomerId) {
      throw new HTTPException(400, {
        message: "This tenant does not have an active Stripe subscription yet",
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${env.APP_BASE_URL}/billing`,
    });

    return c.json({ url: session.url });
  });
