# Workspace-aware build — BUILD CONTEXT IS THE REPO ROOT (see docker-compose.yml).
# Uses the single root package-lock.json and installs only the
# @gravvia/dashboard workspace. Runs with `next start` (robust in a monorepo).
FROM node:22-alpine AS base
WORKDIR /app

# ---- deps: production-only node_modules for runtime ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/package.json
RUN npm ci --omit=dev -w @gravvia/dashboard

# ---- builder: full install (incl. dev) + next build ----
FROM base AS builder
COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/package.json
RUN npm ci -w @gravvia/dashboard
COPY dashboard ./dashboard
# NEXT_PUBLIC_* values are inlined at BUILD time — pass the API URL as a build arg.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @gravvia/dashboard

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dashboard/.next ./.next
COPY --from=builder /app/dashboard/package.json ./package.json
COPY --from=builder /app/dashboard/next.config.js ./next.config.js
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["./node_modules/.bin/next", "start", "-p", "3000"]
