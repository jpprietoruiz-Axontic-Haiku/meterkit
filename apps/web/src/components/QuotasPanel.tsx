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
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la cuota.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <h2>Cuotas mensuales</h2>

      {quotas.length === 0 ? (
        <p className="muted">Sin cuotas configuradas: el consumo no tiene limite.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Limite / mes</th>
              <th>Enforcement</th>
            </tr>
          </thead>
          <tbody>
            {quotas.map((q) => (
              <tr key={q.id}>
                <td>{q.metric}</td>
                <td>{Number(q.limit).toLocaleString("es-ES")}</td>
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
            placeholder="metric (p. ej. api_calls)"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            required
          />
          <input
            type="number"
            min={1}
            placeholder="limite"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
          />
          <select
            value={enforcement}
            onChange={(e) => setEnforcement(e.target.value as "soft" | "hard")}
          >
            <option value="soft">soft (avisa)</option>
            <option value="hard">hard (bloquea)</option>
          </select>
          <button type="submit" disabled={submitting}>
            Guardar
          </button>
        </form>
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}
