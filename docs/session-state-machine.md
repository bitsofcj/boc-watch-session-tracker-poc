# Session State Machine

Each session has a `state` field that reflects what the viewer is currently doing. The state is derived from the sequence of events received for that session.

---

## States

| State | Meaning |
|---|---|
| `watching` | Viewer is actively playing |
| `paused` | Viewer has paused playback |
| `buffering` | Player is buffering; playback is interrupted |
| `ended` | Session is closed — either cleanly via an `end` event, or marked stale after inactivity |

---

## Transitions

The table below defines which `eventType` causes which state transition. "No change" means the event is stored but the state is preserved.

| Event | From any state | Notes |
|---|---|---|
| `start` | → `watching` | Creates the session if it does not exist |
| `resume` | → `watching` | |
| `buffer_end` | → `watching` | |
| `seek` | → `watching` | Seeking implies the viewer is active |
| `heartbeat` | no change | Keep-alive; updates `lastEventAt` and advances staleness timer |
| `quality_change` | no change | Metadata update only |
| `pause` | → `paused` | |
| `buffer_start` | → `buffering` | |
| `end` | → `ended` | Terminal — see below |

### Terminal state

`ended` is a terminal state. Once a session reaches `ended`, all subsequent events for that `sessionId` are silently dropped. A new session cannot be reopened under the same `sessionId`.

---

## Session creation

The first event received for a `sessionId` creates the session, regardless of `eventType`. If the SDK misses the `start` event (network drop, client bug), subsequent events — including heartbeats — still create and track the session. The initial state follows the transition table above; in practice the first event is almost always `start`, which maps to `watching`.

---

## Staleness

A session that stops sending heartbeats is considered stale and treated as `ended` after `STALE_THRESHOLD_MS` of inactivity. This defaults to `HEARTBEAT_INTERVAL_MS × 3` — enough to absorb two missed heartbeat intervals before declaring the session lost.

Staleness is enforced in two places:

1. **At query time** — both `GET /sessions/:sessionId` and `GET /active-viewers/:eventId` apply the staleness check dynamically. A session that went stale 5 seconds ago is excluded from the active count immediately, without waiting for the background job.

2. **Background cleanup** — a job runs every `HEARTBEAT_INTERVAL_MS` and writes `state = 'ended'` to all sessions whose `lastEventAt` is older than `STALE_THRESHOLD_MS`. This keeps the database consistent so historical queries don't require runtime staleness logic.

```
lastEventAt < now() - STALE_THRESHOLD_MS  →  state becomes 'ended'
```

---

## State diagram

```
               start / any event
                      │
                      ▼
          ┌─────────────────────┐
          │       watching      │◄──── resume / buffer_end / seek
          └─────────────────────┘
              │           │
           pause       buffer_start
              │           │
              ▼           ▼
          ┌────────┐  ┌───────────┐
          │ paused │  │ buffering │
          └────────┘  └───────────┘
              │           │
           resume       buffer_end
              └─────┬─────┘
                    ▼
             (back to watching)

     end event or STALE_THRESHOLD_MS of inactivity
                    │
                    ▼
          ┌─────────────────────┐
          │        ended        │  (terminal)
          └─────────────────────┘
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `HEARTBEAT_INTERVAL_MS` | `10000` | How often the SDK sends heartbeats; also controls the cleanup job frequency |
| `STALE_THRESHOLD_MS` | `HEARTBEAT_INTERVAL_MS × 3` | Inactivity window before a session is considered ended |

The default `HEARTBEAT_INTERVAL_MS` is set to 10 seconds for development and demo purposes. The PRD specifies 30-second heartbeats in production — override with `HEARTBEAT_INTERVAL_MS=30000` to match.
