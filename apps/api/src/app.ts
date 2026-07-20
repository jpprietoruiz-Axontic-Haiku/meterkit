import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { ZodError } from "zod";
import { env } from "./env";
import { authRoutes } from "./routes/auth";
import { billingRoutes } from "./routes/billing";
import { quotaRoutes } from "./routes/quotas";
import { usageRoutes } from "./routes/usage";
import { webhookRoutes } from "./routes/webhooks";
import type { AppEnv } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  // El dashboard (Vercel) y la API (Railway) viven en dominios distintos en
  // produccion; en local el proxy de Vite evita CORS por completo.
  app.use("*", cors({ origin: env.APP_BASE_URL }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    if (err instanceof ZodError) {
      return c.json({ error: "Datos invalidos", details: err.flatten() }, 400);
    }
    console.error(err);
    return c.json({ error: "Error interno" }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/auth", authRoutes);
  app.route("/v1/usage", usageRoutes);
  app.route("/quotas", quotaRoutes);
  app.route("/billing", billingRoutes);
  app.route("/webhooks", webhookRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;
