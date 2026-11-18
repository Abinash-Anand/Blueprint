#!/bin/sh
# Apply pending migrations (never resets data), seed idempotently, then start the API.
set -e
npx prisma migrate deploy
node dist/prisma/seed.js
exec node dist/src/server.js
