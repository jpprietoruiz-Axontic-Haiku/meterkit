import Stripe from "stripe";
import { env } from "../env";

let client: Stripe | null = null;

/**
 * Cliente de Stripe perezoso: solo exige STRIPE_SECRET_KEY cuando una ruta de
 * billing realmente lo usa, para no romper el resto de la API (auth, metering,
 * cuotas) en entornos donde Stripe todavia no esta configurado.
 */
export function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY no esta configurado");
  }
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}
