import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;

/** Cierra el pool de conexiones. Uso: scripts one-off y `afterAll` en tests de integracion. */
export async function closeDb(): Promise<void> {
  await queryClient.end();
}
