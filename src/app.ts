import Fastify, { FastifyInstance } from 'fastify';
import { SessionStore } from './store';
import { PlayerEvent } from './types';

// JSON Schema for the incoming player event — Fastify validates this before
// the handler runs, so the handler can assume the shape is correct.
const playerEventSchema = {
  type: 'object',
  required: ['sessionId', 'eventType', 'payload'],
  additionalProperties: true, // SDK may send fields beyond what we define here
  properties: {
    sessionId:      { type: 'string' },
    userId:         { type: 'string' },
    eventType: {
      type: 'string',
      enum: ['start', 'heartbeat', 'pause', 'resume', 'seek', 'quality_change', 'buffer_start', 'buffer_end', 'end'],
    },
    eventId:        { type: 'string' },
    eventTimestamp: { type: 'string' },
    receivedAt:     { type: 'string' },
    payload: {
      type: 'object',
      required: ['eventId'],
      additionalProperties: true,
      properties: {
        eventId:  { type: 'string' },
        position: { type: 'number' },
        quality:  { type: 'string' },
      },
    },
  },
} as const;

export function createApp(store: SessionStore): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
  });

  // Allow requests from the client UI served on a different port
  app.addHook('onSend', (_req, reply, payload, done) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    done(null, payload);
  });
  app.options('*', async (_req, reply) => reply.code(204).send());

  app.get('/health', async () => ({ status: 'ok' }));

  // Ingest a player SDK event
  app.post<{ Body: PlayerEvent }>(
    '/events',
    { schema: { body: playerEventSchema } },
    async (req, reply) => {
      await store.processEvent(req.body);
      return reply.code(202).send({ ok: true });
    },
  );

  // Active viewer count — accepts one or comma-separated list of sporting event IDs
  app.get<{ Params: { eventId: string } }>(
    '/active-viewers/:eventId',
    async (req) => {
      const eventIds = req.params.eventId.split(',').map((id) => id.trim());
      const counts = await Promise.all(eventIds.map(async (id) => ({ eventId: id, viewerCount: await store.getActiveViewerCount(id) })));
      return { 'active-viewers': counts.filter((e) => e.viewerCount > 0) };
    },
  );

  // Full session details
  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    async (req, reply) => {
      const session = await store.getSession(req.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      return session;
    },
  );

  return app;
}
