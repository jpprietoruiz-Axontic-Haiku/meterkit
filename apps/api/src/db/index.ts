import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;

/** Closes the connection pool. Usage: one-off scripts and `afterAll` in integration tests. */
export async function closeDb(): Promise<void> {
  await queryClient.end();
}
