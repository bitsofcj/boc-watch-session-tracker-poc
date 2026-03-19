# Redis + ClickHouse Scaling Plan

---

## Why This Stack

The PRD says:

> "FloSports streams live sporting events to hundreds of thousands of concurrent viewers."

> "Today, our player SDK fires events to a legacy analytics pipeline that batches data hourly. Product is asking for something closer to real-time."

ClickHouse solves both the scale problem and the legacy pipeline replacement in one move — raw events are durable, replayable, and queryable within seconds of arrival, with no hourly batch job.

---

## What Each Layer Does

**ClickHouse**
- Ingests the raw event stream at hundreds of thousands of writes/second natively — no broker needed, batching is handled internally by the merge-tree storage engine
- Makes events queryable within seconds of arrival, satisfying the 10–15 second freshness requirement from the PRD
- Replaces the legacy hourly batch pipeline directly — Product gets near real-time answers to analytical questions (viewer trends, quality breakdowns, drop-off rates) that were previously only available after the batch job finished
- Durable by default — events survive crashes and are replayable, addressing the Operations concern

**Redis**
- Handles live session state (current state, last event, active sporting event) as Redis hashes with TTL-based expiry
- Handles viewer counts as Redis counters — incremented on session start, decremented on end or TTL expiry
- Given the 10–15 second latency target from the PRD, Redis is optional — ClickHouse could serve viewer count queries within that window. Redis is included here as a simple, low-overhead layer that keeps the hot-path reads fast and offloads ClickHouse from serving frequent dashboard polling.

---

## Architecture

```
SDK clients
    ↓
Load balancer
    ↓
HTTP service (stateless, N instances)
    ↓              ↓
Redis          ClickHouse
(live state,   (durable event history,
 counts, TTL)   near real-time analytics)
```

No message broker. ClickHouse absorbs write spikes internally. The HTTP service is stateless and horizontally scalable.

---

## ClickHouse Schema

```sql
CREATE TABLE events (
  session_id       String,
  user_id          String,
  event_type       String,
  event_id         String,
  event_timestamp  DateTime64(3),
  received_at      DateTime64(3),
  sporting_event_id String,
  position         Nullable(Float64),
  quality          Nullable(String)
) ENGINE = MergeTree()
ORDER BY (sporting_event_id, session_id, event_timestamp);
```

The `MergeTree` engine handles high-volume inserts by batching writes internally. The ordering key makes the two most common query patterns fast:
- Active viewer count for a sporting event — filter by `sporting_event_id`
- Session detail for a session ID — filter by `session_id`

### Viewer count query

```sql
SELECT COUNT(DISTINCT session_id)
FROM events
WHERE sporting_event_id = 'event-2026-wrestling-finals'
  AND event_timestamp >= now() - INTERVAL 30 SECOND
  AND event_type != 'end'
```

This runs in well under 10 seconds at hundreds of millions of rows — ClickHouse is designed for exactly this kind of aggregation scan.

---

## Redis Schema

**Session state** — hash per session, TTL set to `STALE_THRESHOLD_MS`:
```
HSET session:{sessionId} state watching sportingEventId event-xyz lastEventAt <iso> position 120.5
EXPIRE session:{sessionId} 30
```

Every heartbeat resets the TTL. No cleanup sweep needed — stale sessions expire automatically.

**Viewer counts** — counter per sporting event:
```
INCR viewers:{sportingEventId}   # on start or event switch
DECR viewers:{sportingEventId}   # on end event or keyspace expiry notification
```

---

## What Changes in the Codebase

### `src/store.ts`
- Redis client replaces the `Map<sessionId, Session>` for live state
- ClickHouse client replaces the `events` array — each `processEvent` call inserts a row
- `getActiveViewerCount` reads from Redis counter (or falls back to ClickHouse query if Redis is unavailable)
- `getSession` reads state from Redis hash, full event history from ClickHouse
- `cleanupStaleSessions` is no longer needed — Redis TTL handles it

### `src/index.ts`
Initialize Redis and ClickHouse clients, pass to the store. Remove the cleanup interval.

### `app.ts`, `types.ts`
No changes.

### Tests
Use `ioredis-mock` for Redis unit tests. ClickHouse can be tested against a local instance via Docker or mocked for unit tests. Integration tests should use real instances.

---

## ClickHouse Scalability

