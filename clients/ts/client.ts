#!/usr/bin/env tsx
import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto'; // used for sessionId only

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

async function main() {
  const [, , userId, eventId, quality = '1080p'] = process.argv;
  if (!userId || !eventId) {
    console.error('Usage: tsx clients/ts/client.ts <userId> <eventId> [quality]');
    console.error('  eventId = the sporting event ID (e.g. event-2026-wrestling-finals)');
    console.error('  quality = optional, defaults to 1080p');
    process.exit(1);
  }

  const intervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS) || 10000;
  const intervalSec = intervalMs / 1000;

  const sessionId = randomUUID();
  let position = 0.0;
  let playing = true;
  let state = 'watching';
  let currentEventId = eventId;
  let currentQuality = quality;
  let eventSeq = 0; // increments per transmission; forms idempotency key as sessionId + evt-N

  const now = () => new Date().toISOString();

  async function sendEvent(type: string): Promise<void> {
    try {
      const res = await fetch(`${BASE}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          userId,
          eventType:      type,
          eventId:        `evt-${++eventSeq}`,
          eventTimestamp: now(),
          receivedAt:     now(),
          payload: {
            eventId:  currentEventId,
            position,
            quality:  currentQuality,
          },
        }),
      });
      if (res.status !== 202) {
        const body = await res.text();
        process.stderr.write(`[${now()}] ERROR sending '${type}': HTTP ${res.status} — ${body}\n`);
      }
    } catch (err) {
      process.stderr.write(`[${now()}] ERROR sending '${type}': ${err}\n`);
    }
  }

  // Start session
  console.log(`\n[${now()}] Starting session '${sessionId}' | user: ${userId} | event: ${currentEventId} | quality: ${currentQuality}`);
  await sendEvent('start');
  console.log(`[${now()}] Session started. Heartbeat every ${intervalSec}s. Press Ctrl+C to drop connection.`);
  console.log('\n  Commands:');
  console.log('    resume              — start sending heartbeats');
  console.log('    seek <position>     — seek to position in seconds (e.g. seek 120.5) and start heartbeats');
  console.log('    pause               — send pause event and stop heartbeats');
  console.log('    event <eventId>     — switch to a different sporting event');
  console.log('    quality <quality>   — change quality (e.g. quality 720p)');
  console.log('    buffer              — send buffer_start event');
  console.log('    unbuffer            — send buffer_end event');
  console.log('    status              — show current position, quality, and playing state');
  console.log('    end                 — send end event and exit (clean close)');
  console.log('    Ctrl+C              — exit without end event (simulates dropped connection)');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.setPrompt('\n> ');
  rl.prompt();

  // Heartbeat — fires every intervalMs regardless of user input
  const heartbeatTimer = setInterval(async () => {
    if (playing) {
      position = parseFloat((position + intervalSec).toFixed(1));
      await sendEvent('heartbeat');
    }
  }, intervalMs);

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1];

    switch (cmd) {
      case 'resume':
        playing = true;
        state = 'watching';
        await sendEvent('resume');
        console.log(`[${now()}] Resumed at ${position}s — heartbeats firing every ${intervalSec}s`);
        break;

      case 'seek':
        if (!arg) {
          console.log('Usage: seek <position>');
        } else {
          position = parseFloat(arg);
          playing = true;
          state = 'watching';
          await sendEvent('seek');
          console.log(`[${now()}] Seeked to ${position}s — heartbeats firing every ${intervalSec}s`);
        }
        break;

      case 'pause':
        playing = false;
        state = 'paused';
        await sendEvent('pause');
        console.log(`[${now()}] Paused at ${position}s`);
        break;

      case 'event':
        if (!arg) {
          console.log('Usage: event <eventId>');
        } else {
          currentEventId = arg;
          await sendEvent('heartbeat');
          console.log(`[${now()}] Switched to event '${currentEventId}'`);
        }
        break;

      case 'quality':
        if (!arg) {
          console.log('Usage: quality <quality>');
        } else {
          currentQuality = arg;
          await sendEvent('quality_change');
          console.log(`[${now()}] Quality changed to ${currentQuality}`);
        }
        break;

      case 'buffer':
        state = 'buffering';
        await sendEvent('buffer_start');
        console.log(`[${now()}] Buffer started at ${position}s`);
        break;

      case 'unbuffer':
        state = 'watching';
        await sendEvent('buffer_end');
        console.log(`[${now()}] Buffer ended at ${position}s`);
        break;

      case 'status':
        console.log(`  session:  ${sessionId}`);
        console.log(`  event:    ${currentEventId}`);
        console.log(`  state:    ${state}`);
        console.log(`  position: ${position}s`);
        console.log(`  quality:  ${currentQuality}`);
        console.log(`  playing:  ${playing}`);
        break;

      case 'end':
        await sendEvent('end');
        console.log(`[${now()}] End event sent. Session '${sessionId}' closed.`);
        clearInterval(heartbeatTimer);
        rl.close();
        process.exit(0);
        break;

      case '':
        break;

      default:
        console.log(`Unknown command: '${cmd}'. Try: resume | seek <pos> | pause | event <id> | quality <q> | buffer | unbuffer | end | status`);
    }

    rl.prompt();
  });

  // Ctrl+C — drop without sending end event
  process.on('SIGINT', () => {
    clearInterval(heartbeatTimer);
    rl.close();
    console.log(`\n[${now()}] Dropped — no end event sent. Session '${sessionId}' will go stale in ~${intervalSec * 3}s.`);
    process.exit(0);
  });
}

main().catch(console.error);
