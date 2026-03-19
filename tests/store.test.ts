import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../src/store';
import { createDb, Db } from '../src/db';
import { PlayerEvent } from '../src/types';

function makeEvent(overrides: Partial<PlayerEvent> & { sessionId: string; eventType: PlayerEvent['eventType'] }): PlayerEvent {
  return {
    sessionId: overrides.sessionId,
    eventType: overrides.eventType,
    eventTimestamp: overrides.eventTimestamp ?? new Date().toISOString(),
    payload: overrides.payload ?? { eventId: 'event-wrestling-finals' },
    ...overrides,
  };
}

describe('SessionStore', () => {
  let store: SessionStore;
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    store = new SessionStore(db);
  });

  afterEach(async () => {
    await db.close();
  });

  // --- session creation ---

  it('creates a session on the first event', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    expect(await store.getSession('s1')).toBeDefined();
  });

  it('creates a session even if the first event is not "start" (late join / missed event)', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'heartbeat' }));
    expect(await store.getSession('s1')).toBeDefined();
  });

  // --- state machine ---

  it('start → watching', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    expect((await store.getSession('s1'))!.state).toBe('watching');
  });

  it('pause → paused', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'pause' }));
    expect((await store.getSession('s1'))!.state).toBe('paused');
  });

  it('resume after pause → watching', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'pause' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'resume' }));
    expect((await store.getSession('s1'))!.state).toBe('watching');
  });

  it('buffer_start → buffering, buffer_end → watching', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'buffer_start' }));
    expect((await store.getSession('s1'))!.state).toBe('buffering');
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'buffer_end' }));
    expect((await store.getSession('s1'))!.state).toBe('watching');
  });

  it('end → ended', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'end' }));
    expect((await store.getSession('s1'))!.state).toBe('ended');
  });

  it('ignores events received after a session has ended', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'end' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'resume' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'heartbeat' }));
    expect((await store.getSession('s1'))!.state).toBe('ended');
    expect((await store.getSession('s1'))!.events).toHaveLength(2);
  });

  it('heartbeat / seek / quality_change do not change state', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'pause' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'heartbeat' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'seek' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'quality_change' }));
    expect((await store.getSession('s1'))!.state).toBe('paused');
  });

  // --- sporting event switch ---

  it('moves session to new sporting event index when payload.eventId changes', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start', payload: { eventId: 'event-A' } }));
    expect(await store.getActiveViewerCount('event-A')).toBe(1);
    expect(await store.getActiveViewerCount('event-B')).toBe(0);

    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'heartbeat', payload: { eventId: 'event-B' } }));
    expect(await store.getActiveViewerCount('event-A')).toBe(0);
    expect(await store.getActiveViewerCount('event-B')).toBe(1);
  });

  // --- active viewer count ---

  it('returns 0 for an unknown sporting event', async () => {
    expect(await store.getActiveViewerCount('unknown-event')).toBe(0);
  });

  it('counts active sessions for a sporting event', async () => {
    const payload = { eventId: 'event-finals' };
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start', payload }));
    await store.processEvent(makeEvent({ sessionId: 's2', eventType: 'start', payload }));
    expect(await store.getActiveViewerCount('event-finals')).toBe(2);
  });

  it('does not count ended sessions', async () => {
    const payload = { eventId: 'event-finals' };
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start', payload }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'end', payload }));
    expect(await store.getActiveViewerCount('event-finals')).toBe(0);
  });

  it('does not count sessions for a different sporting event', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start', payload: { eventId: 'event-A' } }));
    expect(await store.getActiveViewerCount('event-B')).toBe(0);
  });

  // --- stale session handling ---

  it('cleanupStaleSessions marks stale sessions as ended', async () => {
    const oldTimestamp = new Date(Date.now() - 120_000).toISOString();
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start', eventTimestamp: oldTimestamp }));
    expect((await store.getSession('s1'))!.state).toBe('ended');

    const cleaned = await store.cleanupStaleSessions();
    expect(cleaned).toBe(1);
    expect((await store.getSession('s1'))!.state).toBe('ended');
  });

  it('cleanupStaleSessions does not touch recently active sessions', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    const cleaned = await store.cleanupStaleSessions();
    expect(cleaned).toBe(0);
    expect((await store.getSession('s1'))!.state).toBe('watching');
  });

  it('stale sessions are excluded from active viewer count', async () => {
    const oldTimestamp = new Date(Date.now() - 120_000).toISOString();
    await store.processEvent(makeEvent({
      sessionId: 's1',
      eventType: 'start',
      eventTimestamp: oldTimestamp,
      payload: { eventId: 'event-finals' },
    }));
    expect(await store.getActiveViewerCount('event-finals')).toBe(0);
  });

  // --- session details ---

  it('returns undefined for an unknown session', async () => {
    expect(await store.getSession('nope')).toBeUndefined();
  });

  it('accumulates events in the session', async () => {
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'start' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'heartbeat' }));
    await store.processEvent(makeEvent({ sessionId: 's1', eventType: 'heartbeat' }));
    expect((await store.getSession('s1'))!.events).toHaveLength(3);
  });
});
