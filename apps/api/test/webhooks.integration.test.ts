import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { closeDb, db } from "../src/db";
import { tenants } from "../src/db/schema";
import { env } from "../src/env";
import { getStripeClient } from "../src/lib/stripe";
import { resetDatabase } from "./helpers/db";

type AuthResponse = { tenant: { id: string; name: string } };

const app = createApp();

async function createTenantWithStripeCustomer(customerId: string) {
  const registerRes = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantName: "Acme",
      email: `owner-${customerId}@acme.test`,
      password: "correcthorsebattery",
    }),
  });
  const { tenant } = (await registerRes.json()) as AuthResponse;

  await db.update(tenants).set({ stripeCustomerId: customerId }).where(eq(tenants.id, tenant.id));

  return tenant.id;
}

function signedWebhookRequest(eventId: string, type: string, dataObject: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    type,
    data: { object: dataObject },
  });
  const header = getStripeClient().webhooks.generateTestHeaderString({
    payload,
    // biome-ignore lint/style/noNonNullAssertion: seteado explicitamente para estos tests
    secret: env.STRIPE_WEBHOOK_SECRET!,
  });

  return app.request("/webhooks/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
}

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

describe("POST /webhooks/stripe", () => {
  it("rechaza una firma invalida con 400", async () => {
    const res = await app.request("/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=invalido" },
      body: JSON.stringify({
        id: "evt_x",
        type: "checkout.session.completed",
        data: { object: {} },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("checkout.session.completed activa la suscripcion del tenant", async () => {
    const tenantId = await createTenantWithStripeCustomer("cus_test_1");

    const res = await signedWebhookRequest("evt_checkout_1", "checkout.session.completed", {
      customer: "cus_test_1",
      subscription: "sub_test_1",
    });
    expect(res.status).toBe(200);

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    expect(tenant?.subscriptionStatus).toBe("active");
    expect(tenant?.stripeSubscriptionId).toBe("sub_test_1");
  });

  it("customer.subscription.deleted marca la suscripcion como cancelada", async () => {
    const tenantId = await createTenantWithStripeCustomer("cus_test_2");
    await signedWebhookRequest("evt_sub_created_2", "checkout.session.completed", {
      customer: "cus_test_2",
      subscription: "sub_test_2",
    });

    const res = await signedWebhookRequest("evt_sub_deleted_2", "customer.subscription.deleted", {
      id: "sub_test_2",
      customer: "cus_test_2",
    });
    expect(res.status).toBe(200);

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    expect(tenant?.subscriptionStatus).toBe("canceled");
  });

  it("es idempotente: reenviar el mismo stripe_event_id no reprocesa el efecto", async () => {
    const tenantId = await createTenantWithStripeCustomer("cus_test_3");

    const first = await signedWebhookRequest("evt_dup_1", "checkout.session.completed", {
      customer: "cus_test_3",
      subscription: "sub_test_3",
    });
    expect(await first.json()).toMatchObject({ received: true });

    // Reintento de Stripe con el mismo event id, pero con un payload distinto:
    // si se reprocesara, sobreescribiria stripeSubscriptionId.
    const second = await signedWebhookRequest("evt_dup_1", "checkout.session.completed", {
      customer: "cus_test_3",
      subscription: "sub_deberia_ser_ignorado",
    });
    const secondBody = (await second.json()) as { received: boolean; duplicate?: boolean };

    expect(second.status).toBe(200);
    expect(secondBody.duplicate).toBe(true);

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    expect(tenant?.stripeSubscriptionId).toBe("sub_test_3");
  });
});
