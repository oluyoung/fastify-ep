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

That's it — the new module is generated and wired into the app for you.

## What you get

`init` scaffolds a project with:

- [Fastify 5](https://fastify.dev/)
- [`@fastify/swagger`](https://github.com/fastify/fastify-swagger) +
  [`@fastify/swagger-ui`](https://github.com/fastify/fastify-swagger-ui),
  served at `/documentation`
- [`@fastify/env`](https://github.com/fastify/fastify-env) for validated
  environment config
- [TypeBox](https://github.com/sinclairzx81/typebox) schemas
- TypeScript + [Vitest](https://vitest.dev/), already wired up

## Module anatomy

Each `generate module <name>` produces four files under
`src/modules/<name>/`:

- `<name>.module.ts` — a `fastify-plugin`-wrapped plugin that decorates the
  Fastify instance with the module's service and registers its routes
- `<name>.controller.ts` — route registration
- `<name>.service.ts` — the module's business logic
- `<name>.schema.ts` — TypeBox response/request schemas

The module is auto-registered in `src/app.ts` at the `// fastify-ep:register`
marker — no manual wiring required. If that marker is ever removed, the CLI
tells you exactly what line to add by hand.

## Commands

```
fastify-ep init [name] [--pm npm|pnpm|yarn]
fastify-ep generate module <name>
```

- `init` — scaffold a new project. Prompts interactively for anything not
  passed as an argument/flag.
- `generate module <name>` — add a new domain module to an existing
  `fastify-ep` project.

## Why no DI runtime?

Native Fastify already gives you encapsulation (via `fastify-plugin`) and
dependency access (via decorators) without a separate container, decorator
metadata, or reflection. `fastify-ep` leans into that instead of layering a
DI framework on top of it — modules stay plain TypeScript, and there's one
fewer abstraction between you and the Fastify instance.

## License

This project is licensed under the [ISC License](./LICENSE).
