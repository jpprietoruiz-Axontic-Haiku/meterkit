# DECISIONS

Por qué está construido así, no solo qué hace. Cada sección es una decisión con su
alternativa descartada y el motivo.

## 1. Stack: Bun + Hono + Drizzle + Postgres

- **Bun** como runtime: arranque e instalación rápidos, test runner y bundler incluidos (sin
  Jest/esbuild/tsx aparte), `Bun.password` para hashing de contraseñas sin dependencia extra.
- **Hono**: router minimalista, tipado de extremo a extremo con `Hono<AppEnv>` (el contexto —
  `c.get("user")` — está tipado, no es `any`), soporte nativo de streaming (`hono/streaming`
  para el SSE del hito 6) y funciona igual en Bun que en cualquier otro runtime si el deploy
  cambiara.
- **Drizzle**: el schema es TypeScript (`schema.ts`), no SQL ni un DSL propio — los tipos de
  las queries salen de ahí sin generación de código aparte. `drizzle-kit` migra con SQL plano
  versionado en `apps/api/drizzle/`, auditable en el PR.
- **Postgres**: transacciones reales y `INSERT ... ON CONFLICT` (upsert atómico), la pieza
  central de cómo se agrega uso (ver §3) y de cómo se deduplican webhooks (ver §5).

Alternativa descartada: Next.js API routes + Prisma. Prisma genera un cliente aparte (paso de
build extra, menos control sobre el SQL exacto del upsert); Next.js añade SSR/routing que
esta API no necesita — es un backend puro consumido por un dashboard separado.

## 2. Aislamiento multi-tenant: invariante, no feature

Cada tabla de dominio (`users`, `usage_events`, `usage_aggregates`, `quotas`) tiene
`tenant_id` con `references(() => tenants.id, { onDelete: "cascade" })`. La regla que hace
que el aislamiento sea real y no solo "casi siempre correcto":

**El `tenantId` de cualquier query nunca viene del cliente.** Sale siempre de una fuente que
el servidor controla:
- En rutas con JWT (`requireAuth`): `c.get("user").tenantId`, extraído del token firmado.
- En la ingestión de uso (`requireApiKey`): el `tenantId` se resuelve buscando el **hash** de
  la API key recibida en `tenants.apiKeyHash` — el propio proceso de autenticación *es* la
  resolución del tenant, no hay forma de pedir datos de "otro" tenant con una key válida.

Ningún endpoint acepta `tenantId` como parámetro de body/query. Esto elimina de raíz la clase
de bug más común en SaaS multi-tenant: un usuario autenticado que pasa el `tenantId` de otra
cuenta y el backend confía en él.

Esto se verifica con tests de integración contra Postgres real (no mocks) en cada hito que
toca datos de tenant: dos tenants se crean en el mismo test, uno actúa, y se comprueba tanto
por API (`GET /auth/me`, `GET /v1/usage`) como por query directa a la base de datos que el
otro tenant no ve ni sufre el efecto. Ver `apps/api/test/*.integration.test.ts`.

Alternativa descartada: un schema de Postgres por tenant, o bases de datos separadas. Da
aislamiento más fuerte a nivel de motor, pero para un starter multiplica la complejidad
operativa (migraciones × N schemas, pooling de conexiones, provisioning por alta de tenant)
sin necesidad demostrada a esta escala. Row-level con `tenant_id` + disciplina de queries +
tests es el punto correcto para este proyecto; row-level security (RLS) nativo de Postgres
quedó fuera por alcance, no por desconocimiento — es la siguiente palanca si el starter
creciera.

## 3. Agregación eficiente: upsert atómico, no leer-antes-de-escribir

`usage_aggregates` es la vista materializada por `(tenant_id, period, metric)` que consume el
dashboard, para no agregar `usage_events` en caliente en cada `GET`. Se mantiene con un único
`INSERT ... ON CONFLICT (tenant_id, period, metric) DO UPDATE SET total = total + delta`
dentro de la misma transacción que inserta el `usage_event` (`lib/usage.ts`).

