import { sql } from "drizzle-orm";
import { generateApiKey } from "../lib/api-key";
import { hashPassword } from "../lib/password";
import { recordUsageEventAt } from "../lib/usage";
import { closeDb, db } from "./index";
import { quotas, tenants, users } from "./schema";

const DAYS_OF_HISTORY = 14;
const DEMO_PASSWORD = "demo1234";

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function daysAgoAtNoonUtc(daysAgo: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, 12, 0, 0),
  );
}

type SeedTenant = {
  name: string;
  email: string;
  quotas: Array<{ metric: string; limit: number; enforcement: "soft" | "hard" }>;
  daily: () => Array<{ metric: string; quantity: number; unitCost: number }>;
};

const SEED_TENANTS: SeedTenant[] = [
  {
    name: "Acme Inc",
    email: "owner@acme.demo",
    quotas: [
      { metric: "api_calls", limit: 8000, enforcement: "soft" },
      { metric: "tokens", limit: 400_000, enforcement: "hard" },
    ],
    daily: () => [
      { metric: "api_calls", quantity: randomInt(300, 400), unitCost: 0.001 },
      { metric: "tokens", quantity: randomInt(15_000, 20_000), unitCost: 0.000002 },
    ],
  },
  {
    name: "Globex Corp",
    email: "owner@globex.demo",
    // Cuota hard deliberadamente ajustada: en pocos dias el seed la deja cerca
    // o por encima del limite, para que el dashboard muestre el bloqueo real.
    quotas: [
      { metric: "api_calls", limit: 3000, enforcement: "hard" },
      { metric: "tokens", limit: 100_000, enforcement: "soft" },
    ],
    daily: () => [
      { metric: "api_calls", quantity: randomInt(150, 260), unitCost: 0.001 },
      { metric: "tokens", quantity: randomInt(4_000, 9_000), unitCost: 0.000002 },
    ],
  },
  {
    name: "Initech",
    email: "owner@initech.demo",
    quotas: [],
    daily: () => [
      { metric: "api_calls", quantity: randomInt(20, 80), unitCost: 0.001 },
      { metric: "tokens", quantity: randomInt(500, 3_000), unitCost: 0.000002 },
    ],
  },
];

async function seed() {
  await db.execute(sql`
    TRUNCATE TABLE
      webhook_events, quotas, usage_aggregates, usage_events, users, tenants
    RESTART IDENTITY CASCADE
  `);

  const summary: Array<{ tenant: string; email: string; password: string; apiKey: string }> = [];

  for (const seedTenant of SEED_TENANTS) {
    const [tenant] = await db.insert(tenants).values({ name: seedTenant.name }).returning();
    if (!tenant) throw new Error(`No se pudo crear el tenant ${seedTenant.name}`);

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await db.insert(users).values({
      tenantId: tenant.id,
      email: seedTenant.email,
      passwordHash,
      role: "owner",
    });

    const apiKey = await generateApiKey();
    await db
      .update(tenants)
      .set({ apiKeyHash: apiKey.hash, apiKeyPrefix: apiKey.prefix })
      .where(sql`${tenants.id} = ${tenant.id}`);

    if (seedTenant.quotas.length > 0) {
      await db.insert(quotas).values(
        seedTenant.quotas.map((q) => ({
          tenantId: tenant.id,
          metric: q.metric,
          limit: q.limit.toString(),
          enforcement: q.enforcement,
        })),
      );
    }

    for (let daysAgo = DAYS_OF_HISTORY - 1; daysAgo >= 0; daysAgo--) {
      const at = daysAgoAtNoonUtc(daysAgo);
      for (const event of seedTenant.daily()) {
        await recordUsageEventAt({ tenantId: tenant.id, ...event }, at);
      }
    }

    summary.push({
      tenant: seedTenant.name,
      email: seedTenant.email,
      password: DEMO_PASSWORD,
      apiKey: apiKey.plaintext,
    });
  }

  console.log(`\nSeed completado: ${summary.length} tenants con ${DAYS_OF_HISTORY} dias de uso.\n`);
  for (const row of summary) {
    console.log(`— ${row.tenant}`);
    console.log(`  login:   ${row.email} / ${row.password}`);
    console.log(`  API key: ${row.apiKey}`);
  }
  console.log(
    "\nGuarda estas API keys ahora: no se pueden volver a mostrar (solo se persiste su hash).\n",
  );
}

seed()
  .then(() => closeDb())
  .catch((error) => {
    console.error("Fallo el seed:", error);
    process.exit(1);
  });
