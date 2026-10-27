#!/usr/bin/env bash
# Smoke-tests a built generated project (run from the project root, after `build`).
# Usage: smoke.sh <none|drizzle|prisma>
set -u
database="${1:?usage: smoke.sh <none|drizzle|prisma>}"

echo "::group::Smoke test the built server (probes + graceful shutdown)"
test -z "$(find dist -name '*.test.js')" || { echo "test files leaked into dist/"; exit 1; }

PORT=3999 node dist/server.js > server.log 2>&1 &
pid=$!
fail() { echo "smoke test failed: $1"; cat "${2:-server.log}"; kill "$pid" 2>/dev/null; exit 1; }

for _ in $(seq 1 50); do
  curl -sf http://127.0.0.1:3999/health/live > /dev/null && break
  sleep 0.2
done

curl -sf http://127.0.0.1:3999/health/live  || fail "/health/live"
ready=$(curl -sf http://127.0.0.1:3999/health/ready) || fail "/health/ready"
curl -sf http://127.0.0.1:3999/orders       || fail "/orders (generated module)"

if [ "$database" != "none" ]; then
  echo "$ready" | grep -q '"database":"up"' || fail "database readiness check is not up: $ready"
fi

kill -TERM "$pid"
wait "$pid" || fail "server did not exit 0 on SIGTERM"
grep -q "shutdown signal received" server.log || fail "shutdown was not logged"
echo "::endgroup::"

if [ "$database" != "none" ]; then
  echo "::group::Smoke test with an unreachable database (not ready, still alive)"
  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:1/app PORT=3998 node dist/server.js > bad.log 2>&1 &
  pid=$!

  for _ in $(seq 1 50); do
    curl -sf http://127.0.0.1:3998/health/live > /dev/null && break
    sleep 0.2
  done

  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3998/health/live)" = "200" ] || fail "liveness must stay 200" bad.log
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3998/health/ready)" = "503" ] || fail "readiness must be 503" bad.log

  kill -TERM "$pid"
  wait "$pid" || fail "server did not exit 0 on SIGTERM" bad.log
  echo "::endgroup::"
fi
