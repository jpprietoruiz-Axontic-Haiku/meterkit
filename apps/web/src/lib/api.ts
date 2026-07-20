import type { AuthResponse, MeResponse, Quota, UsageHistoryPoint } from "./types";

// Empty in dev: the Vite proxy (vite.config.ts) forwards to the local API.
// In production (Vercel) this is set to the public API URL on Railway.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {}

async function apiFetch<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(body.error ?? `Error ${res.status}`);
  }
  return body as T;
}

export function register(tenantName: string, email: string, password: string) {
  return apiFetch<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ tenantName, email, password }),
  });
}

export function login(email: string, password: string) {
  return apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function me(token: string) {
  return apiFetch<MeResponse>("/auth/me", {}, token);
}

export function rotateApiKey(token: string) {
  return apiFetch<{ apiKey: string; prefix: string }>("/auth/api-key", { method: "POST" }, token);
}

export function listQuotas(token: string) {
  return apiFetch<{ quotas: Quota[] }>("/quotas", {}, token);
}

export function upsertQuota(
  token: string,
  input: { metric: string; limit: number; enforcement: "soft" | "hard" },
) {
  return apiFetch<{ quota: Quota }>(
    "/quotas",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function usageHistory(token: string, days = 14) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  return apiFetch<{ range: { from: string; to: string }; aggregates: UsageHistoryPoint[] }>(
    `/v1/usage?${params}`,
    {},
    token,
  );
}

export function startCheckout(token: string) {
  return apiFetch<{ url: string }>("/billing/checkout", { method: "POST" }, token);
}

export function openBillingPortal(token: string) {
  return apiFetch<{ url: string }>("/billing/portal", {}, token);
}

export function usageStreamUrl(token: string): string {
  return `${API_BASE}/v1/usage/stream?token=${encodeURIComponent(token)}`;
}
