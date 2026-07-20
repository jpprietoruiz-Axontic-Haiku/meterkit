# DECISIONS

Why it's built this way, not just what it does. Each section is a decision with the
alternative it ruled out and the reason why.

## 1. Stack: Bun + Hono + Drizzle + Postgres

- **Bun** as the runtime: fast startup and installs, built-in test runner and bundler (no
  separate Jest/esbuild/tsx), `Bun.password` for password hashing without an extra
  dependency.
- **Hono**: minimalist router, end-to-end typing via `Hono<AppEnv>` (the context —
  `c.get("user")` — is typed, not `any`), native streaming support (`hono/streaming`
  for milestone 6's SSE), and it behaves the same on Bun as on any other runtime should the
  deployment target change.
- **Drizzle**: the schema is TypeScript (`schema.ts`), not SQL or a proprietary DSL — query
  types are derived from it without a separate codegen step. `drizzle-kit` migrates with
  plain, versioned SQL in `apps/api/drizzle/`, auditable in the PR.
- **Postgres**: real transactions and `INSERT ... ON CONFLICT` (atomic upsert), the central
  piece of how usage is aggregated (see §3) and how webhooks are deduplicated (see §5).

Alternative ruled out: Next.js API routes + Prisma. Prisma generates a separate client (extra
build step, less control over the exact upsert SQL); Next.js adds SSR/routing this API doesn't
need — it's a pure backend consumed by a separate dashboard.

## 2. Multi-tenant isolation: an invariant, not a feature

Every domain table (`users`, `usage_events`, `usage_aggregates`, `quotas`) has a `tenant_id`
with `references(() => tenants.id, { onDelete: "cascade" })`. The rule that makes isolation
real rather than just "almost always correct":

**The `tenantId` in any query never comes from the client.** It always comes from a
server-controlled source:
- On JWT routes (`requireAuth`): `c.get("user").tenantId`, extracted from the signed token.
- On usage ingestion (`requireApiKey`): the `tenantId` is resolved by looking up the **hash**
  of the received API key in `tenants.apiKeyHash` — the authentication process itself *is*
  the tenant resolution; there's no way to request "another" tenant's data with a valid key.

No endpoint accepts `tenantId` as a body/query parameter. This eliminates at the root the most
common bug class in multi-tenant SaaS: an authenticated user passing another account's
`tenantId` and the backend trusting it.

This is verified with integration tests against real Postgres (no mocks) in every milestone
that touches tenant data: two tenants are created in the same test, one acts, and it's checked
both via the API (`GET /auth/me`, `GET /v1/usage`) and via a direct database query that the
other tenant neither sees nor is affected by the action. See
`apps/api/test/*.integration.test.ts`.

Alternative ruled out: one Postgres schema per tenant, or separate databases. This gives
stronger isolation at the engine level, but for a starter it multiplies operational
complexity (migrations × N schemas, connection pooling, per-tenant-signup provisioning)
without demonstrated need at this scale. Row-level isolation via `tenant_id` + query
discipline + tests is the right point for this project; native Postgres row-level security
(RLS) was left out by scope, not by unfamiliarity — it's the next lever to pull if the
starter grew.

## 3. Efficient aggregation: atomic upsert, not read-before-write

`usage_aggregates` is the materialized view by `(tenant_id, period, metric)` that the
dashboard consumes, so `usage_events` doesn't need to be aggregated on the fly on every `GET`.
It's maintained with a single
`INSERT ... ON CONFLICT (tenant_id, period, metric) DO UPDATE SET total = total + delta`
inside the same transaction that inserts the `usage_event` (`lib/usage.ts`).

Why this instead of "read the current total, add in the application, write back": that
sequence has a classic race — two concurrent requests read the same total, each adds its
delta on top of the stale value, and the second write clobbers the first. The upsert delegates
the increment to the engine (`total = total + delta` is evaluated row-by-row inside Postgres),
so it's correct under any level of concurrency without needing explicit locks or application-
level retries. The test `apps/api/test/usage.integration.test.ts` ("does not lose increments
under concurrent writes") fires 20 requests in parallel against the same
`(tenant, metric, day)` and verifies the final total is exactly the sum — that's proof this
property holds, not just a claim.

`period` truncates to **UTC day** (`lib/period.ts`). It's the sweet spot between "the
dashboard can show a useful daily series" and "don't accumulate one row per event" — with
thousands of events/day per tenant, the aggregates table grows by a handful of rows per metric
per day, not one per event.

Quotas (§4) are monthly, but there's no separate monthly aggregates table: the month's
consumption is computed by summing the current month's daily rows (`getCurrentMonthTotal`, at
most 31 rows). Maintaining a second aggregation level (monthly) would have meant a second
upsert per event for a query-time saving that, at this volume, isn't noticeable — duplicated
logic with no measurable benefit.

`cost_total` (estimated cost, `quantity × unitCost`) accumulates in the same upsert as
`total`, not recomputed separately: it's free to add to a write that's already happening.

## 4. Quotas: a pure decision, separate from I/O

`evaluateQuota(currentTotal, quantity, quota)` in `lib/quotas.ts` doesn't touch the database:
it takes numbers and decides `blocked`/`warning`. `checkQuota()` is the thin layer that reads
the month's total and the configured quota and delegates the decision to the pure function.
Separating the decision from the I/O is what makes it possible to test every combination
(soft, hard, no quota, right at the limit, already over) as instant unit tests, without
Postgres — and it's what a literal "unit test for quota enforcement" requirement actually
calls for, not an approximation of one.

Enforcement runs in `POST /v1/usage` **before** the event is recorded: if `hard` and the call
would exceed the limit, it responds with `429` including the metric, the limit, and current
consumption in the message, and the event **is not inserted** (verified in
`quotas.integration.test.ts`). `soft` runs the same calculation but only adds a
`quotaWarning` field to the `201` response — the call is served regardless.

## 5. Idempotent webhooks: standard practice, nothing more

`webhook_events(stripe_event_id UNIQUE)` + `INSERT ... ON CONFLICT DO NOTHING`: if the insert
doesn't insert a row, that `event.id` was already processed (a Stripe retry), and it responds
`200` without reapplying the effect. This is the deduplication any serious Stripe webhook
integration needs — nothing about it is specific to MeterKit.

What's deliberately **not** here: a lease/reclaim engine for retry queues under concurrency,
payment retry cascades, or dunning email generation. That's failed-payment recovery territory
(a different category of product), not usage metering/billing. See the scope note in the
[README](./README.md).

## 6. Stripe: Billing Meters, not the legacy `usage_records`

`push-usage-to-stripe` (`src/jobs/push-usage-to-stripe.ts`) reports consumption via the
**Billing Meters** API (`stripe.billing.meterEvents.create`), Stripe's current approach to
metered billing, instead of the legacy `usage_records` API tied to subscription items.

It's a **single-pass script**, not a persistent worker or a queue. For each tenant with a
`stripeCustomerId`, it reports the unreported delta per `usage_aggregates` row
(`total - stripe_pushed_total`) and then sets `stripe_pushed_total = total` — so a failure
mid-batch doesn't double-report what was already sent, and a re-run only covers what's still
pending. It's meant to be invoked from an external scheduler (a Railway cron job, GitHub
Actions `schedule`), not to live inside the API process. Building a scheduler of its own
inside MeterKit would have been job infrastructure disproportionate to a metering starter's
scope.

