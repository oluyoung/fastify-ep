#!/usr/bin/env bash
# Generates projects with the built CLI, swaps in another TypeScript major, and checks that they still
# typecheck, test and build. Generated projects default to TypeScript 6; CI runs this for the previous
# major (5, which existing projects still use) and the next (7).
# Usage: [FASTIFY_EP="node /path/to/dist/cli.js"] typescript-compat.sh <typescript-major> [dir]
set -euo pipefail

major="${1:?usage: typescript-compat.sh <typescript-major> [dir]}"
work="${2:-$(mktemp -d)}"
here="$(cd "$(dirname "$0")" && pwd)"
FASTIFY_EP="${FASTIFY_EP:-node $here/../dist/cli.js}"
fep() { $FASTIFY_EP "$@"; }

# preset database di
shapes=("standard drizzle native" "production prisma awilix" "minimal none native")
mkdir -p "$work"
cd "$work"

for shape in "${shapes[@]}"; do
  read -r preset database di <<<"$shape"
  name="app-$preset-$database-$di"
  echo "::group::$name with TypeScript $major"
  fep init "$name" --pm npm --preset "$preset" --database "$database" --di "$di"
  cd "$name"
  fep generate module orders
  if [ "$database" != none ]; then fep g resource users --crud; fi
  npm install
  npm install --no-save "typescript@$major"
  installed=$(npx tsc -v)
  echo "$installed"
  case "$installed" in "Version $major."*) ;; *) echo "expected TypeScript $major, got $installed"; exit 1 ;; esac
  npm run typecheck
  npm run test
  npm run build
  cd ..
  echo "::endgroup::"
done
echo "typescript $major compatibility passed"
