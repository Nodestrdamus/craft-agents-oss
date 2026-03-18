# Multi-stage build for Craft Agents Web Client
# Produces a minimal nginx container serving the static SPA

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace root files for monorepo resolution
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/server-core/package.json packages/server-core/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY packages/ packages/
COPY apps/web/ apps/web/

# Build args (injected at build time)
ARG VITE_ENTRA_TENANT_ID=""
ARG VITE_ENTRA_CLIENT_ID=""
ARG VITE_SERVER_URL=""
ARG VITE_APP_VERSION="0.7.7"

# Build the web client
WORKDIR /app/apps/web
RUN bun run build

# ---------------------------------------------------------------------------
# Stage 2: Serve
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine

# Copy built assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:80/health || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
