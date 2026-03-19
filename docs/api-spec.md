# API Specification

The watch session tracker exposes four endpoints. All request and response bodies are JSON.

---

## POST /events

Ingest a single player SDK event. This is the high-volume ingestion path — every heartbeat from every active viewer hits this endpoint.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | Unique identifier for the viewing session |
| `eventType` | string | yes | One of the valid event types below |
| `payload` | object | yes | Event-specific data; must contain `eventId` |
| `payload.eventId` | string | yes | The sporting event ID (e.g. `event-2026-wrestling-finals`) |
| `payload.position` | number | no | Playback position in seconds |
| `payload.quality` | string | no | Quality tier (e.g. `1080p`, `720p`) |
| `userId` | string | no | The authenticated user ID |
| `eventId` | string | no | A session-scoped sequence ID for this transmission (e.g. `evt-1`, `evt-2`). Combined with `sessionId` to form a globally unique deduplication key. Resent unchanged on retry. |
| `eventTimestamp` | string | no | ISO 8601 timestamp from the client; defaults to server receive time |
| `receivedAt` | string | no | ISO 8601 timestamp set by the ingestion layer |

**Note on `eventId` vs `payload.eventId`:** The top-level `eventId` is a unique record identifier for this specific transmission. `payload.eventId` is the sporting event the viewer is watching. These are different fields serving different purposes. `payload.eventId` is the key used for the active viewer count query.

### Valid `eventType` values

| Value | Meaning |
|---|---|
| `start` | Viewer opened the player and began a session |
| `heartbeat` | Periodic keep-alive; fired every `HEARTBEAT_INTERVAL_MS` while playing |
| `pause` | Viewer paused playback |
| `resume` | Viewer resumed from pause |
| `seek` | Viewer seeked to a new position |
| `quality_change` | Player switched quality tiers |
| `buffer_start` | Player entered buffering state |
| `buffer_end` | Player exited buffering state |
| `end` | Viewer closed the player or the stream ended cleanly |

### Responses

| Status | Meaning |
|---|---|
| `202 Accepted` | Event ingested successfully |
| `400 Bad Request` | Missing required field or unrecognised `eventType` |

```json
{ "ok": true }
```

---

## GET /active-viewers/:eventId

Returns the current active viewer count for one or more sporting events.

`:eventId` accepts a single sporting event ID or a comma-separated list:

```
GET /active-viewers/event-2026-wrestling-finals
GET /active-viewers/event-2026-wrestling-finals,event-2026-cheerleading
```

**"Active"** is defined as: a session that has not received an `end` event and has received at least one event within the last `STALE_THRESHOLD_MS` milliseconds (default: `HEARTBEAT_INTERVAL_MS × 3`).

### Response

Returns an `active-viewers` array wrapped in an object. Events with zero active viewers are omitted.

```json
{
  "active-viewers": [
    { "eventId": "event-2026-wrestling-finals", "viewerCount": 1247 },
    { "eventId": "event-2026-cheerleading",     "viewerCount": 843  }
  ]
}
```

If no events have active viewers, returns `{ "active-viewers": [] }`.

| Status | Meaning |
|---|---|
| `200 OK` | Always returned; empty result is not a 404 |

---

## GET /sessions/:sessionId

Returns the full detail for a session by its ID.

### Response

```json
{
  "sessionId": "abc-123",
  "userId": "user-456",
  "activeEventId": "event-2026-wrestling-finals",
  "state": "watching",
  "startedAt": "2026-02-10T19:30:00.000Z",
  "durationMs": 135000,
  "events": [
    {
      "eventId": "evt-001",
      "eventType": "start",
      "eventTimestamp": "2026-02-10T19:30:00.000Z",
      "receivedAt": "2026-02-10T19:30:00.120Z",
      "payload": {
        "eventId": "event-2026-wrestling-finals",
        "position": 0,
        "quality": "1080p"
      }
    }
  ]
}
```

| Field | Description |
|---|---|
| `state` | Current session state: `watching`, `paused`, `buffering`, or `ended` |
| `durationMs` | Wall-clock time from `startedAt` to now, or to `lastEventAt` if the session has ended |
| `activeEventId` | The sporting event ID from the most recent event's `payload.eventId` |
| `events` | All events received for this session, ordered by `eventTimestamp` ascending |

**Staleness:** If a session has not received any event for more than `STALE_THRESHOLD_MS`, it is treated as `ended` at query time even if no explicit `end` event was received. A background job also periodically updates these sessions in the database.

| Status | Meaning |
|---|---|
| `200 OK` | Session found |
| `404 Not Found` | No session with this ID |

---

## GET /health

Liveness check. Returns immediately with no dependency on the database or any downstream service. Suitable for load balancer health checks and container orchestration probes.

### Response

```json
{ "status": "ok" }
```

| Status | Meaning |
|---|---|
| `200 OK` | Service is up |

---

## Error format

All error responses use the following shape (Fastify default):

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "body/eventType must be equal to one of the allowed values"
}
```
