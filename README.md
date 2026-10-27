# fastify-ep

Scaffolds and keeps scaffolding a domain-driven module structure on native
Fastify — no DI runtime, no framework-on-top-of-a-framework. Just Fastify
plugins, decorators, and a generator that keeps producing the same shape as
your app grows.

![fastify-ep demo](media/demo.gif)

## Quickstart

```sh
npx fastify-ep init my-app
cd my-app
npm install
npm run dev
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

### Presets

`--preset` picks a starting point. It generates plain source you then own; nothing ties the
project to `fastify-ep`.

| Preset               | Adds                                                                                                                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimal`            | Fastify, TypeBox, env validation, the error handler, health probes, graceful shutdown, tests. No OpenAPI.                                                                                                                                                                          |
| `standard` (default) | Minimal plus Swagger / OpenAPI at `/documentation`.                                                                                                                                                                                                                                |
| `production`         | Standard plus security headers (`@fastify/helmet`), CORS (`@fastify/cors`, closed until `CORS_ORIGIN` is set), rate limiting (`@fastify/rate-limit`, `RATE_LIMIT_MAX` per minute, health probes exempt), and a `Dockerfile` and `.dockerignore` for the package manager you chose. |

The Dockerfile expects the lockfile from your first install, so run `<pm> install` before
`docker build`.

## Module anatomy

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

## Resource anatomy

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

## Commands

```
fastify-ep init [name|path] [--name <package-name>] [--pm npm|pnpm|yarn] [--preset minimal|standard|production] [--database none|drizzle|prisma] [--di native|awilix]
fastify-ep generate module <name> [--no-test] [--scope singleton|request] [-C <dir>]
fastify-ep generate resource <name> [--crud] [--no-test] [--scope singleton|request] [--singular <name>] [-C <dir>]
fastify-ep generate library <name> [--name <package-name>] [--dir <path>]
fastify-ep g <module|resource|library> ...      # g is an alias for generate
```

- `init` — scaffold a new project. The argument is a name or a directory path
  (`init apps/payments-api`); the package is named after the last segment, or after `--name`
  (which may be scoped, e.g. `--name @acme/payments-api`). Prompts interactively for anything not
  passed as an argument/flag. `--preset` chooses how much infrastructure to start with (see
  Presets above). `--database drizzle` or `prisma` adds a typed
  `fastify.db` on PostgreSQL (guide: `docs/database.md` at the workspace root).
  <!-- TODO: docs/ is not published. Point this link at the live docs site once it exists (see TODOS.md). -->
  `--di awilix` adds an [Awilix](https://github.com/jeffijoe/awilix) container via
  `@fastify/awilix`; the default, `native`, stays plain Fastify decorators and is
  the recommended choice.
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
- `generate library <name>` — inside a pnpm, npm or Yarn workspace, add a shared library: a plain
  TypeScript package (TypeBox example schema, a Vitest test, built to `dist`) at `packages/<name>`
  or wherever the workspace keeps libraries (`--dir` overrides). The package name uses the
  workspace's scope (`@acme/contracts`) unless `--name` is given. It writes only the new
  directory and prints the dependency line to add to a service. Services import a library
  through its `dist`, so build it first.

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
  workspace root.
- **Libraries.** `generate library <name>` adds a plain package (a TypeBox schema, a test, built
  to `dist`) under `packages/*` or `libs/*`. Add the printed dependency line to a service, and
  build the library first: services import it through its `dist`.
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

## License

This project is licensed under the [ISC License](./LICENSE).
