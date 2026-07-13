# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Backend image (Express + Prisma + Socket.IO)
#
# IMPORTANT — build context is the REPO ROOT, not backend/:
#   docker build -f backend/Dockerfile .
# (docker-compose.yml already does this.) The repo uses npm workspaces with a
# single package-lock.json at the root, so a reproducible `npm ci` is only
# possible from the root.
#
# Native modules (sharp, bcrypt) ship prebuilt binaries per OS/arch/libc.
# Every stage below derives from the SAME base (node:20-bookworm-slim +
# openssl) so the binaries installed in the deps stages match the runtime
# platform exactly — never copy node_modules built on another platform here.
# ---------------------------------------------------------------------------

# ---- 0) base: shared by ALL stages ------------------------------------------
FROM node:20-bookworm-slim AS base
# openssl must be present in EVERY stage, not just the runtime. Prisma picks
# its engine binaries by detecting the installed libssl (get-platform); on
# node:20-bookworm-slim WITHOUT openssl it silently falls back to
# "debian-openssl-1.1.x", so npm's postinstall downloads 1.1.x engines — and
# a runtime that DOES have openssl 3 then expects "debian-openssl-3.0.x",
# finds nothing, and tries to download engines at container start (fails
# offline, and against root-owned files under USER node). Sprint 3 incident;
# see docs/deploy-handoff.md §1-bis.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- 1) deps: full install (incl. devDependencies — tsc + prisma CLI) ------
FROM base AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --workspace backend --include-workspace-root=false

# ---- 2) build: prisma generate (required before tsc) + TypeScript build ----
FROM deps AS build
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/prisma backend/prisma
COPY backend/src backend/src
# prisma generate MUST run before tsc — src imports @prisma/client, whose
# types only exist after generation (output: hoisted node_modules/.prisma).
RUN npm run prisma:generate --workspace backend \
 && npm run build --workspace backend
# Guard: fail the BUILD (not the deploy) if the engines present don't match
# the runtime platform (debian-openssl-3.0.x on this base). `migrate deploy`
# at container start must never need the network — offline/air-gapped
# deployments are a requirement.
RUN test -x node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x \
 && test -f node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

# ---- 3) prod-deps: production-only node_modules (no tsc/tsx/@types) --------
FROM base AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --workspace backend --include-workspace-root=false --omit=dev

# ---- 4) runtime -------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
# No telemetry/update-check attempts from the prisma CLI at container start
# (irrelevant noise online, a hang risk in closed networks).
ENV CHECKPOINT_DISABLE=1

WORKDIR /app

# --chown=node:node: the container runs as USER node; files copied from other
# stages default to root-owned, which turns any unexpected write (e.g. the
# prisma CLI deciding an engine is missing) into a hard EACCES instead of a
# clear error message. The build-stage engine guard above is the real fix;
# the chown costs nothing (applied during COPY, no extra layer).

# Production dependencies (bcrypt/sharp prebuilds match this platform).
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
# Generated Prisma client from the build stage (overlays the ungenerated one).
COPY --from=build --chown=node:node /repo/node_modules/.prisma ./node_modules/.prisma
# @prisma scope incl. @prisma/engines with the schema-engine binary verified
# by the build-stage guard — migrate deploy runs fully offline.
COPY --from=build --chown=node:node /repo/node_modules/@prisma ./node_modules/@prisma
# Prisma CLI (a devDependency, but needed at container start for
# `prisma migrate deploy` — see docker-entrypoint.sh). Its runtime deps are
# all under the @prisma scope, copied above.
COPY --from=build --chown=node:node /repo/node_modules/prisma ./node_modules/prisma

# Compiled app + migrations + manifest. app.js resolves the uploads dir as
# <WORKDIR>/uploads (dist/app.js -> ".." -> /app/uploads); compose mounts a
# named volume there so images survive container recreation.
COPY --from=build --chown=node:node /repo/backend/dist ./dist
COPY --chown=node:node backend/prisma ./prisma
COPY --chown=node:node backend/package.json ./package.json
COPY --chown=node:node backend/docker-entrypoint.sh ./docker-entrypoint.sh

# chmod: the exec bit is lost on Windows checkouts, so don't rely on it.
RUN chmod +x ./docker-entrypoint.sh \
 && mkdir -p uploads/products \
 && chown -R node:node /app/uploads

USER node
EXPOSE 4000

# Applies pending migrations (prisma migrate deploy), then exec's
# `node dist/server.js` so the server is PID 1 and receives SIGTERM directly
# (server.ts implements graceful shutdown on SIGTERM/SIGINT).
ENTRYPOINT ["./docker-entrypoint.sh"]
