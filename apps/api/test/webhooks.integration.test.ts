import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { db } from "../src/db";
import { tenants } from "../src/db/schema";
import { env } from "../src/env";
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

// The Stripe SDK doesn't offer an async `generateTestHeaderString`, and on Bun
// (crypto provider SubtleCrypto, always async) the synchronous variant doesn't
// work even when forcing the Node provider (Stripe deliberately blocks it
// outside of Node). We sign it by hand using the same scheme Stripe uses:
// v1 = HMAC-SHA256(secret, "{timestamp}.{payload}") in hex.
function signStripePayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = new Bun.CryptoHasher("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function signedWebhookRequest(eventId: string, type: string, dataObject: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    type,
    data: { object: dataObject },
  });
  // biome-ignore lint/style/noNonNullAssertion: explicitly set for these tests
  const header = signStripePayload(payload, env.STRIPE_WEBHOOK_SECRET!);

  return app.request("/webhooks/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
}

// No afterAll(closeDb): the Postgres client is a singleton shared by all
// test files within the same `bun test` process.
beforeEach(resetDatabase);

describe("POST /webhooks/stripe", () => {
  it("rejects an invalid signature with 400", async () => {
    const res = await app.request("/webhooks/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=invalid" },
      body: JSON.stringify({
        id: "evt_x",
        type: "checkout.session.completed",
        data: { object: {} },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("checkout.session.completed activates the tenant's subscription", async () => {
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

  it("customer.subscription.deleted marks the subscription as canceled", async () => {
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

  it("is idempotent: resending the same stripe_event_id does not reprocess the effect", async () => {
    const tenantId = await createTenantWithStripeCustomer("cus_test_3");

    const first = await signedWebhookRequest("evt_dup_1", "checkout.session.completed", {
      customer: "cus_test_3",
      subscription: "sub_test_3",
    });
    expect(await first.json()).toMatchObject({ received: true });

    // Stripe retry with the same event id, but with a different payload:
    // if it were reprocessed, it would overwrite stripeSubscriptionId.
    const second = await signedWebhookRequest("evt_dup_1", "checkout.session.completed", {
      customer: "cus_test_3",
      subscription: "sub_should_be_ignored",
    });
    const secondBody = (await second.json()) as { received: boolean; duplicate?: boolean };

    expect(second.status).toBe(200);
    expect(secondBody.duplicate).toBe(true);

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    expect(tenant?.stripeSubscriptionId).toBe("sub_test_3");
  });
});
