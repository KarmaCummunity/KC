# syntax=docker/dockerfile:1
#
# Container image of the KC API (@kc/api).
# Build context is the workspace root:  docker build -f apps/api/Dockerfile app/
#
# Two stages: `build` has the whole toolchain, `runtime` has only Node, the
# production dependencies and the bundled server.

FROM node:22-bookworm-slim AS build
WORKDIR /workspace
# pnpm at the version pinned in the root package.json (`packageManager`).
RUN corepack enable

# Manifests first: the dependency layer is rebuilt only when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@kc/api..."

COPY apps/api/ apps/api/
# `deploy --prod` writes a standalone copy of the package with production
# dependencies only (no workspace symlinks), which the runtime stage takes.
RUN pnpm --filter @kc/api build \
 && pnpm --filter @kc/api deploy --prod /out \
 && cp -r apps/api/dist /out/dist

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# The image's built-in unprivileged user: the server needs no root right.
USER node
# Documentation only; the platform sets PORT and the server binds to it.
EXPOSE 8080
CMD ["node", "dist/main.js"]
