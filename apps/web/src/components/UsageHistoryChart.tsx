import { useEffect, useState } from "react";
import * as api from "../lib/api";
import type { UsageHistoryPoint } from "../lib/types";

function groupByMetric(points: UsageHistoryPoint[]): Map<string, UsageHistoryPoint[]> {
  const grouped = new Map<string, UsageHistoryPoint[]>();
  for (const point of points) {
    const list = grouped.get(point.metric) ?? [];
    list.push(point);
    grouped.set(point.metric, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.period.localeCompare(b.period));
  }
  return grouped;
}

export function UsageHistoryChart({ token }: { token: string }) {
  const [points, setPoints] = useState<UsageHistoryPoint[] | null>(null);

  useEffect(() => {
    api.usageHistory(token, 14).then((res) => setPoints(res.aggregates));
  }, [token]);

  if (!points) {
    return null;
  }

  const grouped = groupByMetric(points);

  return (
    <section className="panel">
      <h2>Last 14 days</h2>
      {grouped.size === 0 ? (
        <p className="muted">No history yet.</p>
      ) : (
        Array.from(grouped.entries()).map(([metric, series]) => {
          const max = Math.max(...series.map((p) => Number(p.total)), 1);
          return (
            <div className="history-row" key={metric}>
              <span className="history-metric">{metric}</span>
              <div className="history-bars">
                {series.map((p) => (
                  <div
                    key={p.period}
                    className="history-bar"
                    style={{ height: `${Math.max((Number(p.total) / max) * 100, 4)}%` }}
                    title={`${p.period.slice(0, 10)}: ${Number(p.total).toLocaleString("en-US")}`}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
