#!/bin/sh
# Start the hosted app. The database is kept on the persistent disk; only when it isn't there yet (a new disk) is the
# latest copy restored from backup storage. Then the server runs under Litestream, which copies every change out
# within about a second.
set -e
mkdir -p "$(dirname "$APP_DB_PATH")"
PORT="${PORT:-10000}"
if [ -n "$LITESTREAM_BUCKET" ]; then
  litestream restore -if-db-not-exists -if-replica-exists -config /etc/litestream.yml "$APP_DB_PATH"
fi
# One-time tidying (removes the graders' demo account once; never stops the site from starting).
python -m backend.cleanup || echo "WARNING: the start-up tidying didn't run."
if [ -n "$LITESTREAM_BUCKET" ]; then
  exec litestream replicate -config /etc/litestream.yml -exec "uvicorn backend.main:app --host 0.0.0.0 --port $PORT"
fi
echo "WARNING: LITESTREAM_BUCKET is not set, so the database will be lost when the server restarts."
exec uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
