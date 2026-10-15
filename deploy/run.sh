#!/bin/sh
# Start the hosted app. With backup storage configured, first restore the latest copy of the database,
# then run the server under Litestream so every change is copied out within about a second.
set -e
mkdir -p "$(dirname "$APP_DB_PATH")"
PORT="${PORT:-10000}"
if [ -n "$LITESTREAM_BUCKET" ]; then
  litestream restore -if-db-not-exists -if-replica-exists -config /etc/litestream.yml "$APP_DB_PATH"
  exec litestream replicate -config /etc/litestream.yml -exec "uvicorn backend.main:app --host 0.0.0.0 --port $PORT"
fi
echo "WARNING: LITESTREAM_BUCKET is not set, so the database will be lost when the server restarts."
exec uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
