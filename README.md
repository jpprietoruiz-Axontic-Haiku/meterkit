# MeterKit

Starter SaaS multi-tenant que mide consumo por tenant, aplica cuotas y factura por uso vía
Stripe metered billing, con dashboard de coste en tiempo real.

> Proyecto de portfolio. En construcción por hitos — este README se completa en el hito 7
> con arquitectura, diagrama Mermaid y guía de despliegue.

## Alcance

Metering + usage-based billing. **No** es una herramienta de dunning / recuperación de
pagos: los webhooks de Stripe se deduplican con una tabla estándar (`webhook_events`), sin
lease/reclaim bajo concurrencia ni reintentos de cobro.

## Stack

- **Backend**: Bun + Hono + Drizzle + Postgres
- **Auth**: JWT multi-role (owner/admin/member), API key por tenant
- **Billing**: Stripe metered/usage-based billing + Billing Portal (modo test)
- **Frontend**: React + Vite + TypeScript
- **Deploy**: Railway (API + Postgres) + Vercel (dashboard)

## Estructura

```
apps/
  api/    Bun + Hono + Drizzle — API REST, metering, cuotas, Stripe, webhooks
  web/    Vite + React + TS — dashboard de uso, cuotas y facturación
```

## Desarrollo local

Requisitos: [Bun](https://bun.sh) ≥ 1.3, Docker (para Postgres).

```bash
cp .env.example .env      # completar valores (ver comentarios en el archivo)
docker compose up -d      # levanta Postgres en localhost:5432
bun install
bun run db:migrate        # aplica las migraciones de apps/api
bun run dev:api           # API en http://localhost:3000
bun run dev:web           # dashboard en http://localhost:5173
```

## Scripts (raíz)

| Script              | Descripción                                  |
| ------------------- | --------------------------------------------- |
| `bun run dev:api`   | API en modo watch                             |
| `bun run dev:web`   | Dashboard en modo dev                         |
| `bun run test`      | Tests de todos los workspaces                 |
| `bun run typecheck` | `tsc --noEmit` en todos los workspaces         |
| `bun run lint`      | Biome (lint + formato)                        |
| `bun run build`     | Build de producción de API y dashboard        |
| `bun run db:migrate`| Aplica migraciones Drizzle contra `DATABASE_URL` |

## Estado del proyecto

- [x] Hito 1 — Scaffolding, schema Drizzle, docker-compose, CI
- [ ] Hito 2 — Auth (JWT, RBAC, API key), aislamiento de tenant
- [ ] Hito 3 — Metering (`POST/GET /v1/usage`, agregación)
- [ ] Hito 4 — Cuotas (soft/hard enforcement)
- [ ] Hito 5 — Stripe (checkout, portal, push de usage, webhooks)
- [ ] Hito 6 — Dashboard real-time (SSE) + seed
- [ ] Hito 7 — README senior + diagrama Mermaid + `DECISIONS.md`
