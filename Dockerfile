# Two-stage build: Expo web bundle → Node 20 Hono server.
# Designed for Railway, builds anywhere Docker runs.
#
# (Comment-only touch 2026-07-06: retrigger Railway's KC-MVP-2/dev deploy —
# main's branch protection requires an active deployment to that environment
# matching the exact promoted commit, and Railway only rebuilds on changes
# under its watched build path.)
#
# No `# syntax=` frontend directive: it forced BuildKit to pull
# docker/dockerfile:1.7 from Docker Hub every build, which failed with a
# Docker Hub auth/rate-limit error (2026-06-04). This Dockerfile uses only
# standard syntax (multi-stage, ARG/ENV, COPY --from) supported by the
# built-in frontend, so the external pull is unnecessary.

# ─── Stage 1: install + build the web bundle ──────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /repo

RUN corepack enable
COPY app /repo/app
WORKDIR /repo/app
RUN pnpm install --frozen-lockfile

# Every EXPO_PUBLIC_* the client reads at bundle time must be listed here;
# otherwise the builder stage never sees it and Metro inlines `undefined`.
ARG EXPO_PUBLIC_ENVIRONMENT
ARG EXPO_PUBLIC_SUPABASE_URL
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY
ARG EXPO_PUBLIC_WEB_BASE_URL
ENV EXPO_PUBLIC_ENVIRONMENT=${EXPO_PUBLIC_ENVIRONMENT}
ENV EXPO_PUBLIC_SUPABASE_URL=${EXPO_PUBLIC_SUPABASE_URL}
ENV EXPO_PUBLIC_SUPABASE_ANON_KEY=${EXPO_PUBLIC_SUPABASE_ANON_KEY}
ENV EXPO_PUBLIC_WEB_BASE_URL=${EXPO_PUBLIC_WEB_BASE_URL}

RUN pnpm build:web

# Server package (hono + @hono/node-server, pure JS) with production deps at
# the exact versions in app/pnpm-lock.yaml — the same ones CI tests. A bare
# `npm install` here resolved whatever was newest at build time.
RUN pnpm --filter @kc/web-server deploy --prod /repo/web-server-deploy

# ─── Stage 2: Hono server with OG meta + static SPA + SPA fallback ────
FROM node:20-alpine AS runner
WORKDIR /srv

COPY --from=builder /repo/web-server-deploy/package.json ./package.json
COPY --from=builder /repo/web-server-deploy/node_modules ./node_modules
COPY --from=builder /repo/web-server-deploy/server.mjs ./server.mjs
COPY --from=builder /repo/web-server-deploy/i18n ./i18n
COPY --from=builder /repo/app/apps/mobile/dist ./dist

# Run as the image's built-in unprivileged user (node:alpine ships `node`).
RUN chown -R node:node /srv
USER node

ENV PORT=3000
ENV WEB_DIST_DIR=/srv/dist
EXPOSE 3000

# SUPABASE_URL, SUPABASE_ANON_KEY, APP_BASE_URL are injected by Railway at runtime.
CMD ["node", "server.mjs"]
