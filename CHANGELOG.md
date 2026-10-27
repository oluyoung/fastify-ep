# Changelog

All notable changes to `fastify-ep` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Until 1.0, minor
versions may include breaking changes to generated output.

## [0.7.0] — Workspace Support

Projects can live inside a pnpm, npm or Yarn workspace. Outside a workspace nothing changes: the
output of `init` and every generator is identical to 0.6.1.

### Added

- `init` accepts a directory path (`init apps/payments-api`). The package is named after the last
  path segment, or after the new `--name <package-name>` option, which may be scoped
  (`@acme/payments-api`). The target must still be inside the current directory and empty.
- `init` inside a workspace uses the workspace's package manager and skips the package-manager
  prompt. A conflicting `--pm` is an error that names the workspace's manager. Detection reads
  `pnpm-workspace.yaml` (with `packages:`) or a root `package.json` `workspaces` field, and mentions
  Turborepo and Nx when `turbo.json` or `nx.json` is present.
- `init` writes only inside the new directory. In a pnpm workspace it no longer writes a nested
  `pnpm-workspace.yaml`; it prints the `allowBuilds` entries to merge into the root file instead.
  When the new directory is not matched by the workspace's package globs, it prints the glob to add
  (to `pnpm-workspace.yaml` `packages:`, or to `workspaces` in the root `package.json`).
- Next steps inside a workspace: one install at the root and the workspace dev command
  (`pnpm --filter <name> dev`, `npm run dev -w <name>`, `yarn workspace <name> dev`).
- Production inside a workspace generates a workspace Dockerfile (`Dockerfile` and
  `Dockerfile.dockerignore` in the service) for npm, pnpm and Yarn Berry. The build context is the
  workspace root: `docker build -f apps/payments-api/Dockerfile -t payments-api .`. Local libraries
  are built before the service. Yarn classic, or Yarn Berry without `nodeLinker: node-modules`,
  gets no Dockerfile and a note saying why.
- `generate module`, `generate resource` and `doctor` work from anywhere inside a service in a
  workspace: they walk up from the current directory to the nearest `.fastify-ep.json`, stopping at
  the workspace root. From the workspace root the error lists the services found and suggests
  `--project`. The new `-C, --project <dir>` option runs a command against a given project.
  Outside a workspace the current directory is used as before.
- `generate library <name>`: inside a workspace, adds a shared library package (`package.json`
  with `exports` and `files` pointing at `dist`, `tsconfig.json`, an example TypeBox schema, a
  Vitest test and a `.fastify-ep-library.json` marker). It goes under the workspace's
  `packages/*` or `libs/*` glob, else `packages/<name>` (`--dir` overrides), is scoped like the
  workspace's other packages (`--name` overrides), and prints the dependency line to add to a
  service. It writes only the new directory and fails outside a workspace.
- CI builds a workspace with two services and a library for npm, pnpm and Yarn Berry, then builds
  and runs the Production image (`scripts/workspace-smoke.sh`).

### Changed

- `init` rejects `.` (the current directory) with a clear message; it was already rejected as an
  invalid package name. Error messages for an invalid package name now say how to fix it.

## [0.6.1] — Fixes

### Fixed

- Production: a rate-limited request now returns 429 with the project's error shape
  (`{ error: { code: 'RATE_LIMITED', message, requestId } }`). Before, routes handled by the
  project's error handler answered 500.

### Changed

- Generated projects use `vitest ^4.1.0` (was `^2.0.5`), which clears the dev-only `npm audit`
  advisories in the test tooling. Generated projects start at version `0.1.0` (was `0.2.0`).

## [0.6.0] — Production Presets

### Added

- `init --preset minimal|standard|production` and a `Preset?` prompt. `standard` is the default
  and generates exactly what 0.5.0 did. `minimal` drops Swagger / OpenAPI. `production` adds
  `@fastify/helmet`, `@fastify/cors` (no origin allowed until `CORS_ORIGIN` is set),
  `@fastify/rate-limit` (`RATE_LIMIT_MAX`, default 100 per minute, `/health*` exempt) and a
  `Dockerfile` and `.dockerignore` for the chosen package manager only.
- The manifest records `architecture.preset` for `minimal` and `production`; it is omitted for
  `standard`. No schema bump, and older manifests stay valid.
- `examples/minimal-api` and `examples/production-api`; `scripts/smoke.sh` checks each preset
  (`PRESET=...`); CI builds the Production Docker image for npm, pnpm and yarn.

## [0.5.0] — Generation Expansion

### Added

- `fastify-ep g` as shorthand for `fastify-ep generate`.
- `generate resource <name>`: a module plus a repository (`<name>.repository.ts`), with
  `--no-test`, `--scope` and `--singular <name>` (entity name when it is not the resource name
  minus a trailing `s`).
- `generate resource <name> --crud`: `POST /<name>`, `GET /<name>`, `GET /<name>/:id`,
  `PATCH /<name>/:id` and `DELETE /<name>/:id`, backed by the project's database. `none` uses an
  in-memory repository; Drizzle and Prisma use the ORM. For those, the generator also adds the
  table (exported from `src/infrastructure/database/schema.ts`) or appends a model to
  `prisma/schema.prisma`, and prints the migration commands to run. Works with native and Awilix
  projects.
- Name validation for `generate module` and `generate resource`: lowercase kebab-case, at most 64
  characters.
- `examples/*` each include a `users` resource generated with `g resource users --crud`, and
  `scripts/smoke.sh` takes an optional resource name to exercise its CRUD routes in CI.

### Changed

- `generate module` rejects names that are not lowercase kebab-case instead of writing them
  (previously `generate module ../x` was accepted).
