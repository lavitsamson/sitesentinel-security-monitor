# syntax=docker/dockerfile:1
#
# One Dockerfile, three images, sharing a single build stage:
#
#   docker build --target api    -t sitesentinel-api .
#   docker build --target worker -t sitesentinel-worker .
#   docker build --target web    -t sitesentinel-web .
#
# Base images are pinned by digest; the tag is kept alongside for humans.

ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86

# --- build: install, compile, then prune each app to its production files ----
FROM ${NODE_IMAGE} AS build
# Matches "packageManager" in package.json.
ARG PNPM_VERSION=12.7.0
ENV CI=true HUSKY=0
RUN npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
WORKDIR /repo

# Dependencies first, keyed on the lockfile only, so source edits reuse this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Cache mounts: the package store and pnpm's registry metadata, reused across builds.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --offline
RUN pnpm build

# `pnpm deploy` copies one app with only its production dependencies; workspace
# packages are included as their published files (dist). It re-runs the supply-chain
# policy check, which may fetch registry metadata, so it is not --offline.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm --filter @sitesentinel/api deploy --prod /out/api \
 && pnpm --filter @sitesentinel/worker deploy --prod /out/worker

# --- node runtime shared by the api and worker images ------------------------
FROM ${NODE_IMAGE} AS node-runtime
ARG APP_VERSION=0.1.0
ENV NODE_ENV=production APP_VERSION=${APP_VERSION}
WORKDIR /app
# Files stay owned by root and read-only to the app user; the "node" user (uid 1000)
# ships with the base image. Kubernetes additionally mounts the root filesystem read-only.
USER node

# --- api ----------------------------------------------------------------------
FROM node-runtime AS api
COPY --from=build --chown=root:root /out/api ./
EXPOSE 4000
# Node is PID 1 and handles SIGTERM itself (graceful shutdown in main.ts).
CMD ["node", "dist/main.js"]

# --- worker -------------------------------------------------------------------
FROM node-runtime AS worker
COPY --from=build --chown=root:root /out/worker ./
# Metrics and health probes only; the worker takes no user traffic.
EXPOSE 9464
CMD ["node", "dist/main.js"]

# --- web: the built SPA behind an unprivileged nginx (uid 101, port 8080) ------
FROM ${NGINX_IMAGE} AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
