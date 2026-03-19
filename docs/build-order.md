# Build Order

Due to time constraints I did not commit incrementally as I went. The project was built as a focused session rather than a series of discrete commits. This documents the general order things were built so the progression is clear.

---

1. **Project scaffolding** — `package.json`, `tsconfig.json`, `.gitignore`, directory structure. Chose Fastify over Express and Vitest over Jest up front based on the workload profile (high-volume ingestion, TypeScript-native).

2. **Types** — `src/types.ts` defining `PlayerEvent`, `StoredEvent`, `SessionState`, and `SessionDetails`. Getting the shape of incoming and outgoing data right before writing any logic.

3. **Session store** — `src/store.ts` with in-memory state, the session state machine, `processEvent`, `getActiveViewerCount`, `getSession`, and `cleanupStaleSessions`. This is the core of the service and was the first thing built after types.

4. **HTTP layer** — `src/app.ts` wiring Fastify routes to the store: `POST /events`, `GET /active-viewers/:eventId`, `GET /sessions/:sessionId`, `GET /health`. JSON Schema validation on the ingestion endpoint.

5. **Config and entrypoint** — `src/config.ts` for `HEARTBEAT_INTERVAL_MS` and `STALE_THRESHOLD_MS`, `src/index.ts` for server startup, the background cleanup interval, and graceful shutdown on `SIGTERM`/`SIGINT`.

6. **Tests** — `tests/store.test.ts` for business logic and `tests/api.test.ts` for the HTTP layer. Written against the in-memory store first, then updated when DuckDB was introduced.

7. **Shell client** — `clients/shell/client.sh` for manual testing and demos. Start event, heartbeat loop driven by `read -t`, interactive commands, Ctrl+C drop simulation.

8. **DuckDB migration** — replaced the in-memory `Map` with `src/db.ts` and a file-backed DuckDB store. Rewrote `store.ts` to be fully async against the `Db` interface. Switched from the `duckdb` package to `@duckdb/node-api` to eliminate build-toolchain vulnerabilities. All store methods updated, tests updated to use `:memory:` DuckDB.

9. **TypeScript client** — `clients/ts/client.ts` mirroring the shell client, using `node:readline` and `setInterval` for the heartbeat loop instead of `read -t`.

10. **Documentation** — `README.md` written to cover assumptions, trade-offs, tools used, and the production path. Supporting docs written in `docs/`: API spec, session state machine, storage layer decisions, idempotency plan, ClickHouse + Redis scaling plan, and cost analysis.
