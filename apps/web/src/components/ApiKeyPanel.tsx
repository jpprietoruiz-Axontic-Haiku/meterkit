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
      setError(err instanceof ApiError ? err.message : "Could not rotate the API key.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>Ingestion API key</h2>
      <p className="muted">
        Used in the <code>x-api-key</code> header when calling <code>POST /v1/usage</code>.
      </p>
      <p>
        Current key:{" "}
        <code>
          {profile.tenant.apiKeyPrefix ? `${profile.tenant.apiKeyPrefix}…` : "not generated"}
        </code>
      </p>

      {canRotate && (
        <button type="button" onClick={handleRotate} disabled={loading}>
          {loading ? "Generating..." : "Rotate API key"}
        </button>
      )}

      {newKey && (
        <div className="secret-reveal">
          <p>Save this key now — it will not be shown again:</p>
          <code>{newKey}</code>
        </div>
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}
