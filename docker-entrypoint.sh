#!/bin/sh
set -e

echo "Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "Seeding database (no-op if already seeded)..."
node dist-seed/seed.js

echo "Starting application..."
exec node server.js
