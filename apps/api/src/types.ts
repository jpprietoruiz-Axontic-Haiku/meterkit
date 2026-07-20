import type { AuthTokenPayload } from "./lib/jwt";

export type AppEnv = {
  Variables: {
    user: AuthTokenPayload;
    /** Tenant resolved via API key (see middleware/api-key.ts, milestone 3). */
    apiKeyTenantId: string;
  };
};
