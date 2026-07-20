export type AuthUser = { id: string; email: string; role: "owner" | "admin" | "member" };

export type AuthResponse = {
  token: string;
  user: AuthUser & { tenantId: string };
  tenant: { id: string; name: string };
};

export type MeResponse = {
  user: AuthUser;
  tenant: {
    id: string;
    name: string;
    plan: string;
    apiKeyPrefix: string | null;
    subscriptionStatus: string | null;
  };
};

export type Quota = {
  id: string;
  tenantId: string;
  metric: string;
  limit: string;
  enforcement: "soft" | "hard";
  createdAt: string;
};

export type UsageHistoryPoint = { period: string; metric: string; total: string; cost: string };

export type UsageSnapshot = {
  generatedAt: string;
  monthStart: string;
  usage: Array<{ metric: string; total: number; cost: number }>;
  quotas: Array<{
    metric: string;
    limit: number;
    enforcement: string;
    currentTotal: number;
    percentUsed: number;
  }>;
};