## 7. Real-time dashboard: short-interval SSE, not WebSockets

The dashboard needs a **unidirectional** flow (server → client): "here's your consumption
right now." SSE (`hono/streaming`) delivers that over plain HTTP — no upgrade protocol, no
manual reconnection (the browser reconnects an `EventSource` on its own), and none of the
bidirectional state WebSockets offer that goes unused here.

`GET /v1/usage/stream` polls `usage_aggregates` every 3 seconds and emits a snapshot of the
current month. The more "real-time" alternative — Postgres `LISTEN`/`NOTIFY` pushing as soon
as an event is written — was ruled out for the extra infrastructure it requires (a dedicated
listening connection, listener reconnection handling) for a gain a cost dashboard doesn't
need: nobody watches a billing figure expecting to see it move in milliseconds. Three seconds
is a cadence that feels "live" without that cost.

**Documented security exception**: the browser's native `EventSource` API can't send custom
headers, so it can't send `Authorization: Bearer`. Because of that — and only on this route —
the JWT is also accepted via query string (`?token=`). Every other JWT-protected endpoint
requires the header; this is the sole exception, scoped to a read-only endpoint, and
documented both in the code (`routes/usage.ts`) and here.

## 8. Auth: passwords, JWT, and API keys

- **Passwords**: `Bun.password` (argon2id) — no extra dependency, a modern algorithm
  resistant to GPU cracking.
- **JWT**: `jose`, HS256, 24h expiration, minimal payload (`sub`, `tenantId`, `role`,
  `email`). No refresh tokens: for a starter's scope, a short-lived access token that forces
  a fresh login is a smaller attack surface than managing refresh token rotation, and it's
  what the requirement called for ("multi-role JWT"), not a full session system.
- **API keys**: high entropy (24 random bytes), and only their **SHA-256 hash** is stored, not
  a slow hash like argon2/bcrypt. The reasoning: a slow hash defends against brute force over
  a space of human passwords (low entropy); a 192-bit random API key is already
  brute-force-infeasible, so a slow hash would only add latency to every ingestion request
  without improving actual security. The plaintext key is shown **once** (on
  generation/rotation) and can never be retrieved again — same as Stripe, GitHub, etc.

## 9. Tests: unit where there's pure logic, integration where there are invariants

- **Unit** (no Postgres): `evaluateQuota`, period truncation (`startOfUtcDay`/
  `startOfUtcMonth`), password hashing/verification, JWT signing/verification, API key
  generation. Run in milliseconds and don't depend on infrastructure.
- **Integration** (against real Postgres, never mocks): everything involving the multi-tenant
  isolation invariant, RBAC, concurrent aggregation, end-to-end quota enforcement, and webhook
  idempotency. Mocking the database here would have proven the code calls the right
  functions, not that isolation and atomicity **actually** hold against a real engine — which
  is exactly what needs to be demonstrated in a starter sold on its multi-tenancy.

CI spins up a real Postgres container (not SQLite or an in-memory database) so the
integration suite runs on every push, not just on the author's machine.
