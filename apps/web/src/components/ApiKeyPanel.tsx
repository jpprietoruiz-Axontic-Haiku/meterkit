import { useState } from "react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import type { MeResponse } from "../lib/types";

export function ApiKeyPanel({
  token,
  profile,
  canRotate,
}: {
  token: string;
  profile: MeResponse;
  canRotate: boolean;
}) {
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRotate() {
    setError(null);
    setLoading(true);
    try {
      const { apiKey } = await api.rotateApiKey(token);
      setNewKey(apiKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo rotar la API key.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>API key de ingestion</h2>
      <p className="muted">
        Se usa en el header <code>x-api-key</code> al llamar a <code>POST /v1/usage</code>.
      </p>
      <p>
        Clave actual:{" "}
        <code>
          {profile.tenant.apiKeyPrefix ? `${profile.tenant.apiKeyPrefix}…` : "sin generar"}
        </code>
      </p>

      {canRotate && (
        <button type="button" onClick={handleRotate} disabled={loading}>
          {loading ? "Generando..." : "Rotar API key"}
        </button>
      )}

      {newKey && (
        <div className="secret-reveal">
          <p>Guarda esta clave ahora — no se volvera a mostrar:</p>
          <code>{newKey}</code>
        </div>
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}
