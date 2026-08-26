# Video Fetcher

[![Docker Pulls](https://img.shields.io/docker/pulls/blacktiger001/videofetch.svg)](https://hub.docker.com/r/blacktiger001/videofetch)

A web-based video download service powered by **yt-dlp** and a **SvelteKit** frontend.

## 📌 Overview

Video Fetcher is a self-hosted web application for downloading videos from URLs with configurable quality, naming, and concurrency control.

It is designed as a lightweight alternative to manual video downloading workflows, providing both a UI and a simple HTTP API.

## ✨ Features

- Add video URLs via web interface or API
- Download videos in different quality modes (`highest`, `lowest`)
- Custom filenames or automatic title-based naming
- Real-time download status updates (SSE)
- Queue-based download handling with concurrency control
- Separate views for active and completed downloads
- Async metadata fetching so add requests return immediately
- Optional safe subfolders under `DOWNLOAD_PATH`
- Download profiles, subscriptions, and searchable archive playback
- Subscription onboarding modes that default to future uploads only

## ⚙️ Configuration

### `DOWNLOAD_PATH`

Directory where downloaded files are stored.

Recommended: mount as persistent Docker volume.

```yaml
volumes:
  - ./downloads:/downloads
```

### `TEMP_DOWNLOAD_PATH`

Directory used for incomplete yt-dlp output and temporary fragments. Completed files are moved into `DOWNLOAD_PATH` only after yt-dlp exits successfully.

```env
TEMP_DOWNLOAD_PATH=/downloads/.incomplete
```

### `DATABASE_PATH`

Path for internal database storage.

```yaml
volumes:
  - ./data/downloads.db:/data/downloads.db
```

### `PUBLIC_DEFAULT_CONCURRENCY`

Default number of parallel downloads.

- Default: `1`

```env
PUBLIC_DEFAULT_CONCURRENCY=2
```

### `PUBLIC_MAX_CONCURRENCY`

Maximum allowed concurrent downloads in UI.

- Default: `3`

```env
PUBLIC_MAX_CONCURRENCY=5
```

### `CONCURRENCY_WINDOWS`

Optional comma-separated time windows that override download concurrency by local server time.

```env
CONCURRENCY_WINDOWS="01:00-05:00=5,05:00-01:00=1"
```

### `DELETE_FILE_ON_DELETE`

Controls what happens to the downloaded file when a completed download entry is deleted.

- Default: `false` — only the database entry is removed; the file is kept.
- When `true`, the associated file is also deleted.

Deletion is strictly confined to `DOWNLOAD_PATH`: path traversal (`..`) and absolute paths are rejected, so no file outside `DOWNLOAD_PATH` can be removed.

```env
DELETE_FILE_ON_DELETE=true
```

### `YTDLP_PATH` / `FFMPEG_PATH`

Optional explicit paths to the `yt-dlp` and `ffmpeg` binaries.

When unset, the app uses `/usr/local/bin` (production image) or `/usr/bin` if present, and otherwise falls back to the `yt-dlp` binary bundled with `ytdlp-nodejs` and `ffmpeg` from `PATH`. This works across local development, Docker, and Linux/macOS/Windows without per-machine tweaks.

```env
YTDLP_PATH="/usr/local/bin/yt-dlp"
FFMPEG_PATH="/usr/local/bin/ffmpeg"
```

## Subscriptions

New subscriptions default to **Only new uploads**. On creation, Video Fetcher fetches feed metadata, stores a checkpoint, and avoids queueing the creator's historical archive.

Optional initial import modes are available:

- Last X days
- Last X videos
- Full archive import

Subscriptions can also filter before enqueueing by excluding Shorts, duration limits, and simple include/exclude keyword lists.

## 🚀 Usage

1. Start the container (Docker or Docker Compose)
2. Open `http://localhost:3000`
3. Add video URLs
4. Select quality and optional filename settings
5. Monitor download progress in real time

## 🌐 API

### GET `/api/downloads`

Server-Sent Events (SSE) stream for live download updates.

```javascript
const eventSource = new EventSource('/api/downloads');

eventSource.onmessage = (event) => {
	console.log(JSON.parse(event.data));
};
```

### POST `/api/add`

Adds one or multiple video download jobs. The endpoint validates basic payload shape, stores queue items, and returns before metadata extraction starts.

**Payload:**

```json
[
	{
		"videoUrl": "https://example.com/video.mp4",
		"fileName": "Video1",
		"appendTitle": false,
		"profileId": "best",
		"folder": "Creator Name"
	}
]
```

### GET `/api/folders`

Lists existing subfolders under `DOWNLOAD_PATH` for safe folder selection.

## 🐳 Docker

### Run container

```bash
docker run -d \
  --name videofetch \
  -p 3000:3000 \
  -v /absolute/path/to/downloads:/downloads \
  -v /absolute/path/to/data/downloads.db:/data/downloads.db \
  blacktiger001/videofetch
```

### Docker Compose

```yaml
services:
  videofetch:
    image: blacktiger001/videofetch
    container_name: videofetch
    restart: unless-stopped
    ports:
      - '3000:3000'
    volumes:
      - ./downloads:/downloads
      - ./data/downloads.db:/data/downloads.db
```

## ⚠️ Notes

- This project is experimental and self-hosted
- Stability depends on external tools such as yt-dlp
- Intended for personal or controlled environments

## 🛠️ Development

```bash
pnpm install      # install dependencies
pnpm dev          # start the dev server
pnpm lint         # prettier --check + eslint
pnpm check        # svelte-check / type check
pnpm test         # vitest unit tests
pnpm build        # production build (adapter-node)
```

## 🔁 CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `main`: format/lint, type check, unit tests, plus a Docker image build with a startup/health smoke test.
- **Dependency updates** are handled by Dependabot (`.github/dependabot.yml`) on a monthly schedule. Application dependencies are opened as individual PRs so a single failing update never blocks the others; security updates are opened independently and can be released early. Non-major update PRs are auto-merged once CI passes (`.github/workflows/dependabot-auto-merge.yml`).
- **Releases** (`.github/workflows/release.yml`) are **not** cut on every merge. They run on a monthly schedule (and can be triggered manually via _workflow_dispatch_ for early/security releases), so several successful changes are collected into one release. [semantic-release](https://semantic-release.gitbook.io/) derives the version from [Conventional Commits](https://www.conventionalcommits.org/), updates `CHANGELOG.md` and `package.json`, creates the Git tag + GitHub release, and builds and pushes the versioned Docker image.

### Required repository configuration

- Secrets: `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (Docker Hub publish).
- Enable **Allow auto-merge** in the repository settings and protect `main` with the **CI** checks required, so `main` is only updated through green CI and Dependabot auto-merge works as intended.
- The release job pushes a version commit and tag to `main`. If `main` is protected, allow the Actions bot to bypass the protection (or provide a `GH_TOKEN` PAT with push access) so `semantic-release` can publish.

## 📦 Stack

- SvelteKit
- Node.js backend
- yt-dlp
- Docker

## 📌 Status

Experimental project.
No strict production guarantees.
