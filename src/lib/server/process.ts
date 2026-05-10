import PQueue from 'p-queue';
import { downloads, paused } from '$lib/server/store';
import { get } from 'svelte/store';
import { addDownloads, findDuplicateByMediaIdentity, setStatus, updateDownload } from './db';
import type { DownloadAdd, Download } from './db/schema';
import { sanitizeFilename } from './utils';
import type { PlaylistInfo, VideoInfo } from 'ytdlp-nodejs';

type YtInfo = VideoInfo | PlaylistInfo;

const metadataQueue = new PQueue({ concurrency: 1 });
const downloadQueue = new PQueue({ concurrency: 1 });

const controllers = new Map<string, AbortController>();
const scheduled = new Set<string>();

export function setConcurrency(value: number) {
	downloadQueue.concurrency = Number(value) || 1;
}

export function setPause(isPaused: boolean) {
	if (isPaused) downloadQueue.pause();
	else downloadQueue.start();
}

function waitIfPaused() {
	return new Promise<void>((resolve) => {
		const check = () => {
			if (!get(paused)) resolve();
			else setTimeout(check, 500);
		};
		check();
	});
}

export async function removeFromQueue(id: string) {
	const controller = controllers.get(id);
	controllers.delete(id);
	scheduled.delete(id);

	if (controller) {
		try {
			setImmediate(() => {
				try {
					if (!controller.signal.aborted) controller.abort();
				} catch (err) {
					console.warn('AbortController.abort threw:', err);
				}
			});
		} catch {
			try {
				if (!controller.signal.aborted) controller.abort();
			} catch (err2) {
				console.warn('Abort failed:', err2);
			}
		}
	}

	await setStatus(id, 'cancelled', 'Cancelled by user');
}

export async function processDownloads() {
	const list = get(downloads).filter((d) => ['pending', 'queued'].includes(d.status));

	for (const item of list) {
		if (scheduled.has(item.id)) continue;
		scheduled.add(item.id);

		if (item.status === 'pending') {
			metadataQueue.add(async () => {
				try {
					await fetchMetadataAndQueue(item);
				} finally {
					scheduled.delete(item.id);
					void processDownloads();
				}
			});
		} else {
			queueDownload(item);
		}
	}
}

async function fetchMetadataAndQueue(item: Download) {
	await setStatus(item.id, 'metadata_fetching');

	try {
		const { ytdlp } = await import('./ytdlp');
		const info = (await ytdlp.getInfoAsync(item.videoUrl)) as YtInfo;

		if (isPlaylist(info) && Array.isArray(info.entries)) {
			const entries = info.entries
				.map((entry) => entryToDownload(item, entry as unknown as Record<string, unknown>))
				.filter((entry) => entry !== null);

			await addDownloads(entries);
			await updateDownload(item.id, {
				title: info.title,
				extractor: info.extractor,
				extractorVideoId: info.id,
				metadataJson: JSON.stringify({
					id: info.id,
					title: info.title,
					extractor: info.extractor,
					playlist_count: info.playlist_count
				})
			});
			await setStatus(item.id, 'completed');
			return;
		}

		const videoInfo = info as VideoInfo;
		const duplicate = await findDuplicateByMediaIdentity(videoInfo.extractor, videoInfo.id);
		if (duplicate && duplicate.id !== item.id) {
			await updateDownload(item.id, {
				title: videoInfo.title,
				extractor: videoInfo.extractor,
				extractorVideoId: videoInfo.id,
				thumbnailUrl: videoInfo.thumbnail,
				metadataJson: compactMetadata(videoInfo as unknown as Record<string, unknown>)
			});
			await setStatus(item.id, 'cancelled', 'Already downloaded or queued');
			return;
		}

		await updateDownload(item.id, {
			videoUrl: videoInfo.webpage_url || item.videoUrl,
			originalUrl: item.originalUrl ?? videoInfo.original_url ?? item.videoUrl,
			fileName: item.fileName || buildFileName(item, videoInfo.title),
			title: videoInfo.title,
			extractor: videoInfo.extractor,
			extractorVideoId: videoInfo.id,
			thumbnailUrl: videoInfo.thumbnail,
			duration: videoInfo.duration,
			metadataJson: compactMetadata(videoInfo as unknown as Record<string, unknown>)
		});
		await setStatus(item.id, 'queued');
	} catch (err) {
		const fallbackName = item.fileName || sanitizeFilename(deriveNameFromUrl(item.videoUrl));
		await updateDownload(item.id, { fileName: fallbackName });
		await setStatus(item.id, 'queued');
		console.warn('Metadata extraction failed, queued with fallback metadata:', err);
	}
}

function queueDownload(item: Download) {
	const controller = new AbortController();
	controllers.set(item.id, controller);

	downloadQueue.add(async () => {
		await waitIfPaused();
		if (controller.signal.aborted) return;

		const latest = get(downloads).find((download) => download.id === item.id);
		if (!latest || latest.status !== 'queued') return;

		try {
			const { startDownload } = await import('./download');
			await startDownload(latest, controller.signal);
		} catch (err) {
			console.warn('startDownload failed for', item.id, err);
			await setStatus(item.id, 'failed', (err as Error).message);
		} finally {
			controllers.delete(item.id);
			scheduled.delete(item.id);
		}
	});
}

function entryToDownload(parent: Download, entry: Record<string, unknown>): DownloadAdd | null {
	const entryUrl = stringOrNull(entry.webpage_url) || stringOrNull(entry.url) || stringOrNull(entry.id);
	if (!entryUrl) return null;

	const title = stringOrNull(entry.title);
	const extractor = stringOrNull(entry.extractor) || parent.extractor;
	const extractorVideoId = stringOrNull(entry.id);
	const thumbnailUrl = stringOrNull(entry.thumbnail);

	return {
		videoUrl: entryUrl,
		originalUrl: entryUrl,
		source: parent.source,
		subscriptionId: parent.subscriptionId,
		profileId: parent.profileId,
		folder: parent.folder,
		fileName: title ? buildFileName(parent, title) : parent.fileName,
		appendTitle: parent.appendTitle,
		quality: parent.quality,
		status: 'pending',
		title,
		extractor,
		extractorVideoId,
		thumbnailUrl,
		advancedOptionsJson: parent.advancedOptionsJson
	} satisfies DownloadAdd;
}

function buildFileName(item: Pick<Download, 'fileName' | 'appendTitle'>, title: string | null) {
	const safeTitle = sanitizeFilename(title || 'video');
	if (item.fileName && item.appendTitle && item.fileName !== safeTitle) {
		return sanitizeFilename(`${item.fileName} - ${safeTitle}`);
	}
	return item.fileName || safeTitle;
}

function deriveNameFromUrl(videoUrl: string): string {
	try {
		const u = new URL(videoUrl);
		const v = u.searchParams.get('v');
		if (v) return v;
		const parts = u.pathname.split('/').filter(Boolean);
		if (parts.length > 0) return parts[parts.length - 1];
	} catch {
		/* ignore */
	}
	return 'video';
}

function compactMetadata(info: Record<string, unknown>) {
	return JSON.stringify({
		id: info.id,
		title: info.title,
		extractor: info.extractor,
		uploader: info.uploader,
		channel: info.channel,
		duration: info.duration,
		upload_date: info.upload_date,
		webpage_url: info.webpage_url
	});
}

function stringOrNull(value: unknown) {
	return typeof value === 'string' && value.trim() ? value : null;
}

function isPlaylist(info: YtInfo): info is PlaylistInfo {
	return info._type === 'playlist';
}
