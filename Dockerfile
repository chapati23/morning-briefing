# syntax=docker/dockerfile:1
# Use Puppeteer base image which includes Chrome
# Match version to package.json puppeteer version for Chrome compatibility
FROM ghcr.io/puppeteer/puppeteer:24.36.1 AS base

# Switch to root to install bun
USER root

# Install bun
RUN npm install -g bun

WORKDIR /app

# Install dependencies (with BuildKit cache mount for faster rebuilds)
COPY package.json bun.lockb* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Skip Chrome download during bun install - base image already has Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Note: Don't set PUPPETEER_EXECUTABLE_PATH - let Puppeteer auto-detect from cache

# Cloud Run expects PORT env var
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Switch back to non-root user for security
USER pptruser

CMD ["bun", "run", "src/index.ts"]
