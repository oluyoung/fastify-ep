# Build from the workspace root: docker build -f {{servicePath}}/Dockerfile -t {{projectName}} .
# Docker reads {{servicePath}}/Dockerfile.dockerignore next to this file (BuildKit).
# Yarn Berry (2+) only, with `nodeLinker: node-modules` in .yarnrc.yml (the image runs plain `node`).
# It uses `yarn workspaces focus` and `yarn workspaces foreach`.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
# The whole workspace is copied before installing: a dependency's postinstall (e.g. `prisma generate`)
# and local libraries need their own files.
COPY . .
RUN yarn install --immutable
# The service and the workspace packages it depends on build in dependency order, so the service
# resolves local libraries through their `dist`.
RUN yarn workspaces foreach --recursive --topological --from "{{projectName}}" run build
# Drop dev dependencies for the final image.
RUN yarn workspaces focus "{{projectName}}" --production

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
USER node
WORKDIR /repo/{{servicePath}}
EXPOSE 3000
CMD ["node", "dist/server.js"]
