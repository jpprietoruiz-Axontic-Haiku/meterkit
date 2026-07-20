import { useState } from "react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import type { MeResponse } from "../lib/types";

export function BillingPanel({
  token,
  profile,
  canManage,
}: {
  token: string;
  profile: MeResponse;
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"checkout" | "portal" | null>(null);

  async function handleCheckout() {
    setError(null);
    setLoading("checkout");
    try {
      const { url } = await api.startCheckout(token);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open checkout.");
    } finally {
      setLoading(null);
    }
  }

  async function handlePortal() {
    setError(null);
    setLoading("portal");
    try {
      const { url } = await api.openBillingPortal(token);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the billing portal.");
    } finally {
      setLoading(null);
    }
  }

  const status = profile.tenant.subscriptionStatus;

  return (
    <section className="panel">
      <h2>Billing (Stripe, test mode)</h2>
      <p>
        Plan: <strong>{profile.tenant.plan}</strong> — Subscription status:{" "}
        <span className={`badge badge-${status === "active" ? "soft" : "hard"}`}>
          {status ?? "no subscription"}
        </span>
      </p>

      {canManage ? (
        <div className="button-row">
          <button type="button" onClick={handleCheckout} disabled={loading !== null}>
            {loading === "checkout" ? "Opening..." : "Subscribe (metered)"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handlePortal}
            disabled={loading !== null}
          >
            {loading === "portal" ? "Opening..." : "Manage billing"}
          </button>
        </div>
      ) : (
        <p className="muted">Only owner/admin can manage billing.</p>
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}
