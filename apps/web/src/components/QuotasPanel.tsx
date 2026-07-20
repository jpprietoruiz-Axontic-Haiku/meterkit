import { type FormEvent, useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import type { Quota } from "../lib/types";

export function QuotasPanel({ token, canEdit }: { token: string; canEdit: boolean }) {
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [metric, setMetric] = useState("");
  const [limit, setLimit] = useState("");
  const [enforcement, setEnforcement] = useState<"soft" | "hard">("soft");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setQuotas((await api.listQuotas(token)).quotas);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.upsertQuota(token, { metric, limit: Number(limit), enforcement });
      setMetric("");
      setLimit("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the quota.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <h2>Monthly quotas</h2>

      {quotas.length === 0 ? (
        <p className="muted">No quotas configured: usage is unlimited.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Limit / month</th>
              <th>Enforcement</th>
            </tr>
          </thead>
          <tbody>
            {quotas.map((q) => (
              <tr key={q.id}>
                <td>{q.metric}</td>
                <td>{Number(q.limit).toLocaleString("en-US")}</td>
                <td>
                  <span className={`badge badge-${q.enforcement}`}>{q.enforcement}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <form onSubmit={handleSubmit} className="inline-form">
          <input
            placeholder="metric (e.g. api_calls)"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            required
          />
          <input
            type="number"
            min={1}
            placeholder="limit"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
          />
          <select
            value={enforcement}
            onChange={(e) => setEnforcement(e.target.value as "soft" | "hard")}
          >
            <option value="soft">soft (warns)</option>
            <option value="hard">hard (blocks)</option>
          </select>
          <button type="submit" disabled={submitting}>
            Save
          </button>
        </form>
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}
