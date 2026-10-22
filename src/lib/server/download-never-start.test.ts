import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadItem } from '$lib/types/download';
import { inactivityFailureMessage } from './inactivity-timeout';

const fake = vi.hoisted(() => {
	const state = {
		killed: false,
		handlers: {} as Record<string, (...args: unknown[]) => void>
	};
	const setStatus = vi.fn(async () => {});
	const download = {
		on(event: string, listener: (...args: unknown[]) => void) {
			state.handlers[event] = listener;
			return download;
		},
		run: () => new Promise<void>(() => {}),
		kill: () => {
			state.killed = true;
			return true;
		},
		pid: undefined as number | undefined
	};
	return { state, setStatus, download };
});

vi.mock('./config', () => ({
	DOWNLOAD_FOLDER: '/tmp/vf-never/downloads',
	TEMP_DOWNLOAD_FOLDER: '/tmp/vf-never/incomplete',
	ENABLE_THUMBNAILS: false,
	DELETE_FILE_ON_DELETE: false,
	downloadInactivityTimeoutMs: () => 300
}));

vi.mock('./db', () => ({
	setStatus: fake.setStatus,
	updateDownload: vi.fn(async () => null)
}));

vi.mock('./store', () => ({
	downloads: { update: (fn: (items: unknown[]) => unknown[]) => fn([]) }
}));

vi.mock('./folders', () => ({
	ensureExistingDownloadFolder: async () => '/tmp/vf-never/downloads'
}));

vi.mock('./ytdlp', () => ({
	ytdlp: { download: () => fake.download }
}));

import { startDownload } from './download';

function item(): DownloadItem {
	const now = new Date();
	return {
		id: 'dl-never',
		videoUrl: 'https://example.com/clip.mp4',
		originalUrl: null,
		source: 'manual',
		subscriptionId: null,
		profileId: 'best',
		folder: null,
		fileName: 'clip',
		appendTitle: false,
		quality: 'best',
		status: 'queued',
		errorMessage: null,
		title: 'clip',
		extractor: null,
		extractorVideoId: null,
		thumbnailUrl: null,
		duration: null,
		filePath: null,
		metadataJson: null,
		advancedOptionsJson: null,
		canonicalUrl: null,
		mediaKey: null,
		createdAt: now,
		updatedAt: now,
		finishedAt: null,
		progress: null
	};
}

describe('download that never starts', () => {
	afterEach(() => {
		fake.state.killed = false;
		fake.setStatus.mockClear();
	});

	it('fails the job when run() never emits output', async () => {
		let outcome: 'settled' | 'hung' = 'hung';
		await Promise.race([
			startDownload(item()).then(() => {
				outcome = 'settled';
			}),
			new Promise((resolve) => setTimeout(resolve, 2000))
		]);

		expect(outcome).toBe('settled');
		expect(fake.state.killed).toBe(true);
		expect(fake.setStatus).toHaveBeenCalledWith(
			'dl-never',
			'failed',
			inactivityFailureMessage(300, false)
		);
	});
});
