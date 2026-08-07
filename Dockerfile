# syntax=docker/dockerfile:1
FROM oven/bun:1.3.9-slim@sha256:8ca06c7812d9050ccc4b80799685f395d6a0d051d3b7207dfd120e2b437b1ec9 AS base

WORKDIR /app

# Puppeteer downloads Chrome during `bun install`. Keep it in the application
# directory so the non-root runtime user can find and execute it.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Chrome's shared-library and font dependencies. The process still runs as the
# unprivileged `bun` user below; Cloud Run provides the outer sandbox.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (with BuildKit cache mount for faster rebuilds)
COPY package.json bun.lock ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# Copy source
COPY src ./src
COPY tsconfig.json ./

# `bun install` runs as root during the image build, while Cloud Run executes
# the service as `bun`. Hand the downloaded browser and source tree over before
# dropping privileges.
RUN chown -R bun:bun /app

# Production defaults
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e 'const response = await fetch("http://localhost:8080/health"); process.exit(response.ok ? 0 : 1)'

USER bun

CMD ["bun", "run", "src/index.ts"]
