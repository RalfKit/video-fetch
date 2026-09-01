# syntax=docker/dockerfile:1

# --- Base: pinned pnpm + manifests (shared by build and prod-deps) ---
FROM node:25.9.0-slim AS base
WORKDIR /app
ENV CI=true

# Pin pnpm for reproducible builds. An unpinned "latest" pnpm previously broke
# the build once pnpm 11 changed how unapproved dependency build scripts are
# handled.
RUN npm install -g pnpm@10.33.3

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

# --- Build: full dependencies (incl. dev) + compile the SvelteKit app ---
FROM base AS build
RUN pnpm install --frozen-lockfile --prod=false --node-linker=hoisted
COPY . .
RUN pnpm build

# --- Prod dependencies: a clean, production-only node_modules ---
# Installed separately so no dev/test tooling (vitest, eslint, svelte, vite, …)
# leaks into the runtime image. A plain `pnpm prune` is unreliable with the
# hoisted linker and leaves hoisted transitive dev packages behind.
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --node-linker=hoisted

# --- Runtime ---
FROM node:25.9.0-slim AS runtime
WORKDIR /app

# Runtime system dependencies only:
#   - ffmpeg: muxing/merging for yt-dlp (its shared libraries are the single
#     largest contributor to image size, kept via apt for reliability)
#   - curl + ca-certificates: fetch yt-dlp and power the Docker HEALTHCHECK
# (Deno and unzip were previously installed here but are unused by the app.)
#
# The standalone `yt-dlp_linux` PyInstaller build is used instead of the plain
# `yt-dlp` zipapp: the latter needs a system `python3`, which is not present in
# the slim Node base image (downloads would fail with "python3: not found").
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && curl -fL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Application build output, production-only dependencies and migrations.
COPY --from=build /app/build build/
COPY --from=prod-deps /app/node_modules node_modules/
COPY --from=build /app/drizzle drizzle/
COPY package.json drizzle.config.ts ./

# SQLite data directory (mount as a volume for persistence).
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PUBLIC_DEFAULT_CONCURRENCY=1
ENV PUBLIC_MAX_CONCURRENCY=5
ENV DOWNLOAD_PATH=/downloads
ENV TEMP_DOWNLOAD_PATH=/downloads/.incomplete
ENV DATABASE_PATH=/data/downloads.db

EXPOSE 3000

# Application-level health check: verifies the process is up and the database is
# reachable. It does not touch yt-dlp, ffmpeg, the network, or run a download.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:3000/api/health || exit 1

# Apply database migrations, then start the server.
CMD ["sh", "-c", "npx drizzle-kit migrate --config drizzle.config.ts && node build"]
