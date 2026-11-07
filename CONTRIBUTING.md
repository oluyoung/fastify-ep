# Contributing to fastify-ep

Thanks for helping. `fastify-ep` is a development-time tool: it generates plain Fastify code and adds
no runtime of its own. Changes should keep generated projects understandable and free of
request-time abstraction.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). For security problems, follow
[SECURITY.md](SECURITY.md) instead of opening an issue.

## Setup

Requires Node.js 22 or newer.

```sh
git clone https://github.com/oluyoung/fastify-ep.git
cd fastify-ep
npm install
```

## Everyday commands

```sh
npm run dev -- init demo-app   # run the CLI from source (tsx)
npm run typecheck
npm run lint
npm test                       # vitest
npm run build                  # tsc to dist/
npm run format                 # prettier
```

Before opening a pull request, `npm run typecheck`, `npm run lint` and `npm test` must pass.

## Where things live

- `src/` is the CLI. `src/commands/` holds the command handlers.
- `templates/`, `template-overlays/`, `module-template*`, `resource-template*` and
  `library-template` are the files the generators render. They ship in the npm package.
- `src/migrations/` holds the `upgrade` migrations, one file per version step.
- `scripts/` holds the smoke tests that CI runs (`smoke.sh`, `upgrade-smoke.sh`,
  `workspace-smoke.sh`) and the example builder.
- `examples/` holds generated example apps. Regenerate them with `npm run examples`; do not edit them
  by hand.

## Changing generated output

Generated output is a public contract once projects exist, so:

1. Change the template.
2. Add or update tests that cover the new output.
3. If existing projects need the change, add a migration (below). If they don't, say why in the pull
   request.
4. Run `npm run examples` and commit the regenerated examples.
5. Add a line to `CHANGELOG.md` under an `## [Unreleased]` heading (create it if missing).

## Adding a migration

Migrations are explicit and individually tested.

1. Add `src/migrations/<from>-to-<to>.ts` exporting a `Migration` (see `src/migrations/types.ts` and
   an existing file for the shape). Prefer anchored snippet patches. Never overwrite a file the user
   has edited; modified files go into the "manual review" report.
2. Register it in `src/migrations/index.ts`.
3. Test it in `src/migrations/migrations.test.ts`.
4. Add the source tag to the `upgrade` job matrix in `.github/workflows/ci.yml` if the change needs a
   real-release fixture.

## Pull requests

- Keep each pull request to one change, and describe the problem it solves.
- Include tests. Bug fixes should include a test that fails without the fix.
- Match the existing style; Prettier and ESLint enforce it.
- Commit messages are short and in the imperative, for example `add upgrade command`.

## Reporting bugs and proposing features

Open an issue with the command you ran, the output, your Node.js and package manager versions, and the
`fastify-ep` version. For larger changes, open an issue first so we can agree on the approach.
