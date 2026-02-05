# syntax=docker/dockerfile:1
# Use Puppeteer base image which includes Chrome
# Match version to package.json puppeteer version for Chrome compatibility
FROM ghcr.io/puppeteer/puppeteer:24.36.1 AS base

# Switch to root to install bun
USER root

# Install bun
RUN npm install -g bun

WORKDIR /app

# Configure Puppeteer BEFORE install to use the correct cache location
# The base image has Chrome pre-installed in pptruser's cache, but bun install
# runs as root. Setting PUPPETEER_CACHE_DIR ensures Chrome is downloaded to
# a location accessible at runtime.
ENV PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer

# Install dependencies (with BuildKit cache mount for faster rebuilds)
COPY package.json bun.lockb* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Cloud Run expects PORT env var
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Switch back to non-root user for security
USER pptruser

CMD ["bun", "run", "src/index.ts"]
