DROP INDEX "usage_events_tenant_metric_created_idx";--> statement-breakpoint
CREATE INDEX "usage_events_tenant_metric_created_idx" ON "usage_events" USING btree ("tenant_id","metric","created_at");