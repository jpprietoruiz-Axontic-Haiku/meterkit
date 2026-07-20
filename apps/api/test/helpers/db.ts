import { sql } from "drizzle-orm";
import { db } from "../../src/db";

/** Vacia todas las tablas de dominio entre tests, preservando el esquema. */
export async function resetDatabase(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      webhook_events,
      quotas,
      usage_aggregates,
      usage_events,
      users,
      tenants
    RESTART IDENTITY CASCADE
  `);
}
