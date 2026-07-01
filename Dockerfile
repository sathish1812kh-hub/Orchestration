# ── BUILD STAGE ──
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source code and configurations
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript
RUN npm run build

# Remove development dependencies to keep production footprint minimal
RUN npm prune --production


# ── RUNTIME STAGE ──
FROM node:20-bookworm-slim AS runner
WORKDIR /app

# Install standard system utilities (bash, git, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled files and production modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY config.json ./config.json

# Environment variables defaults
ENV PORT=5000 \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    LOG_LEVEL=info \
    PLUGIN_DIRECTORY=/app/plugins

# Create plugins directory and verify write permission
RUN mkdir -p /app/plugins

# Expose HTTP port (Express / SSE endpoints)
EXPOSE 5000

# Default entrypoint starts the HTTP/Express/ngrok server
# For Claude Desktop / Stdio mode, mount this container and run with "--stdio" argument
CMD ["node", "dist/index.js"]
