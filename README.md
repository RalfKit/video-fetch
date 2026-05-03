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

## ⚙️ Configuration

### `DOWNLOAD_PATH`

Directory where downloaded files are stored.

Recommended: mount as persistent Docker volume.

```yaml
volumes:
  - ./downloads:/downloads
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

Adds one or multiple video download jobs.

**Payload:**

```json
[
  {
    "videoUrl": "https://example.com/video.mp4",
    "fileName": "Video1",
    "appendTitle": false,
    "quality": "highest"
  }
]
```

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
      - "3000:3000"
    volumes:
      - ./downloads:/downloads
      - ./data/downloads.db:/data/downloads.db
```

## ⚠️ Notes

- This project is experimental and self-hosted
- Stability depends on external tools such as yt-dlp
- Intended for personal or controlled environments

## 📦 Stack

- SvelteKit
- Node.js backend
- yt-dlp
- Docker

## 📌 Status

Experimental project.
No strict production guarantees.
