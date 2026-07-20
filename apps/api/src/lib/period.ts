/**
 * usage_aggregates is materialized per day (UTC). This is a reasonable middle ground
 * between granularity useful for a dashboard and the number of rows to maintain; see DECISIONS.md.
 */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
