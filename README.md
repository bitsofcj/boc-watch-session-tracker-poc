# Watch Session Tracker

A near real-time viewer session tracking service for live sporting events.

## Getting Started

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev
```

The server listens on port **3000** by default. Override with `PORT=8080 npm run dev`.

> **Note:** The heartbeat interval defaults to **10 seconds** rather than the PRD's 30 seconds. This keeps the PoC fast to demo — stale sessions are detected in ~30s instead of ~90s. Override with `HEARTBEAT_INTERVAL_MS=30000 npm run dev` to match production behaviour.

## Running Tests

```bash
npm test
```

## Client

Two clients are included for manual testing and demos — both behave identically.

**Shell** (no dependencies beyond bash and curl):
```bash
npm run client <userId> <eventId> [quality]

npm run client user-1482 event-2026-cheerleading-finals
npm run client user-7731 event-2026-wrestling 720p
```

**TypeScript** (requires Node.js 18+, uses the project's existing `tsx` dependency):
```bash
npm run client:ts <userId> <eventId> [quality]

npm run client:ts user-1482 event-2026-cheerleading-finals
npm run client:ts user-7731 event-2026-wrestling 720p
```

## API

### Ingest a player event

```
POST /events
```

```json
{
  "sessionId": "abc-123",
  "userId": "user-456",
  "eventType": "heartbeat",
  "eventId": "evt-789",
  "eventTimestamp": "2026-02-10T19:32:15.123Z",
  "receivedAt": "2026-02-10T19:32:15.450Z",
  "payload": {
    "eventId": "event-2026-wrestling-finals",
    "position": 1832.5,
    "quality": "1080p"
  }
}
```

Valid `eventType` values: `start`, `heartbeat`, `pause`, `resume`, `seek`, `quality_change`, `buffer_start`, `buffer_end`, `end`.

Returns `202 Accepted` on success. Returns `400` with a validation error if required fields are missing or `eventType` is not recognised.

---

### Active viewer count

```
GET /active-viewers/:eventId
```

Accepts a single event ID or a comma-separated list:

```
GET /active-viewers/event-2026-wrestling-finals
GET /active-viewers/event-2026-wrestling-finals,event-2026-cheerleading
```

Returns an `active-viewers` array. Events with zero viewers are omitted:

```json
{
  "active-viewers": [
    { "eventId": "event-2026-wrestling-finals", "viewerCount": 1247 },
    { "eventId": "event-2026-cheerleading",     "viewerCount": 843  }
  ]
}
```

`:eventId` is the sporting event identifier from `payload.eventId` in the ingested events.

---

### Session details

```
GET /sessions/:sessionId
```

```json
{
  "sessionId": "abc-123",
  "userId": "user-456",
  "activeEventId": "event-2026-wrestling-finals",
  "state": "watching",
  "startedAt": "2026-02-10T19:30:00.000Z",
  "durationMs": 135000,
  "events": [ ... ]
}
```

`state` is one of `watching`, `paused`, `buffering`, or `ended`.
`durationMs` is wall-clock time from `startedAt` to now (or to the last event if the session has ended).

---

## Assumptions

**`payload.eventId` is the sporting event ID.** The PRD uses `eventId` at two levels with two different meanings: the top-level `eventId` is a unique record ID for this specific transmission (e.g. `evt-1`, `evt-2`), while `payload.eventId` is the sporting event being watched (e.g. `event-2026-wrestling-finals`). The active viewer count and session tracking both use `payload.eventId`. The top-level `eventId` is stored against each event record and is intended as a deduplication key — `sessionId + eventId` together form a globally unique composite key, so if the SDK retries a failed transmission it resends the same `eventId` and the server can discard the duplicate. Both clients use a session-scoped incrementing counter (`evt-1`, `evt-2`, ...) for the top-level `eventId`.

**"Active" means not-ended and not-stale.** A session is active if it has received any event and has not received an `end` event. Sessions with no activity for more than `HEARTBEAT_INTERVAL_MS × 3` are considered stale and excluded from the active count, even before the background cleanup runs (default: 30 seconds at the 10s interval). Both the interval and the threshold are configurable via the `HEARTBEAT_INTERVAL_MS` environment variable. I'd confirm the exact staleness window with the team.

**First event creates the session, regardless of type.** If a `start` event is missed (network drop, client bug), subsequent events — including heartbeats — still create and track the session. The initial state is `watching`. This is more useful for the active-count dashboard than silently dropping events from sessions that missed their `start`.

**Duration is wall-clock, not watch-time.** `durationMs` measures time from `startedAt` to now. It doesn't subtract paused or buffering time. "Duration so far" in the PRD was ambiguous; I took the simpler path and would revisit if the product team wants watch-time instead.

**Event deduplication is not enforced in v1.** The `sessionId + eventId` composite is already shaped correctly as a deduplication key — clients send session-scoped sequential IDs (`evt-1`, `evt-2`, ...) and the server stores them. The `UNIQUE` constraint and `ON CONFLICT DO NOTHING` insert are not yet in place. See [`docs/idempotency-plan.md`](docs/idempotency-plan.md) for the full implementation path.

**Questions I'd ask the product team if I could:**
- Is `payload.eventId` always the sporting event ID, or are there other payload shapes we need to handle?
- Is "duration" the wall-clock session length or the actual watch time (excluding pauses)?
- What's the acceptable staleness window for the dashboard? The current default (3 missed heartbeat intervals) is a reasonable starting point but should be confirmed.

---

## Trade-offs

**DuckDB for local persistence.** Session state and events are written to `db/sessions.db` rather than held in memory or an external store. This means state survives restarts, the database is inspectable with any DuckDB client while the server is running (in read-only mode), and the columnar schema maps directly to ClickHouse — making this a more honest PoC than an in-memory Map. The full rationale for choosing DuckDB over SQLite is in [`docs/storage-layer-decisions.md`](docs/storage-layer-decisions.md).

**Event loss under extreme spikes is a known gap that does not meet the PRD's Operations requirement.** The PRD requires zero dropped events; this implementation does not satisfy that. Under a true traffic spike, once the Node.js event loop saturates, incoming requests queue at the OS level and eventually time out. Those events are gone. This trade-off was made deliberately to keep the v1 simple — the production path that would close this gap (Redis + ClickHouse, Kafka or SQS in front of ingestion, horizontal auto-scaling, and client-side retry) is documented in [`docs/clickhouse-redis-plan.md`](docs/clickhouse-redis-plan.md).

**10–15 second latency target is achievable.** With the default 10-second heartbeat interval and a 30-second stale threshold, the service can detect dropped sessions within ~30 seconds. Staleness is also reflected immediately at query time — `GET /sessions/:sessionId` and the active viewer count both check staleness on each request without waiting for the background cleanup sweep.

**Fastify over Express.** Fastify's built-in JSON Schema validation (via AJV) handles event payload validation without custom middleware. It also handles ~2–3× more requests per second than Express under load, which matters most for the high-volume ingestion endpoint.

**Breadth over polish.** I skipped: auth, rate limiting, metrics, and graceful drain of in-flight requests on shutdown. These would all be needed before real traffic, but they're not part of the acceptance criteria. Structured logging is in place via Fastify's built-in pino logger (controllable with `LOG_LEVEL`). Event deduplication is also not implemented — the `sessionId + eventId` composite key is already shaped correctly for idempotent writes, but the `UNIQUE` constraint and `ON CONFLICT DO NOTHING` insert are not in place yet. A full plan is in [`docs/idempotency-plan.md`](docs/idempotency-plan.md). A formal security audit was also not completed — this would cover input validation beyond schema checks, injection surface area, header hardening, and dependency review — with findings documented and fixes implemented before any production deployment.

---

## Tools Used

- **Claude (Anthropic)** — Used for initial project scaffolding (directory structure, `tsconfig.json`), drafting the session state machine transitions in `store.ts`, generating test case skeletons for `store.test.ts` and `api.test.ts`, and iterating on document structure and wording. All generated code & documentation was read, understood, and modified where needed before being kept — no code was accepted without review.
- **TypeScript + Node.js** — As specified in the assessment.
- **Fastify** — HTTP framework; chosen for higher throughput and built-in body validation over Express.
- **Vitest** — TypeScript-native test runner; no Babel config required. Uses Fastify's `inject` API for HTTP tests, so no supertest dependency needed.
- **tsx** — Runs TypeScript directly in development without a build step.

---

## Build Order

Due to time constraints I did not commit incrementally as I went. The project was built as a focused session rather than a series of discrete commits. The general order things were built is documented in [`docs/build-order.md`](docs/build-order.md).

---

## What I'd Do Differently in Production

| Concern | v1 (this repo) | Production |
|---|---|---|
| State storage | DuckDB (file-backed, columnar) | Redis + ClickHouse |
| Spike resilience | Fastify event loop | Kafka / SQS in front of ingestion |
| Scaling | Single process | Stateless workers + Redis |
| Heartbeat interval | 10s default, configurable via `HEARTBEAT_INTERVAL_MS` | Match SDK config (PRD specifies 30s) |
| Session expiry | Background sweep every `HEARTBEAT_INTERVAL_MS` | Redis TTL — no sweep needed |
| Auth | None | API key or mTLS on ingestion endpoint |
| Observability | Structured logs via pino (`LOG_LEVEL`) | Logs + metrics (Prometheus, OpenTelemetry, Datadog, New Relic, etc.) |
