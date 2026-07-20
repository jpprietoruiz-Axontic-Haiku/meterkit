import type { AuthTokenPayload } from "./lib/jwt";

export type AppEnv = {
  Variables: {
    user: AuthTokenPayload;
    /** Tenant resuelto por API key (ver middleware/api-key.ts, hito 3). */
    apiKeyTenantId: string;
  };
};
