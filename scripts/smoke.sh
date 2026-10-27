#!/usr/bin/env bash
# Smoke-tests a built generated project (run from the project root, after `build`).
# Usage: smoke.sh <none|drizzle|prisma> [crud-resource]
# With a resource name (generated with `--crud`), also exercises its five routes. Database projects
# need that resource's schema applied to the database first.
set -u
database="${1:?usage: smoke.sh <none|drizzle|prisma> [crud-resource]}"
resource="${2:-}"

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

if [ -n "$resource" ]; then
  base="http://127.0.0.1:3999/$resource"
  json='content-type: application/json'
  code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

  [ "$(code -X POST "$base" -H "$json" -d '{}')" = "400" ] || fail "POST /$resource with an empty body must be 400"
  created=$(curl -sf -X POST "$base" -H "$json" -d '{"name":"smoke"}') || fail "POST /$resource"
  id=$(echo "$created" | sed -E 's/.*"id":"([^"]+)".*/\1/')
  [ -n "$id" ] && [ "$id" != "$created" ] || fail "POST /$resource did not return an id: $created"
  curl -sf "$base" | grep -q "$id"                || fail "GET /$resource does not list the created item"
  curl -sf "$base/$id" | grep -q '"name":"smoke"' || fail "GET /$resource/:id"
  curl -sf -X PATCH "$base/$id" -H "$json" -d '{"name":"renamed"}' | grep -q '"name":"renamed"' || fail "PATCH /$resource/:id"
  [ "$(code -X DELETE "$base/$id")" = "204" ]     || fail "DELETE /$resource/:id must be 204"
  [ "$(code "$base/$id")" = "404" ]               || fail "GET /$resource/:id after delete must be 404"
fi

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
