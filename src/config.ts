// How often the player SDK sends heartbeats. Drives the stale-session threshold.
// Override via HEARTBEAT_INTERVAL_MS env var to match your SDK's actual interval.
export const HEARTBEAT_INTERVAL_MS =
  Number(process.env.HEARTBEAT_INTERVAL_MS) || 10000;

// A session is stale after 3 missed heartbeat intervals with no activity.
export const STALE_THRESHOLD_MS = HEARTBEAT_INTERVAL_MS * 3;
