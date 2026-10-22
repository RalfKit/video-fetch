import type { DownloadStatus } from '$lib/types/download';

/** How long a finished job stays on the SSE stream so the client can show the final state. */
export const LIVE_UPDATE_WINDOW_MS = 2000;

const LIVE_STATUSES = new Set<DownloadStatus>([
	'downloading',
	'pending',
	'metadata_fetching',
	'queued'
]);

/**
 * Jobs the `/api/downloads` stream should emit.
 *
 * Failed, completed, and cancelled jobs are included only during the short
 * window after `finishedAt`. A stalled download that has been marked failed
 * therefore stops being sent, same as any other failure.
 */
export function isLiveDownloadUpdate(
	item: { status: DownloadStatus; finishedAt: Date | null },
	now: number
): boolean {
	if (LIVE_STATUSES.has(item.status)) return true;
	return Boolean(item.finishedAt && now - item.finishedAt.getTime() < LIVE_UPDATE_WINDOW_MS);
}
