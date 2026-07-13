#!/bin/sh
# Container entrypoint: apply DB migrations, then start the server.
#
# docker-compose already gates this container on postgres' healthcheck, but a
# short retry loop keeps `docker start` / standalone runs (no compose ordering)
# from flapping while the DB finishes coming up.
set -eu

PRISMA_CLI="node_modules/prisma/build/index.js"

echo "[entrypoint] applying database migrations (prisma migrate deploy)..."
attempt=1
max_attempts=5
until node "$PRISMA_CLI" migrate deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[entrypoint] migrate deploy failed after ${max_attempts} attempts, giving up." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "[entrypoint] migrate deploy failed — retrying in 3s (attempt ${attempt}/${max_attempts})..."
  sleep 3
done

echo "[entrypoint] starting server..."
# exec: node replaces this shell as PID 1, so SIGTERM from `docker stop`
# reaches server.ts's graceful-shutdown handler directly.
exec node dist/server.js
