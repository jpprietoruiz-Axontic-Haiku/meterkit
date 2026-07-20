import { relations } from "drizzle-orm";
import {
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);
export const quotaEnforcementEnum = pgEnum("quota_enforcement", ["soft", "hard"]);

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type QuotaEnforcement = (typeof quotaEnforcementEnum.enumValues)[number];

// Un tenant = una cuenta cliente. api_key_hash es el secreto para POST /v1/usage;
// nunca se guarda en claro (ver hito 2).
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  apiKeyHash: text("api_key_hash").unique(),
  apiKeyPrefix: text("api_key_prefix"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Log crudo, inmutable, de cada unidad de consumo. Fuente de verdad; usage_aggregates
// se recalcula/actualiza a partir de esta tabla y puede reconstruirse si hace falta.
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 20, scale: 6 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_events_tenant_metric_created_idx").on(
      table.tenantId,
      table.metric,
      table.createdAt,
    ),
  ],
);

// Materialización por (tenant, periodo, metric) para que el dashboard no agregue
// usage_events en caliente. `period` es el inicio del periodo en UTC (día u hora,
// truncado) — ver DECISIONS.md en hito 7 para la justificación de la estrategia.
export const usageAggregates = pgTable(
  "usage_aggregates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    period: timestamp("period", { withTimezone: true }).notNull(),
    metric: text("metric").notNull(),
    total: numeric("total", { precision: 20, scale: 6 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_aggregates_tenant_period_metric_idx").on(
      table.tenantId,
      table.period,
      table.metric,
    ),
  ],
);

export const quotas = pgTable(
  "quotas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    limit: numeric("limit", { precision: 20, scale: 6 }).notNull(),
    enforcement: quotaEnforcementEnum("enforcement").notNull().default("soft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("quotas_tenant_metric_idx").on(table.tenantId, table.metric)],
);

// Deduplicación estándar de webhooks de Stripe: un stripe_event_id solo se procesa
// una vez. No hay lease/reclaim ni reintentos de cobro — fuera de alcance de MeterKit.
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  eventType: text("event_type"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  usageEvents: many(usageEvents),
  usageAggregates: many(usageAggregates),
  quotas: many(quotas),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
}));

export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
  tenant: one(tenants, { fields: [usageEvents.tenantId], references: [tenants.id] }),
}));

export const usageAggregatesRelations = relations(usageAggregates, ({ one }) => ({
  tenant: one(tenants, { fields: [usageAggregates.tenantId], references: [tenants.id] }),
}));

export const quotasRelations = relations(quotas, ({ one }) => ({
  tenant: one(tenants, { fields: [quotas.tenantId], references: [tenants.id] }),
}));
