# Multi-stage build (phase 6 §8, task 6.19): compile the C++ addon in a full toolchain
# image, then ship only the compiled output and production dependencies — the runtime
# image that actually serves traffic never contains python3/make/g++.
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# binding.gyp and src/cpp copied BEFORE `npm ci`, not after — verified live: package.json's
# own `"install": "node-gyp rebuild"` script runs automatically as an npm lifecycle hook
# during `npm ci`, so if binding.gyp isn't in the build context yet at that point, that
# implicit rebuild fails immediately with "gyp: binding.gyp not found" and the whole build
# aborts before a single dependency finishes installing. This ordering lets that lifecycle
# hook do the one real compile; nothing needs to invoke node-gyp a second time afterward.
COPY package.json package-lock.json binding.gyp ./
COPY src/cpp ./src/cpp
# --legacy-peer-deps: verified live (task 6.13) against this repo's real dependency tree —
# @langchain/community's peer dependency on @browserbasehq/stagehand conflicts with this
# project's own pinned dotenv version. Neither stagehand nor the browser-automation code
# path it belongs to is imported anywhere this backend actually runs.
RUN npm ci --legacy-peer-deps

COPY src ./src
COPY scripts ./scripts
COPY bench ./bench

# ── Runtime ────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/bench ./bench

# Phase 6 §6.2's hardening extends to the container: the process that serves traffic runs
# as an unprivileged user, not root. STORAGE_DRIVER=filesystem's local directories are
# created and owned by that user up front — the S3 driver (STORAGE_DRIVER=s3, the
# production default per docker-compose.prod.yml) never touches these, but the filesystem
# driver remains valid inside this same image for a non-S3 deployment.
RUN groupadd --system cerebro \
    && useradd --system --gid cerebro --home-dir /app --no-create-home cerebro \
    && mkdir -p /app/storage/uploads /app/storage/pages \
    && chown -R cerebro:cerebro /app
USER cerebro

EXPOSE 5000

# GET /health probes every dependency concurrently and reports partial degradation —
# exactly what a container orchestrator's own healthcheck should observe (503 on a
# critical dependency down, 200 with a `degraded` body otherwise, which HEALTHCHECK's
# plain exit-code check can't distinguish from `up`; docker-compose.prod.yml's own
# healthcheck accepts that coarseness and treats non-503 as healthy).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5000/health').then(r=>process.exit(r.status===503?1:0)).catch(()=>process.exit(1))"

CMD ["node", "src/api/index.js"]
