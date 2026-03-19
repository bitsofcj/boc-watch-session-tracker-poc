import { SessionStore } from './store';
import { createApp } from './app';
import { createDb, Db } from './db';
import { HEARTBEAT_INTERVAL_MS, STALE_THRESHOLD_MS } from './config';

const PORT = Number(process.env.PORT) || 3000;

let db: Db | undefined;
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

const shutdown = async () => {
  clearInterval(cleanupInterval);
  await db?.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const start = async () => {
  db = await createDb(process.env.DB_PATH ?? './db/sessions.db');
  const store = new SessionStore(db);
  const app = createApp(store);

  // Cleanup runs every heartbeat interval. Sessions with no activity for
  // > STALE_THRESHOLD_MS (interval × 3) are marked ended.
  cleanupInterval = setInterval(async () => {
    const count = await store.cleanupStaleSessions();
    if (count > 0) app.log.info({ cleaned: count }, 'Stale sessions removed');
  }, HEARTBEAT_INTERVAL_MS);

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(
      { port: PORT, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS, staleThresholdMs: STALE_THRESHOLD_MS },
      'Watch session tracker started',
    );
  } catch (err) {
    app.log.error(err);
    clearInterval(cleanupInterval);
    await db.close();
    process.exit(1);
  }
};

start();
