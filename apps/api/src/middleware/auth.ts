import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyAuthToken } from "../lib/jwt";
import type { AppEnv } from "../types";

/** Exige un JWT valido en `Authorization: Bearer <token>` y expone el usuario en el contexto. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    throw new HTTPException(401, { message: "Falta el header Authorization: Bearer <token>" });
  }

  try {
    const payload = await verifyAuthToken(token);
    c.set("user", payload);
  } catch {
    throw new HTTPException(401, { message: "Token invalido o expirado" });
  }

  await next();
});
