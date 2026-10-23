import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadItem } from '$lib/types/download';
import { inactivityFailureMessage } from './inactivity-timeout';

const dirs = vi.hoisted(() => {
	const root = `/tmp/vf-inactivity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return {
		root,
		downloads: `${root}/downloads`,
		temp: `${root}/incomplete`,
		bin: `${root}/yt-dlp`,
		marker: `${root}/started`
	};
});

const runtime = vi.hoisted(() => ({ timeoutMs: 400 }));
const setStatus = vi.hoisted(() => vi.fn(async () => {}));
const updateDownload = vi.hoisted(() => vi.fn(async () => null));

vi.mock('./config', () => ({
	DOWNLOAD_FOLDER: dirs.downloads,
	TEMP_DOWNLOAD_FOLDER: dirs.temp,
	ENABLE_THUMBNAILS: false,
	DELETE_FILE_ON_DELETE: false,
	downloadInactivityTimeoutMs: () => runtime.timeoutMs
}));

vi.mock('./db', () => ({
	setStatus,
	updateDownload
}));

vi.mock('./store', () => ({
	downloads: { update: (fn: (items: unknown[]) => unknown[]) => fn([]) }
}));

vi.mock('./folders', () => ({
	ensureExistingDownloadFolder: async () => dirs.downloads
}));

vi.mock('./ytdlp', async () => {
	const { chmodSync, mkdirSync, writeFileSync } = await import('node:fs');
	mkdirSync(dirs.root, { recursive: true });
	writeFileSync(dirs.bin, '#!/bin/sh\nexit 0\n');
	chmodSync(dirs.bin, 0o755);
	const { YtDlp } = await import('ytdlp-nodejs');
	return { ytdlp: new YtDlp({ binaryPath: dirs.bin }) };
});

import { startDownload } from './download';

const FAKE_YTDLP = `#!/bin/sh
echo started > "$VF_MARKER"
if [ "$VF_MODE" = "stall" ]; then
  # Replace the shell so SIGKILL closes stdio immediately.
  exec sleep 30
fi
if [ "$VF_MODE" = "ticks" ]; then
  i=0
  while [ "$i" -lt 6 ]; do
    echo "tick $i" >&2
    i=$((i + 1))
    sleep 0.2
  done
  mkdir -p "$VF_TEMP"
  printf fake > "$VF_TEMP/$VF_BASE.mp4"
  exit 0
fi
exit 1
`;

function item(): DownloadItem {
	const now = new Date();
	return {
		id: 'dl-1',
		videoUrl: 'https://example.com/clip.mp4',
		originalUrl: 'https://example.com/clip.mp4',
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
		filenameKey: null,
		createdAt: now,
		updatedAt: now,
		finishedAt: null,
		progress: null
	};
}

async function settleOrHang(mode: string, signal?: AbortSignal) {
	process.env.VF_MODE = mode;
	process.env.VF_MARKER = dirs.marker;
	process.env.VF_TEMP = dirs.temp;
	process.env.VF_BASE = 'clip';
	rmSync(dirs.marker, { force: true });

	let outcome: 'settled' | 'hung' = 'hung';
	await Promise.race([
		startDownload(item(), signal).then(() => {
			outcome = 'settled';
		}),
		new Promise((resolve) => setTimeout(resolve, 4000))
	]);
	return outcome;
}

describe('download inactivity watchdog', () => {
	beforeEach(() => {
		runtime.timeoutMs = 400;
		mkdirSync(dirs.downloads, { recursive: true });
		mkdirSync(dirs.temp, { recursive: true });
		writeFileSync(dirs.bin, FAKE_YTDLP);
		chmodSync(dirs.bin, 0o755);
		setStatus.mockClear();
		updateDownload.mockClear();
	});

	afterEach(() => {
		delete process.env.VF_MODE;
		delete process.env.VF_MARKER;
		delete process.env.VF_TEMP;
		delete process.env.VF_BASE;
		rmSync(dirs.root, { recursive: true, force: true });
		mkdirSync(dirs.root, { recursive: true });
	});

	it('stops a yt-dlp process that never reports progress', async () => {
		const outcome = await settleOrHang('stall');

		expect(outcome).toBe('settled');
		expect(readFileSync(dirs.marker, 'utf8')).toContain('started');
		expect(setStatus).toHaveBeenCalledWith('dl-1', 'downloading');
		expect(setStatus).toHaveBeenCalledWith('dl-1', 'failed', inactivityFailureMessage(400, true));
	});

	it('keeps a download that is still writing output', async () => {
		const outcome = await settleOrHang('ticks');

		expect(outcome).toBe('settled');
		expect(setStatus).toHaveBeenCalledWith('dl-1', 'completed');
		expect(setStatus).not.toHaveBeenCalledWith(
			'dl-1',
			'failed',
			expect.stringContaining('DOWNLOAD_INACTIVITY_TIMEOUT')
		);
	});

	it('does not stop a silent process when the watchdog is disabled', async () => {
		runtime.timeoutMs = 0;
		const controller = new AbortController();
		const pending = settleOrHang('stall', controller.signal);
		await new Promise((resolve) => setTimeout(resolve, 500));

		expect(setStatus).not.toHaveBeenCalledWith(
			'dl-1',
			'failed',
			expect.stringContaining('DOWNLOAD_INACTIVITY_TIMEOUT')
		);
		controller.abort();
		await pending;
		expect(setStatus).toHaveBeenCalledWith('dl-1', 'cancelled', 'Cancelled by user');
	});
});
