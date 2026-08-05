# syntax=docker/dockerfile:1
FROM oven/bun:1.3.9-slim AS base

WORKDIR /app

# Install dependencies (with BuildKit cache mount for faster rebuilds)
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Production defaults
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e 'const response = await fetch("http://localhost:8080/health"); process.exit(response.ok ? 0 : 1)'

USER bun

CMD ["bun", "run", "src/index.ts"]
