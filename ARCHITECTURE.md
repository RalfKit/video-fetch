# Video Fetcher Architecture Notes

## Current Service Boundaries

- `downloads-helper.ts`: fast payload validation and queue item creation. It does not fetch metadata.
- `process.ts`: unified queue pipeline for manual adds, API adds, extension-style adds, and subscriptions.
- `download.ts`: yt-dlp execution, progress updates, temp-folder output, and final-file promotion.
- `folders.ts`: safe relative folder listing and validation under `DOWNLOAD_PATH`.
- `profiles.ts`: user-friendly download profiles mapped to yt-dlp options.
- `subscriptions.ts`: subscription persistence, polling, and queue enqueueing.
- Subscription onboarding fetches flat metadata, stores a checkpoint, and only enqueues the requested import slice. The default mode records existing entries without queueing them.
- `scheduler.ts`: configurable concurrency windows via `CONCURRENCY_WINDOWS`.

## Schema Direction

The `0001_queue_architecture` migration keeps the existing `downloads` table and adds queue metadata, source tracking, media identity fields, thumbnail/archive metadata, profile references, folder selection, and advanced option storage.

New tables:

- `download_profiles`: optional custom profile storage. Built-in profiles live in code for now.
- `subscriptions`: channel/playlist subscriptions with polling interval, start time, folder, and profile.

Future migrations worth considering:

- Move extractor identity into a dedicated `media_items` table if history becomes large.
- Add a real `queue_events` table for audit/debug logs.
- Add `subscription_items` to track every seen video without relying only on downloads.
- Promote subscription checkpoints into a normalized table if channels with more than the current checkpoint window need exact long-term seen-state.

## Technical Debt

- The Svelte store still bridges runtime state and database state. A future pass should move queue state into a dedicated event emitter/service and let SSE subscribe to that service.
- `ytdlp-nodejs` is wrapped directly. A thin local adapter would make CLI behavior easier to test.
- Subscriptions currently enqueue the subscription URL and let metadata expansion discover entries. This keeps one pipeline, but a later optimization could use flat playlist IDs before inserting child jobs.
- Build-time imports are now guarded/lazy, but more route modules still import runtime services directly.

## Folder Structure Direction

Suggested long-term split:

- `src/lib/server/queue`: queue orchestration, worker lifecycle, cancellation.
- `src/lib/server/downloads`: download execution, metadata extraction, duplicate detection.
- `src/lib/server/library`: archive/history queries and media serving helpers.
- `src/lib/server/subscriptions`: polling and subscription checks.
- `src/lib/server/settings`: profiles, folders, scheduler windows.

Keep the app lightweight: avoid adding a job broker or separate worker process until SQLite plus in-process queues stop being enough.
