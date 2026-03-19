#!/usr/bin/env bash

BASE="http://localhost:3000"

INTERVAL=$(( ${HEARTBEAT_INTERVAL_MS:-10000} / 1000 ))

# ── Args ─────────────────────────────────────────────────────────────────────
if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <userId> <eventId> [quality]"
  echo "  eventId = the sporting event ID (e.g. event-2026-wrestling-finals)"
  echo "  quality = optional, defaults to 1080p"
  exit 1
fi

SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
USER_ID="$1"
EVENT_ID="$2"
QUALITY="${3:-1080p}"
POSITION=0.0
PLAYING=true  # heartbeats fire immediately; stopped by pause, resumed by resume/seek
STATE="watching"
EVENT_SEQ=0  # increments per transmission; forms idempotency key as sessionId + evt-N

# ── Helpers ──────────────────────────────────────────────────────────────────
now() { date -u +"%Y-%m-%dT%H:%M:%S.000Z"; }

send_event() {
  local type="$1"
  local response http_code body
  EVENT_SEQ=$(( EVENT_SEQ + 1 ))
  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE/events" \
    -H "Content-Type: application/json" \
    -d '{
      "sessionId":      "'"$SESSION_ID"'",
      "userId":         "'"$USER_ID"'",
      "eventType":      "'"$type"'",
      "eventId":        "evt-'"$EVENT_SEQ"'",
      "eventTimestamp": "'"$(now)"'",
      "receivedAt":     "'"$(now)"'",
      "payload": {
        "eventId":  "'"$EVENT_ID"'",
        "position": '"$POSITION"',
        "quality":  "'"$QUALITY"'"
      }
    }')
  http_code=$(tail -n1 <<< "$response")
  body=$(sed '$d' <<< "$response")
  if [[ "$http_code" != "202" ]]; then
    echo "[$(now)] ERROR sending '$type': HTTP $http_code — $body" >&2
  fi
}

prompt() { printf "\n> "; }

# ── Cleanup on exit ───────────────────────────────────────────────────────────
# Ctrl+C exits without sending an end event — simulates a dropped connection.
# The session will be marked stale after 3 missed heartbeat intervals.
# Use the "end" command for a clean session close.
cleanup() {
  echo ""
  echo "[$(now)] Dropped — no end event sent. Session '$SESSION_ID' will go stale in ~$((INTERVAL * 3))s."
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── Start session ─────────────────────────────────────────────────────────────
echo ""
echo "[$(now)] Starting session '$SESSION_ID' | user: $USER_ID | event: $EVENT_ID | quality: $QUALITY"
send_event "start"
echo "[$(now)] Session started. Heartbeat every ${INTERVAL}s. Press Ctrl+C to drop connection."
echo ""
echo "  Commands:"
echo "    resume              — start sending heartbeats"
echo "    seek <position>     — seek to position in seconds (e.g. seek 120.5) and start heartbeats"
echo "    pause               — send pause event and stop heartbeats"
echo "    event <eventId>     — switch to a different sporting event (e.g. event event-2026-cheerleading)"
echo "    quality <quality>   — change quality (e.g. quality 720p)"
echo "    buffer              — send buffer_start event"
echo "    unbuffer            — send buffer_end event"
echo "    status              — show current position, quality, and playing state"
echo "    end                 — send end event and exit (clean close)"
echo "    Ctrl+C              — exit without end event (simulates dropped connection)"

# ── Main loop — read with timeout drives the heartbeat ───────────────────────
prompt
while true; do
  if read -t "$INTERVAL" -r line; then
    cmd=$(awk '{print $1}' <<< "$line")
    arg=$(awk '{print $2}' <<< "$line")

    case "$cmd" in
      resume)
        PLAYING=true
        STATE="watching"
        send_event "resume"
        echo "[$(now)] Resumed at ${POSITION}s — heartbeats firing every ${INTERVAL}s"
        ;;
      seek)
        if [[ -z "$arg" ]]; then
          echo "Usage: seek <position>"
        else
          POSITION="$arg"
          PLAYING=true
          STATE="watching"
          send_event "seek"
          echo "[$(now)] Seeked to ${POSITION}s — heartbeats firing every ${INTERVAL}s"
        fi
        ;;
      pause)
        PLAYING=false
        STATE="paused"
        send_event "pause"
        echo "[$(now)] Paused at ${POSITION}s"
        ;;
      event)
        if [[ -z "$arg" ]]; then
          echo "Usage: event <eventId>"
        else
          EVENT_ID="$arg"
          send_event "heartbeat"
          echo "[$(now)] Switched to event '$EVENT_ID'"
        fi
        ;;
      quality)
        if [[ -z "$arg" ]]; then
          echo "Usage: quality <quality>"
        else
          QUALITY="$arg"
          send_event "quality_change"
          echo "[$(now)] Quality changed to $QUALITY"
        fi
        ;;
      buffer)
        STATE="buffering"
        send_event "buffer_start"
        echo "[$(now)] Buffer started at ${POSITION}s"
        ;;
      unbuffer)
        STATE="watching"
        send_event "buffer_end"
        echo "[$(now)] Buffer ended at ${POSITION}s"
        ;;
      status)
        echo "  session:  $SESSION_ID"
        echo "  event:    $EVENT_ID"
        echo "  state:    $STATE"
        echo "  position: ${POSITION}s"
        echo "  quality:  $QUALITY"
        echo "  playing:  $PLAYING"
        ;;
      end)
        send_event "end"
        echo "[$(now)] End event sent. Session '$SESSION_ID' closed."
        exit 0
        ;;
      "")
        ;; # ignore empty input
      *)
        echo "Unknown command: '$cmd'. Try: resume | seek <pos> | pause | event <id> | quality <q> | buffer | unbuffer | end | status"
        ;;
    esac
    prompt
  else
    # read timed out — send heartbeat silently so it doesn't interrupt typing
    if [[ "$PLAYING" == true ]]; then
      POSITION=$(awk "BEGIN {printf \"%.1f\", $POSITION + $INTERVAL}")
      send_event "heartbeat"
    fi
  fi
done
