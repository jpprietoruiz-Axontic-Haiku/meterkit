import { useUsageStream } from "../lib/useUsageStream";

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}

function formatCost(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function UsageTiles({ token }: { token: string }) {
  const { snapshot, status } = useUsageStream(token);

  const quotaByMetric = new Map((snapshot?.quotas ?? []).map((q) => [q.metric, q]));
  const totalCost = (snapshot?.usage ?? []).reduce((sum, row) => sum + row.cost, 0);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Current month usage</h2>
        <span className={`stream-dot stream-${status}`} title={`Stream: ${status}`} />
      </div>

      {!snapshot ? (
        <p className="muted">Connecting to live stream…</p>
      ) : snapshot.usage.length === 0 ? (
        <p className="muted">No usage recorded yet this month.</p>
      ) : (
        <>
          <div className="tiles-grid">
            {snapshot.usage.map((row) => {
              const quota = quotaByMetric.get(row.metric);
              const pct = quota ? Math.min(quota.percentUsed, 100) : null;
              const over = quota ? quota.percentUsed >= 100 : false;
              return (
                <div className="tile" key={row.metric}>
                  <div className="tile-metric">{row.metric}</div>
                  <div className="tile-total">{formatNumber(row.total)}</div>
                  <div className="tile-cost">{formatCost(row.cost)} estimated</div>
                  {quota && (
                    <div className="quota-bar-wrap">
                      <div className="quota-bar">
                        <div
                          className={`quota-bar-fill ${over ? "over" : quota.enforcement === "hard" ? "hard" : "soft"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="quota-bar-label">
                        {formatNumber(quota.currentTotal)} / {formatNumber(quota.limit)} (
                        {quota.enforcement})
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="total-cost">
            Total estimated cost this month: <strong>{formatCost(totalCost)}</strong>
          </p>
        </>
      )}
    </section>
  );
}
