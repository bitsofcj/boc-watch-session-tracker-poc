import { describe, it, expect, afterEach } from 'vitest';
import { SessionStore } from '../src/store';
import { createApp } from '../src/app';
import { createDb, Db } from '../src/db';
import { FastifyInstance } from 'fastify';

let currentDb: Db;

async function setup(): Promise<{ store: SessionStore; app: FastifyInstance }> {
  currentDb = await createDb(':memory:');
  const store = new SessionStore(currentDb);
  const app = createApp(store);
  return { store, app };
}

afterEach(async () => {
  await currentDb?.close();
});

const baseEvent = {
  sessionId: 'session-abc',
  userId: 'user-123',
  eventType: 'start',
  eventId: 'evt-001',
  payload: {
    eventId: 'event-wrestling-finals',
    position: 0,
    quality: '1080p',
  },
};

describe('POST /events — exact PRD shape', () => {
  it('accepts the full event structure from the PRD', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: {
        sessionId: 'abc-123',
        userId: 'user-456',
        eventType: 'heartbeat',
        eventId: 'evt-789',
        eventTimestamp: '2026-02-10T19:32:15.123Z',
        receivedAt: '2026-02-10T19:32:15.450Z',
        payload: {
          eventId: 'event-2026-wrestling-finals',
          position: 1832.5,
          quality: '1080p',
        },
      },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe('POST /events', () => {
  it('returns 400 when sessionId is missing', async () => {
    const { app } = await setup();
    const { sessionId: _, ...noSession } = baseEvent;
    const res = await app.inject({ method: 'POST', url: '/events', payload: noSession });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when eventType is not a recognised value', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { ...baseEvent, eventType: 'unknown_type' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when payload.eventId is missing', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { ...baseEvent, payload: { position: 0 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates a session that can be queried afterwards', async () => {
    const { app } = await setup();
    await app.inject({ method: 'POST', url: '/events', payload: baseEvent });
    const res = await app.inject({ method: 'GET', url: `/sessions/${baseEvent.sessionId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe(baseEvent.sessionId);
  });
});

describe('GET /active-viewers/:eventId', () => {
  it('returns 0 when no sessions exist for the event', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/active-viewers/no-such-event' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ 'active-viewers': [] });
  });

  it('returns the count of active sessions', async () => {
    const { app } = await setup();
    await app.inject({ method: 'POST', url: '/events', payload: { ...baseEvent, sessionId: 's1' } });
    await app.inject({ method: 'POST', url: '/events', payload: { ...baseEvent, sessionId: 's2' } });
    const res = await app.inject({
      method: 'GET',
      url: `/active-viewers/${baseEvent.payload.eventId}`,
    });
    expect(res.json()['active-viewers'][0].viewerCount).toBe(2);
  });

  it('does not count sessions that have ended', async () => {
    const { app } = await setup();
    await app.inject({ method: 'POST', url: '/events', payload: baseEvent });
    await app.inject({ method: 'POST', url: '/events', payload: { ...baseEvent, eventType: 'end' } });
    const res = await app.inject({
      method: 'GET',
      url: `/active-viewers/${baseEvent.payload.eventId}`,
    });
    expect(res.json()).toEqual({ 'active-viewers': [] });
  });

  it('returns counts for multiple comma-separated event IDs', async () => {
    const { app } = await setup();
    await app.inject({ method: 'POST', url: '/events', payload: { ...baseEvent, sessionId: 's1', payload: { eventId: 'event-A' } } });
    await app.inject({ method: 'POST', url: '/events', payload: { ...baseEvent, sessionId: 's2', payload: { eventId: 'event-B' } } });
    await app.inject({ method: 'POST', url: '/events', payload: { ...baseEvent, sessionId: 's3', payload: { eventId: 'event-B' } } });
    const res = await app.inject({ method: 'GET', url: '/active-viewers/event-A,event-B' });
    expect(res.statusCode).toBe(200);
    const viewers: { eventId: string; viewerCount: number }[] = res.json()['active-viewers'];
    expect(viewers).toHaveLength(2);
    expect(viewers.find((e) => e.eventId === 'event-A')?.viewerCount).toBe(1);
    expect(viewers.find((e) => e.eventId === 'event-B')?.viewerCount).toBe(2);
  });
});

describe('GET /sessions/:sessionId', () => {
  it('returns 404 for an unknown session', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/sessions/ghost-session' });
    expect(res.statusCode).toBe(404);
  });

  it('returns session details with expected fields', async () => {
    const { app } = await setup();
    await app.inject({ method: 'POST', url: '/events', payload: baseEvent });
    const res = await app.inject({ method: 'GET', url: `/sessions/${baseEvent.sessionId}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe(baseEvent.sessionId);
    expect(body.userId).toBe(baseEvent.userId);
    expect(body.activeEventId).toBe(baseEvent.payload.eventId);
    expect(body.state).toBe('watching');
    expect(typeof body.durationMs).toBe('number');
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(1);
  });

});
