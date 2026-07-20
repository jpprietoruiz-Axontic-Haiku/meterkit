/**
 * usage_aggregates se materializa por dia (UTC). Es el punto medio razonable entre
 * granularidad util para un dashboard y numero de filas a mantener; ver DECISIONS.md.
 */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
