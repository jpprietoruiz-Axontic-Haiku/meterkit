import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyAuthToken } from "../lib/jwt";
import type { AppEnv } from "../types";

/** Requires a valid JWT in `Authorization: Bearer <token>` and exposes the user on the context. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    throw new HTTPException(401, { message: "Missing Authorization: Bearer <token> header" });
  }

  try {
    const payload = await verifyAuthToken(token);
    c.set("user", payload);
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }

  await next();
});
