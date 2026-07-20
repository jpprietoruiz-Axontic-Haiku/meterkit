import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env";

const migrationClient = postgres(env.DATABASE_URL, { max: 1 });

async function main() {
  const db = drizzle(migrationClient);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await migrationClient.end();
  console.log("Migraciones aplicadas correctamente.");
}

main().catch((error) => {
  console.error("Fallo al aplicar migraciones:", error);
  process.exit(1);
});
