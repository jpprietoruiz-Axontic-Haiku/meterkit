# MeterKit — 2-minute technical review

**What it demonstrates:** a multi-tenant metering and usage-based billing foundation for SaaS applications. This is a portfolio engineering project, **not a revenue-generating service**.

## Review the implementation

| Area | Where to look |
| --- | --- |
| Data model, tenant scoping and indexes | [API database schema](apps/api/src/db/schema.ts) |
| Usage measurement and quotas | [API implementation](apps/api/src) |
| Dashboard | [React application](apps/web) |
| CI checks | [GitHub Actions](.github/workflows/ci.yml) |
| Architectural trade-offs | [DECISIONS.md](DECISIONS.md) |
| Tests | [API tests](apps/api/test) |

## Why it is interesting

- Tenant-aware API keys and role-based authorization (RBAC).
- Quota enforcement and usage aggregation, including concurrent-write test coverage.
- Stripe usage-based billing in **test mode**, with webhook deduplication.
- Live dashboard updates through server-sent events (SSE).
- Reproducible local development with Bun, PostgreSQL and Docker.

## Scope and limitations

This is a **reference implementation**. It is not ChurnRescue, does not recover failed subscription payments and does not prove production traffic or paying users. Stripe configuration and usage reporting require integration setup. Verify the latest [CI runs](https://github.com/jpprietoruiz-Axontic-Haiku/meterkit/actions/workflows/ci.yml) and follow the [README](README.md) to run the project locally.

**Author:** Juan Pablo Prieto, PhD · [GitHub profile](https://github.com/jpprietoruiz-Axontic-Haiku)
