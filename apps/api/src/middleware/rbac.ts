import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { UserRole } from "../db/schema";
import type { AppEnv } from "../types";

/** Debe montarse despues de `requireAuth`, que es quien puebla `c.get("user")`. */
export function requireRole(...allowed: UserRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");

    if (!allowed.includes(user.role)) {
      throw new HTTPException(403, {
        message: `Requiere uno de los roles: ${allowed.join(", ")}`,
      });
    }

    await next();
  });
}
