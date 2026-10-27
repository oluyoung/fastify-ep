#!/usr/bin/env bash
# Exercises fastify-ep inside a workspace: two services and one library, one install at the root.
# Usage: [FASTIFY_EP="node /path/to/dist/cli.js"] [SKIP_DOCKER=1] workspace-smoke.sh <npm|pnpm|yarn> [dir]
# Builds the workspace in [dir] (default: a temp dir), so run it from anywhere. Needs Node 22 and
# corepack; Docker for the image build unless SKIP_DOCKER=1. Yarn runs as Berry 4 (node-modules linker).
set -euo pipefail

pm="${1:?usage: workspace-smoke.sh <npm|pnpm|yarn> [dir]}"
root="${2:-$(mktemp -d)}"
smoke="$(cd "$(dirname "$0")" && pwd)/smoke.sh"
FASTIFY_EP="${FASTIFY_EP:-fastify-ep}"
container=""

fep() { $FASTIFY_EP "$@"; }
group() { echo "::group::$*"; }
endgroup() { echo "::endgroup::"; }
fail() { echo "workspace smoke failed: $1"; exit 1; }
cleanup() { [ -z "$container" ] || docker stop "$container" > /dev/null 2>&1 || true; }
trap cleanup EXIT

# Yarn goes through corepack so the root's packageManager field picks Berry over any global classic.
pmx() {
  if [ "$pm" = yarn ]; then corepack yarn "$@"; else "$pm" "$@"; fi
}

# Runs package script $2 in the workspace package named $1.
in_package() {
  case "$pm" in
    pnpm) pnpm --filter "$1" run "$2" ;;
    npm) npm run "$2" -w "$1" ;;
    yarn) corepack yarn workspace "$1" run "$2" ;;
  esac
}

dep_spec='*'
[ "$pm" = npm ] || dep_spec='workspace:*'

group "Create the $pm workspace in $root"
mkdir -p "$root"
cd "$root"
printf 'node_modules\ndist\n' > .gitignore
case "$pm" in
  pnpm)
    printf 'packages:\n  - apps/*\n  - packages/*\nallowBuilds:\n  esbuild: false\n' > pnpm-workspace.yaml
    echo '{"name":"@acme/repo","private":true}' > package.json
    ;;
  npm)
    echo '{"name":"@acme/repo","private":true,"workspaces":["apps/*","packages/*"]}' > package.json
    ;;
  yarn)
    echo '{"name":"@acme/repo","private":true,"workspaces":["apps/*","packages/*"],"packageManager":"yarn@4.9.2"}' > package.json
    printf 'nodeLinker: node-modules\n' > .yarnrc.yml
    ;;
  *) fail "unknown package manager: $pm" ;;
esac
endgroup

group "init two services (the workspace's package manager is inherited, no --pm)"
fep init apps/users-api --name @acme/users-api --preset production --database none --di native
fep init apps/billing-api --name @acme/billing-api --preset standard --database none --di native
[ ! -e apps/users-api/pnpm-workspace.yaml ] || fail "init wrote a nested pnpm-workspace.yaml"
[ -f apps/users-api/Dockerfile ] || fail "Production in a workspace must generate a Dockerfile"
[ -f apps/users-api/Dockerfile.dockerignore ] || fail "the workspace Dockerfile needs Dockerfile.dockerignore"
grep -q 'docker build -f apps/users-api/Dockerfile' apps/users-api/Dockerfile || fail "the Dockerfile must name its own path"
endgroup

group "generate a library from a service subfolder"
(cd apps/users-api/src && fep generate library contracts)
[ -f packages/contracts/.fastify-ep-library.json ] || fail "library marker missing"
grep -q '"name": "@acme/contracts"' packages/contracts/package.json || fail "library should take the workspace scope"
node -e "
  const fs = require('fs');
  const f = 'apps/users-api/package.json';
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  p.dependencies['@acme/contracts'] = '$dep_spec';
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
"
python3 - << 'PY'
path = 'apps/users-api/src/app.ts'
s = open(path).read()
s = "import { ContractsSchema } from '@acme/contracts';\n" + s
s = s.replace(
    "  // fastify-ep:register",
    "  fastify.get('/contract', async () => ({ keys: Object.keys(ContractsSchema.properties) }));\n\n  // fastify-ep:register",
    1,
)
open(path, 'w').write(s)
PY
endgroup

group "generate a module in each service, from different places"
(cd apps/users-api/src && fep generate module orders)
fep generate module orders --project apps/billing-api
if out=$(fep generate module orders 2>&1); then fail "generate from the workspace root must not guess a service"; fi
echo "$out" | grep -q 'apps/users-api' || fail "the root error should list the services: $out"
echo "$out" | grep -q -- '--project' || fail "the root error should suggest --project: $out"
fep doctor -C apps/users-api
(cd apps/billing-api/src && fep doctor)
endgroup

group "install once at the root"
pmx install
endgroup

group "build and test the library, then both services"
in_package @acme/contracts build
in_package @acme/contracts typecheck
in_package @acme/contracts test
for service in @acme/users-api @acme/billing-api; do
  in_package "$service" typecheck
  in_package "$service" test
  in_package "$service" build
done
endgroup

group "smoke test each built service"
(cd apps/users-api && PRESET=production "$smoke" none)
(cd apps/billing-api && "$smoke" none)
endgroup

if [ "${SKIP_DOCKER:-}" != 1 ]; then
  group "Docker image from the workspace root"
  docker build -f apps/users-api/Dockerfile -t workspace-smoke-users-api .
  container=$(docker run -d --rm -p 3417:3000 -e HOST=0.0.0.0 workspace-smoke-users-api)
  for _ in $(seq 1 60); do
    curl -sf http://127.0.0.1:3417/health/live > /dev/null && break
    sleep 0.5
  done
  curl -sf http://127.0.0.1:3417/health/live > /dev/null || { docker logs "$container"; fail "the image did not become healthy"; }
  body=$(curl -s http://127.0.0.1:3417/contract)
  echo "$body" | grep -q '"keys":\["id","name"\]' || { docker logs "$container"; fail "the image could not use the library (got: $body)"; }
  [ "$(docker exec "$container" id -un)" = node ] || fail "the image must not run as root"
  docker stop "$container" > /dev/null
  container=""
  docker rmi workspace-smoke-users-api > /dev/null
  endgroup
fi

echo "workspace smoke test passed for $pm"
