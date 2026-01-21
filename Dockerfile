# Multi-stage Dockerfile for Industrial Property Scout MCP Server
# Stage 1: Build TypeScript project
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy source code first (needed before npm ci due to prepare script)
COPY src ./src

# Install dependencies and build
RUN npm ci

# Stage 2: Slim runtime with Playwright
FROM node:20-bookworm-slim AS runtime

# Install Playwright system dependencies
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Remove prepare script to prevent 'npm ci' from running tsc (dev dependency)
RUN npm pkg delete scripts.prepare

# Install production dependencies (allow scripts to run so better-sqlite3 fetches pre-built binary)
RUN npm ci --omit=dev

# Install Playwright browsers (chromium only)
RUN npx playwright install chromium --with-deps

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Set environment variables
ENV NODE_ENV=production

# Run the MCP server via stdio
ENTRYPOINT ["node", "dist/index.js"]
