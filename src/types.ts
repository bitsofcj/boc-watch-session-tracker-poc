export type EventType =
  | 'start'
  | 'heartbeat'
  | 'pause'
  | 'resume'
  | 'seek'
  | 'quality_change'
  | 'buffer_start'
  | 'buffer_end'
  | 'end';

export type SessionState = 'watching' | 'paused' | 'buffering' | 'ended';

// Shape of events coming in from the player SDK
export interface PlayerEvent {
  sessionId: string;
  userId?: string;
  eventType: EventType;
  eventId?: string;
  eventTimestamp?: string;
  receivedAt?: string;
  payload: {
    eventId: string; // the sporting event (e.g. "event-2026-wrestling-finals")
    position?: number;
    quality?: string;
    [key: string]: unknown;
  };
}

export interface StoredEvent {
  eventId: string;
  eventType: EventType;
  eventTimestamp: string;
  receivedAt: string;
  payload: PlayerEvent['payload'];
}

// Shape returned by GET /sessions/:sessionId
export interface SessionDetails {
  sessionId: string;
  userId: string;
  activeEventId: string;
  state: SessionState;
  startedAt: string;
  durationMs: number;
  events: StoredEvent[];
}
