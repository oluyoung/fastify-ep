# Build from the workspace root: docker build -f {{servicePath}}/Dockerfile -t {{projectName}} .
# Docker reads {{servicePath}}/Dockerfile.dockerignore next to this file (BuildKit).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
# The whole workspace is copied before installing: a dependency's postinstall (e.g. `prisma generate`)
# and local libraries need their own files.
COPY . .
# "name..." selects the service and the workspace packages it depends on.
RUN pnpm install --frozen-lockfile --filter "{{projectName}}..."
# Local libraries build first (pnpm orders by dependencies), so the service resolves them through their `dist`.
RUN pnpm --filter "{{projectName}}..." run build
# Drop dev dependencies for the final image. Skip lifecycle scripts: dev-only tooling is gone.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "{{projectName}}..."

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
USER node
WORKDIR /repo/{{servicePath}}
EXPOSE 3000
CMD ["node", "dist/server.js"]
