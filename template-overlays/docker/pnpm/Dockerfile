FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
# The whole project is copied before installing: a dependency's postinstall (e.g. `prisma generate`)
# needs the project's own files.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:22-alpine
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Skip lifecycle scripts: dev-only tooling (e.g. `prisma generate`) is not installed here, and the
# build stage already compiled everything into dist/.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
