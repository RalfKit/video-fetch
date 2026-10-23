import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadItem } from '$lib/types/download';

const dirs = vi.hoisted(() => {
	const root = `/tmp/vf-download-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return {
		root,
		downloads: `${root}/downloads`,
		temp: `${root}/incomplete`,
		bin: `${root}/yt-dlp`,
		marker: `${root}/started`
	};
});

const setStatus = vi.hoisted(() => vi.fn(async () => {}));
const updateDownload = vi.hoisted(() => vi.fn(async () => null));

vi.mock('./config', () => ({
	DOWNLOAD_FOLDER: dirs.downloads,
	TEMP_DOWNLOAD_FOLDER: dirs.temp,
	ENABLE_THUMBNAILS: false,
	DELETE_FILE_ON_DELETE: false
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
	const { YtDlp } = await import('ytdlp-nodejs');
	return { ytdlp: new YtDlp({ binaryPath: dirs.bin }) };
});

import { startDownload } from './download';

const FAKE_YTDLP = `#!/bin/sh
echo started > "$VF_MARKER"
if [ "$VF_MODE" = "fail" ]; then
  echo "ERROR: boom" >&2
  exit 1
fi
base="$VF_BASE"
prev=""
for arg in "$@"; do
  case "$prev" in
    -o|--output)
      stem=\${arg%%.%(ext)s*}
      base=$(basename "$stem")
      ;;
  esac
  case "$arg" in
    --output=*)
      value=\${arg#--output=}
      stem=\${value%%.%(ext)s*}
      base=$(basename "$stem")
      ;;
  esac
  prev="$arg"
done
mkdir -p "$VF_TEMP"
printf fake > "$VF_TEMP/$base.mp4"
exit 0
`;

function item(fileName = 'clip'): DownloadItem {
	const now = new Date();
	return {
		id: 'dl-1',
		videoUrl: 'https://example.com/clip.mp4',
		originalUrl: 'https://example.com/clip.mp4',
		source: 'manual',
		subscriptionId: null,
		profileId: 'best',
		folder: null,
		fileName,
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

async function settleOrHang(mode: 'ok' | 'fail', fileName = 'clip') {
	process.env.VF_MODE = mode;
	process.env.VF_MARKER = dirs.marker;
	process.env.VF_TEMP = dirs.temp;
	process.env.VF_BASE = 'clip';
	rmSync(dirs.marker, { force: true });

	let outcome: 'settled' | 'hung' = 'hung';
	await Promise.race([
		startDownload(item(fileName)).then(() => {
			outcome = 'settled';
		}),
		new Promise((resolve) => setTimeout(resolve, 4000))
	]);
	return outcome;
}

describe('startDownload actually starts yt-dlp', () => {
	beforeEach(() => {
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

	it('spawns yt-dlp and completes instead of staying on Downloading', async () => {
		const outcome = await settleOrHang('ok');

		expect(outcome).toBe('settled');
		expect(readFileSync(dirs.marker, 'utf8')).toContain('started');
		expect(setStatus).toHaveBeenCalledWith('dl-1', 'downloading');
		expect(setStatus).toHaveBeenCalledWith('dl-1', 'completed');
		expect(updateDownload).toHaveBeenCalledWith('dl-1', { filePath: 'clip.mp4' });
	});

	it('does not save a second extension when the requested filename already has one', async () => {
		const name = 'Tomb.Raider.King.S01E06.German.1080p.AAC.WebRip.x264-GSD.mp4';
		const outcome = await settleOrHang('ok', name);

		expect(outcome).toBe('settled');
		expect(updateDownload).toHaveBeenCalledWith('dl-1', { filePath: name });
		expect(updateDownload).not.toHaveBeenCalledWith('dl-1', { filePath: `${name}.mp4` });
	});

	it('surfaces a yt-dlp failure instead of hanging', async () => {
		const outcome = await settleOrHang('fail');

		expect(outcome).toBe('settled');
		expect(readFileSync(dirs.marker, 'utf8')).toContain('started');
		expect(setStatus).toHaveBeenCalledWith('dl-1', 'downloading');
		expect(setStatus).toHaveBeenCalledWith('dl-1', 'failed', 'ERROR: boom');
	});
});