ClickHouse is designed to scale — both vertically and horizontally.

**Horizontal scaling**
ClickHouse scales out via sharding and replication. Add nodes to the cluster, define a sharding key (e.g. `sessionId`), and ClickHouse distributes writes and queries across nodes automatically. Reads are parallelized across shards, so query performance improves linearly as nodes are added.

**Replication and failover**
ClickHouse uses `ReplicatedMergeTree` built on ClickHouse Keeper for automatic replication and failover. Each shard can have multiple replicas — if a node goes down, a replica takes over without manual intervention.

**Query parallelism**
Even on a single node, ClickHouse parallelizes queries across all available CPU cores. Adding nodes multiplies this parallelism further.

**Real-world scale**
ClickHouse is in production at Cloudflare, Uber, Spotify, and ByteDance handling trillions of rows and petabytes of data. The PRD's scale — hundreds of thousands of concurrent viewers — is well within what a single ClickHouse node handles comfortably.

**Where it does not scale well**
ClickHouse is not designed for high-cardinality point lookups — fetching a single row by ID repeatedly at high concurrency. This is why Redis sits alongside it in this architecture: Redis handles live session state and viewer counts at low latency, ClickHouse handles durable history and analytical queries. Each tool does what it is designed for.

**For the PRD's scale**
A single ClickHouse node on a compute-optimized AWS EC2 or GCP Compute Engine instance is sufficient for hundreds of thousands of concurrent viewers. Clustering becomes relevant when you need multi-region redundancy or are pushing into the millions of concurrent users.

---

## Data Loss Under High Load

This architecture partially addresses the Operations requirement of not losing events under traffic spikes — but there is a gap worth being explicit about.

### What is covered

- **ClickHouse** absorbs write spikes internally via its MergeTree engine — it batches and queues writes itself, so under high load requests slow down rather than drop
- **Redis** handles the hot path with in-memory speed and rarely becomes a bottleneck

### The gap

The HTTP service is still the front door. Under extreme load — more requests per second than the Node.js instances can accept — the OS-level TCP queue fills up and connections are refused before they reach the application. Those events are gone. ClickHouse's internal batching does not help if the request never makes it to the service.

### Closing the gap without a message broker

**1. Horizontal auto-scaling**

AWS Auto Scaling Groups or GCP Managed Instance Groups automatically spin up additional Node.js instances when CPU or request queue depth crosses a threshold. The load balancer distributes traffic across them. This raises the ceiling significantly and handles the vast majority of real-world spikes. The remaining risk is a spike large enough to outpace the auto-scaling response time — typically 1–3 minutes to provision a new instance.

**2. Client-side retry with `requestId`**

If the server returns a 5xx or the connection is refused, the SDK retries with the same `requestId`. The server deduplicates on `requestId` using ClickHouse's `ReplacingMergeTree` so the retry is safe and produces no duplicate records. This shifts spike absorption to the client retry loop rather than requiring the server to accept everything instantly.

Together, auto-scaling and client-side retry close most of the practical gap for the PRD's scale without introducing a message broker. The remaining unaddressed scenario is a spike so large it overwhelms the auto-scaling response time — at that point a broker (Kafka, SQS) in front of ingestion is the correct answer. That is an extraordinary scenario, not the normal operating condition for hundreds of thousands of concurrent viewers.

### Summary

| Risk | Mitigation |
|---|---|
| ClickHouse write saturation | MergeTree internal batching — handled natively |
| Redis saturation | In-memory speed; Redis Cluster if needed |
| Node.js instance saturation | Auto-scaling group behind load balancer |
| Spike faster than auto-scaling | Client-side retry with `requestId` deduplication |
| Catastrophic spike beyond all capacity | Message broker (out of scope for this architecture) |

---

## Honest Trade-offs

- ClickHouse has a learning curve. Teams familiar with row-oriented databases will need time to understand the columnar model and MergeTree semantics.
- ClickHouse is optimized for analytical reads, not transactional point lookups. `GET /sessions/:sessionId` returning full event history is fast, but the query pattern differs from a row-oriented store.
- Redis is optional given the 10–15 second latency target in the PRD. ClickHouse can serve viewer count queries within that window on its own. Redis adds resilience and keeps the read path simple under heavy dashboard polling, but it is not strictly required to meet the stated requirements.
