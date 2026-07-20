import Stripe from "stripe";
import { env } from "../env";

let client: Stripe | null = null;

/**
 * Lazy Stripe client: only requires STRIPE_SECRET_KEY when a billing route
 * actually uses it, so the rest of the API (auth, metering, quotas) doesn't
 * break in environments where Stripe isn't configured yet.
 */
export function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  }
  return client;
}
