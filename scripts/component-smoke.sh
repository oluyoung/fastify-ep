#!/usr/bin/env bash
# Generates a project, adds a service, a schema and (with a database) a repository to a module with
# `generate service|schema|repository`, then checks it still typechecks, tests, builds and passes
# `doctor --strict`. With TEST_DATABASE_URL set (and the schema migrated) the repository tests must
# run, not skip.
# Usage: [FASTIFY_EP="node /path/to/dist/cli.js"] component-smoke.sh <database> <di> [dir]
set -euo pipefail

database="${1:?usage: component-smoke.sh <database> <di> [dir]}"
di="${2:?di}"
work="${3:-$(mktemp -d)}"
here="$(cd "$(dirname "$0")" && pwd)"
FASTIFY_EP="${FASTIFY_EP:-node $here/../dist/cli.js}"
fep() { $FASTIFY_EP "$@"; }
fail() { echo "component smoke failed: $1"; exit 1; }

mkdir -p "$work"
cd "$work"
echo "::group::Generate the project"
fep init demo-app --pm npm --preset standard --database "$database" --di "$di"
cd demo-app
fep generate module orders
fep g service notifications --module orders
fep g schema payments --module orders
if [ "$database" != none ]; then
  fep g resource users --crud
  model=User
  [ "$database" = drizzle ] && model=usersTable
  fep g repository audit --module orders --model "$model"
else
  if fep g repository audit --module orders --model User; then fail "a repository must be refused without a database"; fi
fi
echo "::endgroup::"

echo "::group::Doctor, install, typecheck, test, build"
fep doctor --strict
npm install
npm run typecheck
if [ -n "${TEST_DATABASE_URL:-}" ] && [ "$database" != none ]; then
  export DATABASE_URL="$TEST_DATABASE_URL"
  if [ "$database" = drizzle ]; then npx drizzle-kit push --force; else npx prisma db push; fi
  npx vitest run src/modules/orders/audit.repository.test.ts --reporter=json --outputFile=repository-test.json || true
  node -e "
    const r = JSON.parse(require('fs').readFileSync('repository-test.json', 'utf8'));
    if (r.numPassedTests < 2 || r.numPendingTests > 0 || r.numFailedTests > 0) {
      console.error('the repository test did not run against the database', r.numPassedTests, r.numPendingTests, r.numFailedTests);
      process.exit(1);
    }
  "
  rm repository-test.json
fi
npm run test
npm run build
echo "::endgroup::"
echo "component smoke test passed ($database, $di)"
