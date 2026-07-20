import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { UserRole } from "../db/schema";
import type { AppEnv } from "../types";

/** Must be mounted after `requireAuth`, which is what populates `c.get("user")`. */
export function requireRole(...allowed: UserRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");

    if (!allowed.includes(user.role)) {
      throw new HTTPException(403, {
        message: `Requires one of the following roles: ${allowed.join(", ")}`,
      });
    }

    await next();
  });
}
