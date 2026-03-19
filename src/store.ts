import { PlayerEvent, SessionState, SessionDetails, StoredEvent } from './types';
import { STALE_THRESHOLD_MS } from './config';
import { Db } from './db';

interface SessionRow {
  sessionId: string;
  userId: string;
  sportingEventId: string;
  state: string;
  startedAt: string;
  lastEventAt: string;
}

interface EventRow {
  eventId: string;
  sessionId: string;
  eventType: string;
  eventTimestamp: string;
  receivedAt: string;
  payload: string;
}

export class SessionStore {
  constructor(private readonly db: Db) {}

  async processEvent(event: PlayerEvent): Promise<void> {
    const { sessionId, eventType, payload } = event;
    const sportingEventId = payload.eventId;
    const now = new Date().toISOString();

    const storedEvent: StoredEvent = {
      eventId: event.eventId ?? crypto.randomUUID(),
      eventType,
      eventTimestamp: event.eventTimestamp ?? now,
      receivedAt: event.receivedAt ?? now,
      payload,
    };

    const rows = await this.db.all<SessionRow>(
      'SELECT * FROM sessions WHERE sessionId = ?',
      [sessionId],
    );
    const existing = rows[0];

    if (existing?.state === 'ended') return;

    const nextState = this.nextState(existing?.state ?? 'watching', eventType);

    await this.db.run(
      `INSERT INTO sessions (sessionId, userId, sportingEventId, state, startedAt, lastEventAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (sessionId) DO UPDATE SET
         sportingEventId = excluded.sportingEventId,
         state           = excluded.state,
         lastEventAt     = excluded.lastEventAt`,
      [sessionId, event.userId ?? 'unknown', sportingEventId, nextState,
        storedEvent.eventTimestamp, storedEvent.eventTimestamp],
    );

    await this.db.run(
      `INSERT INTO events (eventId, sessionId, eventType, eventTimestamp, receivedAt, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [storedEvent.eventId, sessionId, eventType, storedEvent.eventTimestamp,
        storedEvent.receivedAt, JSON.stringify(payload)],
    );
  }

  async getActiveViewerCount(sportingEventId: string): Promise<number> {
    const threshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    const rows = await this.db.all<{ count: bigint }>(
      `SELECT COUNT(*) AS count FROM sessions
       WHERE sportingEventId = ? AND state != 'ended' AND lastEventAt > ?`,
      [sportingEventId, threshold],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async getSession(sessionId: string): Promise<SessionDetails | undefined> {
    const sessionRows = await this.db.all<SessionRow>(
      'SELECT * FROM sessions WHERE sessionId = ?',
      [sessionId],
    );
    const session = sessionRows[0];
    if (!session) return undefined;

    const eventRows = await this.db.all<EventRow>(
      'SELECT * FROM events WHERE sessionId = ? ORDER BY eventTimestamp ASC',
      [sessionId],
    );

    const now = Date.now();
    const isStale = now - new Date(session.lastEventAt).getTime() > STALE_THRESHOLD_MS;
    const effectiveState: SessionState =
      session.state !== 'ended' && isStale ? 'ended' : session.state as SessionState;

    const endMs = effectiveState === 'ended'
      ? new Date(session.lastEventAt).getTime()
      : now;

    const events: StoredEvent[] = eventRows.map((row) => ({
      eventId: row.eventId,
      eventType: row.eventType as StoredEvent['eventType'],
      eventTimestamp: row.eventTimestamp,
      receivedAt: row.receivedAt,
      payload: JSON.parse(row.payload) as PlayerEvent['payload'],
    }));

    return {
      sessionId: session.sessionId,
      userId: session.userId,
      activeEventId: session.sportingEventId,
      state: effectiveState,
      startedAt: session.startedAt,
      durationMs: endMs - new Date(session.startedAt).getTime(),
      events,
    };
  }

  // Marks sessions with no activity for > STALE_THRESHOLD_MS as ended.
  // Called periodically by the background cleanup job in index.ts.
  async cleanupStaleSessions(): Promise<number> {
    const threshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    const rows = await this.db.all<{ sessionId: string }>(
      `UPDATE sessions SET state = 'ended'
       WHERE state != 'ended' AND lastEventAt < ?
       RETURNING sessionId`,
      [threshold],
    );
    return rows.length;
  }

  // --- private helpers ---

  private nextState(current: string, eventType: string): SessionState {
    switch (eventType) {
      case 'end':          return 'ended';
      case 'pause':        return 'paused';
      case 'buffer_start': return 'buffering';
      case 'start':
      case 'resume':
      case 'buffer_end':   return 'watching';
      default:             return current as SessionState; // heartbeat, seek, quality_change preserve state
    }
  }

  /** Reset all state — used in tests. */
  async clear(): Promise<void> {
    await this.db.run('DELETE FROM events');
    await this.db.run('DELETE FROM sessions');
  }
}
