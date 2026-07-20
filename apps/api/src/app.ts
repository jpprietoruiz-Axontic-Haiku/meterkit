import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { ZodError } from "zod";
import { authRoutes } from "./routes/auth";
import { usageRoutes } from "./routes/usage";
import type { AppEnv } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", logger());

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

  return app;
}

export type App = ReturnType<typeof createApp>;
