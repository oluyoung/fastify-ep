# fastify-ep

[![npm version](https://img.shields.io/npm/v/fastify-ep.svg)](https://www.npmjs.com/package/fastify-ep)
[![CI](https://github.com/oluyoung/fastify-ep/actions/workflows/ci.yml/badge.svg)](https://github.com/oluyoung/fastify-ep/actions/workflows/ci.yml)
[![license: ISC](https://img.shields.io/npm/l/fastify-ep.svg)](./LICENSE)

Scaffolds and keeps scaffolding a domain-driven module structure on native
Fastify — no DI runtime, no framework-on-top-of-a-framework. Just Fastify
plugins, decorators, and a generator that keeps producing the same shape as
your app grows.

![fastify-ep demo](https://raw.githubusercontent.com/oluyoung/fastify-ep/master/media/demo.gif)

> **Docs site in progress, pardon the dead links.** The full documentation will live at
> [fastify-ep.vercel.app](https://fastify-ep.vercel.app). Until it is up, this README covers
> everything you need to get going.

## Contents

- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [What you get](#what-you-get)
  - [Generated project layout](#generated-project-layout)
  - [Choices at init](#choices-at-init)
- [Adding code](#adding-code)
  - [Module anatomy](#module-anatomy)
  - [Resource anatomy](#resource-anatomy)
  - [Adding one file to a module](#adding-one-file-to-a-module)
- [Configuration and operations](#configuration-and-operations)
- [Commands](#commands)
- [Upgrading](#upgrading)
- [Architecture checks](#architecture-checks)
- [Workspaces and monorepos](#workspaces-and-monorepos)
- [Why no DI runtime by default?](#why-no-di-runtime-by-default)
- [Examples](#examples)
- [Documentation](#documentation)
- [Status and stability](#status-and-stability)
- [Contributing, security and license](#contributing-security-and-license)

## Requirements

- **Node.js 24 or later.** The CLI and the projects it generates both require it.
- npm, pnpm or Yarn. Yarn needs Berry (2+) with `nodeLinker: node-modules` for the generated
  Dockerfile.
- PostgreSQL for projects created with `--database drizzle` or `prisma` (the generated
  `docker-compose.yml` starts Postgres 16). Docker is optional.

## Quickstart

```sh
npx fastify-ep init my-app
cd my-app
npm install
npm run dev
```

`init` asks for anything you leave out (package manager, preset, database, DI). To skip the
prompts, pass everything as flags:

```sh
npx fastify-ep init my-app --pm npm --preset standard --database none --di native
```

With the server running:

```sh
curl localhost:3000/health          # {"status":"ok", ...}
open http://localhost:3000/documentation   # Swagger UI (not in the Minimal preset)
```

Add a new domain module at any point:

```sh
fastify-ep generate module orders
```

That's it — the new module is generated and wired into the app for you. `g` is
shorthand for `generate`, and `generate resource` goes further than `module` by adding a
repository (and, with `--crud`, a full set of routes):

```sh
fastify-ep g resource users --crud
```

The generated scripts are `dev` (watch mode), `build`, `start` (runs `dist/server.js`),
`typecheck` and `test`. Database projects also get `db:generate` and `db:migrate`.

## What you get

`init` scaffolds a project with:

- [Fastify 5](https://fastify.dev/)
- [`@fastify/swagger`](https://github.com/fastify/fastify-swagger) +
  [`@fastify/swagger-ui`](https://github.com/fastify/fastify-swagger-ui),
  served at `/documentation` (everything except the Minimal preset)
- [`@fastify/env`](https://github.com/fastify/fastify-env) for validated
  environment config
- [TypeBox](https://github.com/sinclairzx81/typebox) schemas
- TypeScript + [Vitest](https://vitest.dev/), already wired up
- a consistent error handler, `/health`, `/health/live` and `/health/ready` probes, graceful
  shutdown, request IDs and structured logging

It generates plain source you then own; nothing ties the project to `fastify-ep` at runtime.

### Generated project layout

A Production-preset project with Drizzle (other choices omit or swap the files marked):

```
my-app/
├── .fastify-ep.json            # manifest the CLI reads (do not delete)
├── .env.example
├── Dockerfile, .dockerignore   # Production preset
├── docker-compose.yml          # database projects
├── drizzle.config.ts           # Drizzle (Prisma: prisma/schema.prisma)
├── package.json, tsconfig*.json, vitest.config.ts
└── src/
    ├── server.ts               # starts listening; app.ts never does
    ├── app.ts                  # builds the Fastify instance, registers plugins and modules
    ├── config/env.ts           # validated environment
    ├── errors/                 # AppError, the error handler and response schema
    ├── lifecycle/shutdown.ts   # graceful shutdown
    ├── observability/          # logger options, request IDs
    ├── infrastructure/         # database and security plugins (when chosen)
    └── modules/
        └── health/             # controller, module, service, schema and tests
```

### Choices at init

`--preset` picks how much infrastructure you start with:

| Preset               | Adds                                                                                                                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimal`            | Fastify, TypeBox, env validation, the error handler, health probes, graceful shutdown, tests. No OpenAPI.                                                                                                                                                                          |
| `standard` (default) | Minimal plus Swagger / OpenAPI at `/documentation`.                                                                                                                                                                                                                                |
| `production`         | Standard plus security headers (`@fastify/helmet`), CORS (`@fastify/cors`, closed until `CORS_ORIGIN` is set), rate limiting (`@fastify/rate-limit`, `RATE_LIMIT_MAX` per minute, health probes exempt), and a `Dockerfile` and `.dockerignore` for the package manager you chose. |

The Dockerfile expects the lockfile from your first install, so run `<pm> install` before
`docker build`.

| Option       | Values                                | Notes                                                                                                                                                           |
| ------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--database` | `none` (default), `drizzle`, `prisma` | Drizzle or Prisma adds a typed `fastify.db` on PostgreSQL and a `docker-compose.yml`.                                                                           |
| `--di`       | `native` (default), `awilix`          | `native` is plain Fastify decorators and the recommended choice. `awilix` adds an [Awilix](https://github.com/jeffijoe/awilix) container via `@fastify/awilix`. |
| `--pm`       | `npm`, `pnpm`, `yarn`                 | Inside a workspace, the workspace's package manager is used.                                                                                                    |

## Adding code

### Module anatomy

Each `generate module <name>` produces five files under
`src/modules/<name>/`:

- `<name>.module.ts` — a `fastify-plugin`-wrapped plugin that decorates the
  Fastify instance with the module's service and registers its routes
- `<name>.controller.ts` — route registration
- `<name>.service.ts` — the module's business logic
- `<name>.schema.ts` — TypeBox response/request schemas
- `<name>.test.ts` — an `app.inject()` example test (skip with `--no-test`)

The module is auto-registered in `src/app.ts` at the `// fastify-ep:register`
marker — no manual wiring required. If that marker is ever removed, the CLI
tells you exactly what line to add by hand.

### Resource anatomy

`generate resource <name>` is a module plus a repository. It produces six files under
`src/modules/<name>/` (the same five as a module, plus `<name>.repository.ts`) and is registered
in `src/app.ts` the same way. Use `generate module` for a lightweight skeleton and
`generate resource` when the module owns data.

Without `--crud`, the repository is a minimal in-memory one and `GET /<name>` is a status
endpoint. With `--crud` you get:

```
POST   /<name>
GET    /<name>
GET    /<name>/:id
PATCH  /<name>/:id
DELETE /<name>/:id
```

backed by the project's database strategy:

| `--database` | Repository                          | Also generated                                                           |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `none`       | in-memory `Map`                     |                                                                          |
| `drizzle`    | Drizzle queries on `fastify.db`     | `<name>.table.ts`, exported from `src/infrastructure/database/schema.ts` |
| `prisma`     | Prisma client calls on `fastify.db` | a `model` block appended to `prisma/schema.prisma`                       |

Entities start with `id` and `name` fields; edit the schema, repository and table or model to
fit your data. For a database project, run `npm run db:generate` and then `npm run db:migrate`
after generating. The entity name is the resource name with a trailing plural `s` removed
(`users` becomes `User`); pass `--singular person` for irregular plurals. Resource and module
names must be lowercase kebab-case (`user-profiles`).

### Adding one file to a module

When a module needs another service, schema or repository, add just that file:

```sh
fastify-ep g service notifications --module orders
fastify-ep g schema order-item --module orders
fastify-ep g repository order-lines --module orders --model OrderLine   # Prisma model, or a Drizzle table such as orderLinesTable
```

`--module` is always required. A service or repository is registered in the module's
`<module>.module.ts`; a schema needs no registration. See [Commands](#commands) for the details.

## Configuration and operations

Configuration comes from environment variables, validated at startup by `src/config/env.ts` (a
`.env` file is read in development). The Production preset and the database options add their own
keys to the same file.

| Variable              | Default         | Purpose                                                              |
| --------------------- | --------------- | -------------------------------------------------------------------- |
| `PORT`, `HOST`        | 3000, `0.0.0.0` | Where the server listens.                                            |
| `NODE_ENV`            | `development`   |                                                                      |
| `LOG_LEVEL`           | `info`          | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.      |
| `SHUTDOWN_TIMEOUT_MS` | `10000`         | How long graceful shutdown waits for in-flight requests.             |
| `DATABASE_URL`        |                 | Database projects. Copy `.env.example` to `.env`.                    |
| `CORS_ORIGIN`         |                 | Production preset. Comma-separated origins or `*`; closed until set. |
| `RATE_LIMIT_MAX`      |                 | Production preset. Requests per minute; health probes are exempt.    |

- **Request IDs.** Every request has an ID. A valid incoming `x-request-id` header
  (letters, digits, `.`, `_`, `-`, up to 128 characters) is reused; otherwise a UUID is generated.
  The ID is returned in the `x-request-id` response header, appears as `reqId` in every log line, and
  is included in error responses as `requestId`.
- **Logging.** Pino JSON logs at `LOG_LEVEL`. The `authorization`, `cookie` and `set-cookie`
  headers are redacted.
- **Health.** `/health` and `/health/live` report liveness; `/health/ready` returns 503 until
  dependencies (such as the database) are reachable. Use them for container and load balancer probes.
- **Shutdown.** `SIGINT` and `SIGTERM` close the server gracefully, within `SHUTDOWN_TIMEOUT_MS`.
- **Tests.** `npm test` needs no database. Repository tests for database projects run only when
  `TEST_DATABASE_URL` points at a reachable database and are skipped otherwise.

## Commands

```
fastify-ep init [name|path] [--name <package-name>] [--pm npm|pnpm|yarn] [--preset minimal|standard|production] [--database none|drizzle|prisma] [--di native|awilix]
fastify-ep generate module <name> [--no-test] [--scope singleton|request] [-C <dir>]
fastify-ep generate resource <name> [--crud] [--no-test] [--scope singleton|request] [--singular <name>] [-C <dir>]
fastify-ep generate service <name> --module <module> [--no-test] [--scope singleton|request] [-C <dir>]
fastify-ep generate schema <name> --module <module> [-C <dir>]
fastify-ep generate repository <name> --module <module> --model <model> [--no-test] [-C <dir>]
fastify-ep generate library <name> [--name <package-name>] [--dir <path>]
fastify-ep g <module|resource|service|schema|repository|library> ...      # g is an alias for generate
fastify-ep doctor [--strict] [--json] [-C <dir>]
fastify-ep upgrade [--dry-run] [--json] [-C <dir>]
```

- `init` — scaffold a new project. The argument is a name or a directory path
  (`init apps/payments-api`); the package is named after the last segment, or after `--name`
  (which may be scoped, e.g. `--name @acme/payments-api`). Prompts interactively for anything not
  passed as an argument/flag. See [Choices at init](#choices-at-init) for the options.
- `generate module <name>` — add a new domain module to an existing
  `fastify-ep` project. Pass `--no-test` to skip the generated test file. In an Awilix
  project, `--scope request` registers the module's service per request instead of as a
  singleton (default).
- `generate resource <name>` — add a module with a repository to an existing project.
  `--crud` adds create/read/update/delete routes backed by the project's database and, for
  Drizzle and Prisma, edits the schema file (see [Resource anatomy](#resource-anatomy)).
  `--singular <name>` sets the entity name; `--no-test` and `--scope` behave as for `module`.
  Generation stops without writing anything if the name is invalid or already used, or if the
  schema file already defines that table or model, and it restores everything if a step fails.
- `generate service|schema|repository <name> --module <module>` — add one more file to an
  existing module, named `<name>.service.ts` (and so on) next to the module's own files.
  `--module` is always required. A service or repository is registered in the module's
  `<module>.module.ts` (a type entry and a decorator, or an Awilix registration); if that file no
  longer has the generated shape, it is left as it is and the lines to add are printed. A schema
  needs no registration. `repository` needs a database project and `--model`, the existing Prisma
  model (`User`) or Drizzle table export (`usersTable`) it reads; it also writes a test that runs
  against `TEST_DATABASE_URL` and is skipped without it. Generation is refused if the file exists
  or if another module already registers the same name.
- `generate library <name>` — inside a pnpm, npm or Yarn workspace, add a shared library (see
  [Workspaces and monorepos](#workspaces-and-monorepos)).
- `doctor` — check a project's integrity and architecture; see
  [Architecture checks](#architecture-checks). It exits 1 on errors, and with `--strict` on warnings
  too. `-C <dir>` (`--project`) picks the project or library to check. `--json` prints the result
  as one JSON document (`format: 1`) instead of the report.
- `upgrade` — move a project created by an earlier version (0.6.0 or later) to the installed
  version; see [Upgrading](#upgrading). `--dry-run` shows the plan and writes nothing.

## Upgrading

```sh
fastify-ep upgrade --dry-run   # what would change; writes nothing
fastify-ep upgrade             # apply it
```

`upgrade` runs one small, tested migration per release from the version in your `.fastify-ep.json`
to the installed one. It only rewrites a generated file that still matches what was generated:
anything you edited is left alone and listed under "Manual review required". The changes are
written together and rolled back if one fails. It never runs your package manager; when
`package.json` changed it prints the install command. `doctor` warns when a project is behind the
installed version, and `doctor --strict` fails until it is upgraded.

## Architecture checks

`fastify-ep doctor` prints its checks in groups and ends with `N errors, M warnings`:

- **Project** and **Modules** are integrity checks (manifest, Node and Fastify versions, modules
  present and registered, health module, database and Awilix wiring). A failure is an error.
- **Architecture** reads your source and warns when it drifts from the conventions the generators
  follow. It compares imports only, without the TypeScript compiler, and stays silent when it
  cannot be sure. Type-only imports never count.

| Rule                                 | Warns when                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `FEP-001/server-boundary`            | `src/server.ts` is missing, or `src/app.ts` calls `listen()`                                              |
| `FEP-002/cross-module-import`        | a module imports another module's controller, service or repository (its schema and table files are fine) |
| `FEP-003/no-database-in-controller`  | a controller imports `drizzle-orm`, `postgres`, `@prisma/client` or the database folder                   |
| `FEP-004/service-imports-controller` | a service imports a controller                                                                            |
| `FEP-005/typebox-schemas`            | a module's `.schema.ts` does not import `@sinclair/typebox`                                               |

Warnings do not fail a plain `doctor`. Run `fastify-ep doctor --strict` in CI to fail on them too.
To keep a deliberate exception, put a comment with the rule id on the line above it:

```ts
// fastify-ep-ignore FEP-002/cross-module-import
import { UsersService } from '../users/users.service.js';
```

Doctor notes an ignore that names no rule, an unknown rule, or silences nothing. Pointed at a shared
library (`doctor -C packages/contracts`), it checks the library instead: the marker file, a valid
package name, `"type": "module"`, `exports` and `files` pointing at `dist`, the `build` and
`typecheck` scripts, and that the workspace's globs include it.

## Workspaces and monorepos

`fastify-ep` works inside pnpm, npm and Yarn workspaces. It writes only inside the directory it
creates; anything that belongs in the workspace's own files is printed for you to apply.

```sh
fastify-ep init apps/users-api --name @acme/users-api   # inherits the workspace's package manager
fastify-ep generate library contracts                   # packages/contracts, as @acme/contracts
pnpm install                                            # once, at the workspace root
```

- **Package manager.** Inside a workspace `init` uses the workspace's manager and skips the prompt;
  a conflicting `--pm` is an error. Turborepo and Nx are recognised and mentioned, never edited.
- **What you may need to add.** If the new directory is not matched by the workspace's package
  globs, `init` prints the glob to add. In a pnpm workspace it does not write a
  `pnpm-workspace.yaml`; it prints the `allowBuilds` entries to merge into the root one.
- **Several services.** Each service keeps its own `.fastify-ep.json`. `generate` and `doctor`
  find the service you are in from any subfolder, and `-C <dir>` (`--project`) picks one from the
  workspace root. `generate module` and `generate resource` refuse a library.
- **Libraries.** `generate library <name>` adds a plain TypeScript package (a TypeBox example
  schema, a Vitest test, built to `dist`) at `packages/<name>` or wherever the workspace keeps
  libraries (`--dir` overrides). The package name uses the workspace's scope (`@acme/contracts`)
  unless `--name` is given. It writes only the new directory and prints the dependency line to add
  to a service. Services import a library through its `dist`, so build it first.
- **Docker.** With the Production preset, a service in a workspace gets a Dockerfile built from
  the workspace root: `docker build -f apps/users-api/Dockerfile -t users-api .`. It builds the
  libraries a service depends on. Yarn needs Berry (2+) with `nodeLinker: node-modules`;
  otherwise no Dockerfile is generated and `init` says why.

## Why no DI runtime by default?

Native Fastify already gives you encapsulation (via `fastify-plugin`) and
dependency access (via decorators) without a separate container, decorator
metadata, or reflection. `fastify-ep` leans into that instead of layering a
DI framework on top of it — modules stay plain TypeScript, and there's one
fewer abstraction between you and the Fastify instance. If you want a container,
`--di awilix` is opt-in.

## Examples

[`examples/`](https://github.com/oluyoung/fastify-ep/tree/master/examples) holds five projects
generated by the real CLI (minimal, production, Drizzle, Prisma and Awilix). CI regenerates them and
fails on any difference, then installs, checks, tests and builds each one.

## Documentation

> Docs site in progress, pardon the dead links.

Full documentation at [fastify-ep.vercel.app](https://fastify-ep.vercel.app):

- [Getting started](https://fastify-ep.vercel.app/getting-started)
- [CLI reference](https://fastify-ep.vercel.app/cli)
- Guides: [configuration](https://fastify-ep.vercel.app/guides/configuration),
  [modules and resources](https://fastify-ep.vercel.app/guides/modules-and-resources),
  [database](https://fastify-ep.vercel.app/database),
  [testing](https://fastify-ep.vercel.app/guides/testing),
  [observability](https://fastify-ep.vercel.app/guides/observability),
  [security and presets](https://fastify-ep.vercel.app/guides/security-and-presets),
  [deployment](https://fastify-ep.vercel.app/guides/deployment),
  [workspaces](https://fastify-ep.vercel.app/guides/workspaces)
- [Upgrade migrations](https://fastify-ep.vercel.app/migrations)
- [Architecture rules (FEP-001 to FEP-012)](https://fastify-ep.vercel.app/architecture)
- [Stability and compatibility](https://fastify-ep.vercel.app/stability)

## Status and stability

`fastify-ep` is pre-1.0. Generated output and CLI details can still change in a minor version;
`fastify-ep upgrade` carries existing projects forward and every change is listed in the
[CHANGELOG](https://github.com/oluyoung/fastify-ep/blob/master/CHANGELOG.md). The stability policy for 1.0 (what the commands, manifest and generated
files promise) is described at [fastify-ep.vercel.app/stability](https://fastify-ep.vercel.app/stability).

## Contributing, security and license

- [Contributing](https://github.com/oluyoung/fastify-ep/blob/master/CONTRIBUTING.md) and the [Code of Conduct](https://github.com/oluyoung/fastify-ep/blob/master/CODE_OF_CONDUCT.md)
- Report vulnerabilities as described in [SECURITY.md](https://github.com/oluyoung/fastify-ep/blob/master/SECURITY.md), not in public issues
- Licensed under the [ISC License](./LICENSE)
