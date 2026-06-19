# Workspace-aware build — BUILD CONTEXT IS THE REPO ROOT (see docker-compose.yml).
# Uses the single root package-lock.json as the source of truth, and installs
# only the @gravvia/backend workspace's dependencies (lean image).
FROM node:22-alpine AS base
WORKDIR /app

# ---- deps: production-only node_modules for the backend workspace ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm ci --omit=dev -w @gravvia/backend

# ---- builder: full install (incl. dev) + compile TypeScript ----
FROM base AS builder
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm ci -w @gravvia/backend
COPY backend ./backend
RUN npm run build -w @gravvia/backend

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY backend/package.json ./package.json

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]