- Generation now restores `app.ts` as well as removing the new directory when a later step
  fails.

### Not included

- `generate service|schema|repository` (ROADMAP 15.4) are deferred.

## [0.4.0] — Dependency Management

### Added

- `init --di native|awilix` (and an interactive prompt). `awilix` scaffolds a `@fastify/awilix`
  container plugin (`src/infrastructure/di/`) with PROXY injection, typed through the `Cradle`
  interface; with a database, the client is injectable as `db`.
- `generate module` honours the project's DI strategy. In Awilix projects `--scope request`
  registers the service per request; the default is a singleton.
- `doctor` checks Awilix projects: dependencies declared and the container plugin present and
  registered after the database plugin.
- `examples/awilix-api`.

## [0.3.0] — Database Integration

### Added

- `examples/drizzle-api` and `examples/prisma-api`: real `init --database` output plus a generated
  `orders` module, regenerated with `npm run examples`. CI fails if they drift from the CLI and runs
  install, typecheck, test, build and the readiness smoke test on each against Postgres.
- **Database strategies**: `fastify-ep init --database none|drizzle|prisma` (or the
  interactive "Database?" prompt). PostgreSQL only. `none` stays the default.
- Database projects get `src/infrastructure/database/` with a Fastify plugin that
  decorates `fastify.db` (typed), contributes a `database` check to `/health/ready`,
  and closes its connection on shutdown. They also get a required `DATABASE_URL`,
  `.env.example`, a `docker-compose.yml` with Postgres, and `db:generate` /
  `db:migrate` scripts.
- **Drizzle**: `drizzle-orm` + `postgres`, `drizzle.config.ts`, an empty
  `schema.ts` to start from.
- **Prisma 7**: `@prisma/client` with the `pg` driver adapter, `prisma/schema.prisma`,
  `prisma.config.ts`, `prisma generate` on install, and `engines.node >=22.12`.
- `fastify-ep doctor` checks database projects: ORM dependencies, ORM config files,
  the database plugin file and registration, `DATABASE_URL` in the env schema, and
  (Prisma) a supported Node version.
- `// fastify-ep:infrastructure` marker in `src/app.ts`, where infrastructure
  plugins are registered after environment config and before modules.
- CI now runs the generated-project lifecycle for every package manager against
  every database strategy, with a real Postgres service, including a check that an
  unreachable database makes `/health/ready` return 503 while `/health/live` stays 200.

### Changed

- **Node 22 is now the minimum** (was 20): for the CLI (`engines`), `doctor`, CI and the
  generated project (`engines.node >=22`). Node 20 is end of life, the template's
  `@fastify/swagger-ui` dependency tree now requires Node 22, and pnpm 11 does not
  run on Node 20.
- Manifest `architecture.database` accepts `none`, `drizzle` or `prisma`
  (still `schemaVersion: 2`).
- The readiness tests moved from `health.test.ts` to `health.ready.test.ts`.
- `generate module` makes the project's database strategy available to module
  templates as `{{database}}` (the built-in module template does not use it yet).

### Fixed

- Projects created with `--pm pnpm` now install on pnpm 11, which refuses to
  install while dependency build scripts are neither allowed nor denied. `init`
  writes a `pnpm-workspace.yaml` with `allowBuilds`.
- Projects created from the published package now get a `.gitignore`. npm never
  publishes files named `.gitignore`, so the template ships as `gitignore` and
  `init` renames it. Without this, `.env` and `node_modules` were committable.

## [0.2.0] — Production Foundations

### Added

- **`fastify-ep doctor`** — validates project integrity (fastify-ep project, Node
  and Fastify versions, manifest, tracked and registered modules, strict
  TypeScript, env config, health module). Exits non-zero on failure.
- **Standard error contract** in generated projects: a central error handler,
  typed `AppError`, `{ error: { code, message, requestId } }` envelope, and
  production-safe 500 responses with no internal messages or stack traces.
- **Liveness and readiness probes**: `GET /health/live` and `GET /health/ready`
  (`503` when a check fails), plus `fastify.registerReadinessCheck(name, fn)`
  for modules to contribute checks. `GET /health` is kept as an alias of live.
- **Graceful shutdown**: SIGTERM/SIGINT mark the app not-ready, close Fastify and
  registered resources, and exit `0` (or `1` on failure or timeout). Timeout is
  configurable with `SHUTDOWN_TIMEOUT_MS` (default 10000).
- **Generated module tests**: `generate module` now also writes
  `<name>.test.ts` demonstrating `app.inject()`. Pass `--no-test` to skip it.
- Generated projects include `tsconfig.build.json`, so `build` no longer emits
  test files into `dist/`. `typecheck` still covers tests.
- CI now exercises the generated project end to end on npm, pnpm and yarn:
  init → install → doctor → typecheck → test → build → generate module → doctor
  → typecheck → test → build → start the built server, probe it, and SIGTERM it.
- Documentation: `docs/production-foundations.md` (repository root).

### Changed

- **Manifest v2**: `.fastify-ep.json` now holds `schemaVersion`,
  `fastifyEpVersion`, `architecture` (`schema`, `di`, `database`) and `modules`.
  Projects with a v1 manifest are refused with instructions for updating it by
  hand.
- Generated `package.json` `build` script is now
  `tsc -p tsconfig.build.json`.

## [0.1.0]

### Added

- `fastify-ep init` — scaffold a Fastify project with split `app.ts`/`server.ts`,
  env validation, TypeBox, Swagger UI, a health module and Vitest.
- `fastify-ep generate module <name>` — generate and auto-register a domain
  module (schema, service, controller, module).
- Project manifest and generator safety (collision checks, rollback on failed
  registration).
