import { DuckDBInstance, DuckDBValue } from '@duckdb/node-api';

export interface Db {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
    sessionId       VARCHAR PRIMARY KEY,
    userId          VARCHAR NOT NULL,
    sportingEventId VARCHAR NOT NULL,
    state           VARCHAR NOT NULL,
    startedAt       VARCHAR NOT NULL,
    lastEventAt     VARCHAR NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    eventId        VARCHAR NOT NULL,
    sessionId      VARCHAR NOT NULL,
    eventType      VARCHAR NOT NULL,
    eventTimestamp VARCHAR NOT NULL,
    receivedAt     VARCHAR NOT NULL,
    payload        VARCHAR NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_session ON events(sessionId)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(sportingEventId)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_lastEventAt ON sessions(lastEventAt)`,
];

export async function createDb(path: string): Promise<Db> {
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();

  const run = (sql: string, params: unknown[] = []): Promise<void> =>
    conn.run(sql, params as DuckDBValue[]).then(() => undefined);

  const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const reader = await conn.runAndReadAll(sql, params as DuckDBValue[]);
    return reader.getRowObjectsJS() as T[];
  };

  for (const stmt of SCHEMA) {
    await run(stmt);
  }

  return {
    run,
    all,
    close: async () => {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
