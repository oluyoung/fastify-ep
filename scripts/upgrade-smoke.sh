#!/usr/bin/env bash
# Upgrades a project that a real earlier release generated, with the CLI built from the working tree.
# Usage: [FASTIFY_EP="node /path/to/dist/cli.js"] upgrade-smoke.sh <tag> <preset> <database> <di> [dir]
# Needs the tag in git history, network, Node 22 and a built dist/ (or FASTIFY_EP). The upgraded
# project must equal what the current CLI generates, pass `doctor --strict`, and install, typecheck,
# test and build. A tag at the CLI's own version has nothing to migrate, so the equality check is skipped.
set -euo pipefail

tag="${1:?usage: upgrade-smoke.sh <tag> <preset> <database> <di> [dir]}"
preset="${2:?preset}"
database="${3:?database}"
di="${4:?di}"
work="${5:-$(mktemp -d)}"
here="$(cd "$(dirname "$0")" && pwd)"
FASTIFY_EP="${FASTIFY_EP:-node $here/../dist/cli.js}"

fep() { $FASTIFY_EP "$@"; }
group() { echo "::group::$*"; }
endgroup() { echo "::endgroup::"; }
fail() { echo "upgrade smoke failed: $1"; exit 1; }
tree_hash() { (cd "$1" && find . -type f -not -path './node_modules/*' -not -path './dist/*' | sort | xargs sha256sum | sha256sum); }

group "Generate a $tag project ($preset, $database, $di) with that release's CLI"
node "$here/build-upgrade-fixture.mjs" "$tag" "$work/old" "$preset" "$database" "$di"
cd "$work/old/demo-app"
old_version=$(node -p "require('./.fastify-ep.json').fastifyEpVersion")
[ "v$old_version" = "$tag" ] || fail "the fixture says it was made by $old_version, expected $tag"
endgroup

cli_version=$(fep --version)

group "Dry run changes nothing, and reports the same exit code as a real run"
before=$(tree_hash .)
fep upgrade --dry-run
[ "$(tree_hash .)" = "$before" ] || fail "upgrade --dry-run modified the project"
fep upgrade --dry-run --json | node -e "
  const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (r.format !== 1 || r.dryRun !== true) { console.error('bad dry-run report', r); process.exit(1); }
"
endgroup

group "Upgrade, then upgrade again"
fep upgrade
fep upgrade | grep -q 'up to date' || fail "a second upgrade should be a no-op"
endgroup

if [ "$old_version" != "$cli_version" ]; then
  group "The upgraded project equals what the current CLI generates"
  mkdir -p "$work/fresh"
  (cd "$work/fresh" && fep init demo-app --pm npm --preset "$preset" --database "$database" --di "$di")
  (cd "$work/fresh/demo-app" && fep generate module orders && fep g resource users --crud)
  # Before 0.9.0 there is no manifest conversion, so a schema 2 manifest legitimately stays as it is.
  manifest_args=()
  [ "$(printf '%s\n0.9.0\n' "$cli_version" | sort -V | head -1)" = 0.9.0 ] || manifest_args=(-x .fastify-ep.json)
  # `upgrade` migrates project-level files, never the resources you generated, so a resource's
  # repository test (added in 0.10) is expected to exist only in the freshly generated project.
  diff -r -x node_modules -x dist -x package-lock.json -x package.json -x users.repository.test.ts "${manifest_args[@]}" "$work/fresh/demo-app" . \
    || fail "the upgraded project differs from a freshly generated one"
  # package.json is patched by key, and its own "version" field is the project's, so compare the rest.
  node -e "
    const read = (dir) => {
      const pkg = JSON.parse(require('fs').readFileSync(dir + '/package.json', 'utf8'));
      delete pkg.version;
      return JSON.stringify(pkg, null, 2);
    };
    if (read('$work/fresh/demo-app') !== read('.')) {
      console.error('package.json differs from a freshly generated one');
      process.exit(1);
    }
  "
  endgroup
fi

group "Doctor"
fep doctor --strict
fep doctor --strict --json | node -e "
  const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (r.format !== 1 || r.ok !== true) { console.error('doctor --json not ok', r.summary); process.exit(1); }
"
endgroup

group "Install, typecheck, test, build"
npm install
npm run typecheck
npm run test
npm run build
endgroup

echo "upgrade smoke test passed for $tag ($preset, $database, $di)"
