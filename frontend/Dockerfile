# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Frontend image: Vite build -> nginx static serving + reverse proxy.
#
# IMPORTANT — build context is the REPO ROOT, not frontend/:
#   docker build -f frontend/Dockerfile .
# (docker-compose.yml already does this.) The repo uses npm workspaces with a
# single package-lock.json at the root.
#
# nginx serves the SPA and proxies /api, /uploads and /socket.io to the
# backend container (see nginx.conf) — the browser therefore talks to a single
# origin, exactly like the Vite dev proxy (frontend/vite.config.ts), which
# keeps SameSite=Lax session cookies and CORS trivially correct.
# ---------------------------------------------------------------------------

# ---- 1) build ---------------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root=false

# NOTE: frontend/public is currently empty and git does not track empty
# directories, so it is deliberately NOT COPY'd (that would fail on a fresh
# clone). Vite builds fine without it; add a COPY line if assets appear there.
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json frontend/
COPY frontend/src frontend/src

# Empty on purpose: nginx in this image proxies the API on the same origin,
# so the SPA must use relative URLs (src/api/client.ts falls back to "").
ENV VITE_API_BASE_URL=""

# frontend "build" script = `tsc --noEmit && vite build` -> frontend/dist
RUN npm run build --workspace frontend

# ---- 2) runtime -------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80
