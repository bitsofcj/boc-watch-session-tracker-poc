# Storage Layer Decisions

---

## Why Not Pure In-Memory

The PRD explicitly allows in-memory state for v1 — and for many implementations that would be the right call. For this service, it falls short for three reasons.

State disappears on every restart. During development that means losing all sessions on every code change. During a demo or review, a single restart wipes the viewer count dashboard and all session history. The PRD says "don't over-engineer the storage layer" — but durability across restarts is not over-engineering, it is the minimum bar for a service that anyone other than the original developer will run.

State is also not inspectable. One of the goals of a PoC is to give the team something they can poke at — query the database directly, verify counts, replay events. That is not possible with in-memory state.

Finally, a file-backed store costs nothing extra here. DuckDB adds no operational dependencies, no server process, and no configuration. The trade-off is entirely in favour of persistence.

---

## Why DuckDB Over SQLite Locally

Both DuckDB and SQLite are embedded, file-backed databases with no server process. Either satisfies "keep it simple" from the PRD. The choice came down to three factors specific to this workload.

### 1. The query pattern matches DuckDB's design

The two query endpoints are:

- **Active viewer count** — `COUNT(*)` with a staleness filter across a large sessions table, grouped by sporting event
- **Session detail** — fetch all events for a session, ordered by timestamp

Both are analytical scan queries, not point lookups. DuckDB uses a columnar storage format optimized for this pattern. SQLite uses row-oriented storage — every row in the events table is read off disk even when only a few columns are needed. For the active viewer count query scanning potentially millions of sessions, that difference is meaningful.

### 2. No build toolchain dependency

The previous `duckdb` npm package compiled a native addon via `node-gyp`, pulling in `tar`, `cacache`, and other build-time dependencies. `npm audit` reported 5 high-severity vulnerabilities in that chain. `@duckdb/node-api` ships prebuilt binaries — no compilation, no `node-gyp`, no audit findings. `better-sqlite3` (the standard SQLite binding for Node.js) also requires `node-gyp` and has the same problem.

### 3. SQL compatibility with ClickHouse

DuckDB's SQL dialect is close to ClickHouse's. The schema, `INSERT ... ON CONFLICT DO UPDATE` upserts, and `RETURNING` clause all transfer directly. When the production migration happens, the store implementation is a targeted swap of the database client — the query logic does not need to be rewritten. SQLite's dialect diverges more from ClickHouse and would require additional translation work at migration time.

### What DuckDB does not do well here

DuckDB enforces a single read-write writer lock. Only one process can have the file open in read-write mode at once — TablePlus or the DuckDB CLI must connect in read-only mode (`duckdb -readonly db/sessions.db`) while the server is running. For a development PoC this is an acceptable trade-off.

---

## Why Redis + ClickHouse in Production

The v1 DuckDB store is a single file on a single machine. That is appropriate for a PoC and unsuitable for production at FloSports scale. Two things change at scale that drive the storage choice.

### The state management problem

At hundreds of thousands of concurrent sessions, every heartbeat (arriving every 30 seconds from every active viewer) is a write. DuckDB's single-writer model and embedded nature mean it cannot be shared across multiple service instances — horizontal scaling of the HTTP service is blocked. The service becomes a single-instance bottleneck.

Redis solves this directly. It is designed for exactly this access pattern: high-frequency, low-latency reads and writes on a small amount of hot data. Session state (current state, last event timestamp, active sporting event) is a Redis hash. Viewer counts are Redis counters. TTL-based expiry replaces the cleanup sweep that runs on a timer in v1 — stale sessions disappear automatically when their TTL expires. Any number of HTTP service instances can talk to the same Redis instance.

### The analytics query problem

The active viewer count query scans every session for a given sporting event. At hundreds of thousands of rows this is fast. At hundreds of millions of historical sessions across thousands of events it becomes expensive — and the PRD asks for this number to be available "within 10–15 seconds of reality" for a dashboard that is presumably polling frequently.

ClickHouse is designed for this query. Its columnar MergeTree engine handles aggregation scans at hundreds of millions of rows in milliseconds. It also directly replaces the legacy hourly batch pipeline the PRD describes — raw events are durable, replayable, and queryable within seconds of arrival. Product gets near real-time answers to analytical questions (viewer trends, quality breakdowns, drop-off rates) that previously required waiting for the batch job.

### How the layers divide responsibility

| Query | Store | Reason |
|---|---|---|
| How many viewers are watching right now? | Redis counter | In-memory speed, updated on every state change |
| What is the current state of session X? | Redis hash | Low-latency point lookup, TTL expiry handles cleanup |
| What events did session X receive? | ClickHouse | Durable event history, fast scan by session_id |
| Viewer trends, quality breakdowns, drop-off rates | ClickHouse | Analytical aggregation across all historical events |

Redis handles the live, hot data. ClickHouse handles the durable, queryable history. The HTTP service is stateless and scales horizontally behind a load balancer.

### What the migration looks like

The v1 `SessionStore` class takes a `Db` interface. Swapping the storage layer means implementing that interface against Redis and ClickHouse clients — the route handlers, request validation, and session state machine in `store.ts` do not change. The DuckDB schema was designed with this migration in mind: column names, query structure, and SQL dialect map directly to ClickHouse without rewriting the business logic.

See `docs/clickhouse-redis-plan.md` for the full production architecture, schema, and scaling trade-offs.
