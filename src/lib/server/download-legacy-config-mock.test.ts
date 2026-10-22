import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DownloadItem } from '$lib/types/download';

const dirs = vi.hoisted(() => {
	const root = `/tmp/vf-legacy-config-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return {
		root,
		downloads: `${root}/downloads`,
		temp: `${root}/incomplete`,
		bin: `${root}/yt-dlp`
	};
});

const setStatus = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('./config', () => ({
	DOWNLOAD_FOLDER: dirs.downloads,
	TEMP_DOWNLOAD_FOLDER: dirs.temp,
	ENABLE_THUMBNAILS: false,
	DELETE_FILE_ON_DELETE: false
}));

vi.mock('./db', () => ({
	setStatus,
	updateDownload: vi.fn(async () => null)
}));

vi.mock('./store', () => ({
	downloads: { update: (fn: (items: unknown[]) => unknown[]) => fn([]) }
}));

vi.mock('./folders', () => ({
	ensureExistingDownloadFolder: async () => dirs.downloads
}));

vi.mock('./ytdlp', async () => {
	const { chmodSync: chmod, mkdirSync: mkdir, writeFileSync: write } = await import('node:fs');
	mkdir(dirs.root, { recursive: true });
	write(dirs.bin, '#!/bin/sh\nexit 0\n');
	chmod(dirs.bin, 0o755);
	const { YtDlp } = await import('ytdlp-nodejs');
	return { ytdlp: new YtDlp({ binaryPath: dirs.bin }) };
});

import { startDownload } from './download';

describe('config mock without the inactivity helper', () => {
	it('still completes a download that exits immediately', async () => {
		mkdirSync(dirs.downloads, { recursive: true });
		mkdirSync(dirs.temp, { recursive: true });
		writeFileSync(
			dirs.bin,
			`#!/bin/sh
mkdir -p "$VF_TEMP"
printf fake > "$VF_TEMP/clip.mp4"
exit 0
`
		);
		chmodSync(dirs.bin, 0o755);
		process.env.VF_TEMP = dirs.temp;

		const now = new Date();
		const item: DownloadItem = {
			id: 'dl-legacy',
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
			createdAt: now,
			updatedAt: now,
			finishedAt: null,
			progress: null
		};

		let outcome: 'settled' | 'hung' = 'hung';
		await Promise.race([
			startDownload(item).then(() => {
				outcome = 'settled';
			}),
			new Promise((resolve) => setTimeout(resolve, 4000))
		]);

		expect(outcome).toBe('settled');
		expect(setStatus).toHaveBeenCalledWith('dl-legacy', 'completed');
		rmSync(dirs.root, { recursive: true, force: true });
		delete process.env.VF_TEMP;
	});
});
