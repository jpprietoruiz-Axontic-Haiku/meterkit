import { relations } from "drizzle-orm";
import {
  index,
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

// A tenant = a customer account. api_key_hash is the secret for POST /v1/usage;
// it is never stored in plaintext (see milestone 2).
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

// Raw, immutable log of every unit of consumption. Source of truth; usage_aggregates
// is recalculated/updated from this table and can be rebuilt from it if needed.
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
    // Regular index (NOT unique): it's common for two events of the same
    // tenant/metric to land on the same timestamp under concurrent writes.
    // This only speeds up the date range query per tenant+metric, it doesn't restrict anything.
    index("usage_events_tenant_metric_created_idx").on(
      table.tenantId,
      table.metric,
      table.createdAt,
    ),
  ],
);

// Materialized by (tenant, period, metric) so the dashboard doesn't have to
// aggregate usage_events on the fly. `period` is the start of the period in UTC
// (day or hour, truncated) — see DECISIONS.md in milestone 7 for the rationale behind the strategy.
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
    // Accumulated estimated cost (sum of quantity * unitCost for each event). It
    // is kept alongside `total` in the same upsert so the dashboard doesn't have
    // to recalculate it from usage_events.
    costTotal: numeric("cost_total", { precision: 20, scale: 6 }).notNull().default("0"),
    // How much of `total` has already been reported to Stripe as a usage record. The
    // push job (milestone 5) reports only the delta (total - stripePushedTotal) and then
    // sets it equal, avoiding reporting the same consumption twice.
    stripePushedTotal: numeric("stripe_pushed_total", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
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

// Standard Stripe webhook deduplication: a stripe_event_id is only processed
// once. There is no lease/reclaim or billing retries — out of scope for MeterKit.
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