Por qué esto y no "leer el total actual, sumar en la aplicación, escribir": esa secuencia
tiene una carrera clásica — dos requests concurrentes leen el mismo total, cada una suma su
delta sobre el valor viejo, y la segunda escritura pisa a la primera. El upsert delega el
incremento al motor (`total = total + delta` se evalúa fila por fila dentro de Postgres), así
que es correcto bajo cualquier nivel de concurrencia sin necesidad de locks explícitos ni
reintentos en la aplicación. El test
`apps/api/test/usage.integration.test.ts` ("no pierde incrementos bajo escritura
concurrente") dispara 20 requests en paralelo contra el mismo `(tenant, metric, día)` y
verifica que el total final es exactamente la suma — es la prueba de que esta propiedad se
sostiene, no solo una afirmación.

`period` trunca a **día UTC** (`lib/period.ts`). Es el punto medio entre "el dashboard puede
mostrar una serie diaria útil" y "no acumular una fila por evento" — con miles de eventos/día
por tenant, la tabla de agregados crece unas pocas filas por metric y día, no una por evento.

Las cuotas (§4) son mensuales pero no hay una tabla de agregados por mes: el consumo del mes
se calcula sumando las filas diarias del mes en curso (`getCurrentMonthTotal`, como mucho 31
filas). Mantener un segundo nivel de agregado (mensual) hubiese significado un segundo upsert
por evento para un ahorro de query que, a este volumen, no se nota — una duplicación de
lógica sin beneficio medible.

`cost_total` (coste estimado, `quantity × unitCost`) se acumula en el mismo upsert que
`total`, no se recalcula aparte: es gratis añadirlo a una escritura que ya existe.

## 4. Cuotas: decisión pura, separada del I/O

`evaluateQuota(currentTotal, quantity, quota)` en `lib/quotas.ts` no toca la base de datos:
recibe números y decide `blocked`/`warning`. `checkQuota()` es la capa fina que lee el total
del mes y la cuota configurada y delega la decisión a la función pura. Separar la decisión del
I/O es lo que permite testear todas las combinaciones (soft, hard, sin cuota, justo en el
límite, ya excedido de antes) como tests unitarios instantáneos, sin Postgres — y es lo que
pide la consigna de "unit test del enforcement de cuota" de forma literal, no aproximada.

El enforcement corre en `POST /v1/usage` **antes** de registrar el evento: si `hard` y la
llamada superaría el límite, se responde `429` con el metric, el límite y el consumo actual
en el mensaje, y el evento **no se inserta** (verificado en
`quotas.integration.test.ts`). `soft` dispara el mismo cálculo pero solo añade un campo
`quotaWarning` a la respuesta `201` — la llamada se sirve igual.

## 5. Webhooks idempotentes: la práctica estándar, nada más

`webhook_events(stripe_event_id UNIQUE)` + `INSERT ... ON CONFLICT DO NOTHING`: si el insert
no inserta ninguna fila es que ese `event.id` ya se procesó (reintento de Stripe), y se
responde `200` sin volver a aplicar el efecto. Es la deduplicación que cualquier integración
seria de webhooks de Stripe necesita — no hay nada específico de MeterKit aquí.

Lo que **no** hay, a propósito: un motor de lease/reclaim para colas de reintento bajo
concurrencia, cascadas de reintento de cobro, ni generación de emails de dunning. Eso es
territorio de recuperación de pagos fallidos (un producto de una categoría distinta), no de
metering/billing por uso. Ver el aviso de alcance en el [README](./README.md).

## 6. Stripe: Billing Meters, no `usage_records` legacy

`push-usage-to-stripe` (`src/jobs/push-usage-to-stripe.ts`) reporta consumo con la API de
**Billing Meters** (`stripe.billing.meterEvents.create`), la vía actual de Stripe para
metered billing, en vez de la API legacy de `usage_records` atada a subscription items.

Es un **script de una sola pasada**, no un worker persistente ni una cola. Para cada tenant
con `stripeCustomerId`, reporta el delta no informado por fila de `usage_aggregates`
(`total - stripe_pushed_total`) y luego iguala `stripe_pushed_total = total` — así un fallo a
mitad de lote no reporta dos veces lo ya enviado, y una re-ejecución solo cubre lo pendiente.
Está pensado para invocarse desde un scheduler externo (cron job de Railway, `schedule` de
GitHub Actions), no para vivir dentro del proceso de la API. Construir un scheduler propio
dentro de MeterKit hubiese sido infraestructura de jobs por su propio peso, fuera del alcance
de un starter de metering.

## 7. Dashboard en tiempo real: SSE con polling corto, no WebSockets

El dashboard necesita un flujo **unidireccional** (servidor → cliente): "aquí está tu consumo
ahora". SSE (`hono/streaming`) da eso con HTTP plano — sin protocolo de upgrade, sin
reconexión manual (el navegador reconecta un `EventSource` solo), y sin el estado bidireccional
que WebSockets ofrece y que aquí no se usa para nada.

`GET /v1/usage/stream` hace polling a `usage_aggregates` cada 3 segundos y emite un snapshot
del mes en curso. La alternativa más "real-time" — `LISTEN`/`NOTIFY` de Postgres disparando el
push en cuanto se escribe un evento — se descartó por la infraestructura adicional que exige
(una conexión dedicada a escuchar, gestión de reconexión del listener) para una ganancia que
un dashboard de coste no necesita: nadie mira una cifra de facturación con expectativa de
verla moverse en milisegundos. Tres segundos es una cadencia que se siente "en vivo" sin ese
costo.

**Excepción de seguridad documentada**: la API nativa `EventSource` del navegador no puede
enviar headers propios, así que no puede mandar `Authorization: Bearer`. Por eso — y
únicamente en esta ruta — el JWT también se acepta por query string (`?token=`). El resto de
endpoints protegidos por JWT exige el header; esta es la única excepción, acotada a un
endpoint de solo lectura, documentada en el código (`routes/usage.ts`) y aquí.

## 8. Auth: contraseñas, JWT y API keys

- **Contraseñas**: `Bun.password` (argon2id) — sin dependencia extra, algoritmo moderno
  resistente a GPU cracking.
- **JWT**: `jose`, HS256, 24h de expiración, payload mínimo (`sub`, `tenantId`, `role`,
  `email`). Sin refresh tokens: para el alcance de un starter, un access token de vida corta
  que obliga a un nuevo login es una superficie de ataque menor que gestionar rotación de
  refresh tokens, y es lo que la consigna pedía ("JWT multi-role"), no un sistema de sesiones
  completo.
- **API keys**: alta entropía (24 bytes aleatorios), y se guarda su **hash SHA-256**, no un
  hash lento tipo argon2/bcrypt. La razón: un hash lento defiende contra fuerza bruta sobre un
  espacio de contraseñas humanas (baja entropía); una API key de 192 bits aleatorios ya es
  inviable de fuerza-bruta, así que un hash lento solo añadiría latencia a cada request de
  ingestión sin mejorar la seguridad real. La clave en claro se muestra **una vez** (al
  generarla/rotarla) y nunca se vuelve a poder recuperar — igual que Stripe, GitHub, etc.

## 9. Tests: unit donde hay lógica pura, integración donde hay invariantes

- **Unit** (sin Postgres): `evaluateQuota`, truncado de periodos (`startOfUtcDay`/
  `startOfUtcMonth`), hash/verificación de password, firma/verificación de JWT, generación de
  API keys. Corren en milisegundos y no dependen de infraestructura.
- **Integración** (contra Postgres real, nunca mocks): todo lo que involucra el invariante de
  aislamiento multi-tenant, RBAC, agregación concurrente, enforcement de cuota end-to-end e
  idempotencia de webhooks. Mockear la base de datos aquí habría probado que el código llama
  a las funciones correctas, no que el aislamiento y la atomicidad **realmente** se sostienen
  contra un motor real — que es exactamente lo que hay que demostrar en un starter que se
  vende por su multi-tenancy.

CI levanta un contenedor de Postgres real (no SQLite ni una base en memoria) para que la
suite de integración corra en cada push, no solo en el disco de quien la escribió.
