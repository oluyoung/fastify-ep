# Build from the workspace root: docker build -f {{servicePath}}/Dockerfile -t {{projectName}} .
# Docker reads {{servicePath}}/Dockerfile.dockerignore next to this file (BuildKit).
FROM node:22-alpine AS build
WORKDIR /repo
# The whole workspace is copied before installing: a dependency's postinstall (e.g. `prisma generate`)
# and local libraries need their own files.
COPY . .
RUN npm ci
# Local libraries are built first, so the service resolves them through their `dist`. Every
# directory with a .fastify-ep-library.json is built; add other local libraries here by hand.
RUN for dir in $(find . -name .fastify-ep-library.json -not -path '*/node_modules/*' -exec dirname {} \;); do \
      npm run build --prefix "$dir" || exit 1; \
    done
RUN npm run build -w "{{projectName}}"
# Drop dev dependencies for the final image. Skip lifecycle scripts: dev-only tooling is gone.
RUN npm ci -w "{{projectName}}" --omit=dev --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
USER node
WORKDIR /repo/{{servicePath}}
EXPOSE 3000
CMD ["node", "dist/server.js"]
