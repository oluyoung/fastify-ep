FROM node:22-alpine AS build
WORKDIR /app
# The whole project is copied before installing: a dependency's postinstall (e.g. `prisma generate`)
# needs the project's own files.
COPY . .
RUN npm ci
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Skip lifecycle scripts: dev-only tooling (e.g. `prisma generate`) is not installed here, and the
# build stage already compiled everything into dist/.
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
