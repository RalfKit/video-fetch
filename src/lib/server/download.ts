import { exec as execChild } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { DOWNLOAD_FOLDER, TEMP_DOWNLOAD_FOLDER, ENABLE_THUMBNAILS } from './config';
import { setStatus, updateDownload } from './db';
import type { AdvancedOptions, DownloadItem } from '$lib/types/download';
import { downloads } from './store';
import { ytdlp } from './ytdlp';
import type { ArgsOptions, VideoProgress } from 'ytdlp-nodejs';
import { getBuiltinProfile, parseProfileOptions } from './profiles';
import { ensureExistingDownloadFolder } from './folders';
import { sanitizeFilename } from './utils';

export async function startDownload(item: DownloadItem, signal?: AbortSignal): Promise<void> {
	const stderrBuffer: string[] = [];
	const targetFolder = await ensureExistingDownloadFolder(item.folder);
	const outputBase = `${sanitizeFilename(item.fileName || item.title || item.extractorVideoId || item.id)}`;
	const tempOutput = path.join(TEMP_DOWNLOAD_FOLDER, `${outputBase}.%(ext)s`);

	await setStatus(item.id, 'downloading');

	const options: ArgsOptions = {
		...buildYtDlpOptions(item),
		output: tempOutput,
		paths: { temp: TEMP_DOWNLOAD_FOLDER },
		progress: true,
		abortOnError: true,
		noPart: false
	};

	const download = ytdlp.download(item.videoUrl, options);
	let finished = false;
	let killed = false;

	const onAbort = () => {
		if (finished) return;

		setImmediate(() => {
			try {
				if (!killed) {
					killed = true;
					if (process.platform === 'win32' && download.pid !== undefined) {
						execChild(`taskkill /PID ${download.pid} /T /F`, () => {});
					} else {
						download.kill('SIGKILL');
					}
				}
			} catch (err) {
				console.warn('Failed to kill child process:', err);
			}
		});
	};

	download.on('stderr', (data) => {
		const msg = data.trim();
		if (msg) {
			stderrBuffer.push(msg);
			console.error('[yt-dlp]', msg);
		}
	});

	download.on('progress', (progress: VideoProgress) => {
		downloads.update((items) => items.map((d) => (d.id === item.id ? { ...d, progress } : d)));
	});

	if (signal?.aborted) {
		await setStatus(item.id, 'cancelled', 'Cancelled by user');
		return;
	}
	signal?.addEventListener('abort', onAbort, { once: true });

	return await new Promise<void>((resolve) => {
		const settle = () => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		};

		const markFinished = () => {
			if (finished) return false;
			finished = true;
			return true;
		};

		// ytdlp-nodejs 3.4 returns a builder. run() starts the process and
		// emits finish on success. A non-zero exit emits error and rejects.
		download.on('finish', () => {
			if (!markFinished()) return;
			void (async () => {
				try {
					const finalFile = await moveCompletedFile(outputBase, targetFolder);
					await updateDownload(item.id, {
						filePath: path.relative(DOWNLOAD_FOLDER, finalFile).replaceAll(path.sep, '/')
					});
					await setStatus(item.id, 'completed');
				} catch (err) {
					await setStatus(item.id, 'failed', (err as Error).message);
				}
				settle();
			})();
		});

		const fail = () => {
			if (!markFinished()) return;
			void (async () => {
				if (signal?.aborted || killed) {
					await setStatus(item.id, 'cancelled', 'Cancelled by user');
				} else {
					const errorMsg =
						stderrBuffer.filter((v) => v.startsWith('ERROR')).join('\n') || undefined;
					await setStatus(item.id, 'failed', errorMsg);
				}
				settle();
			})();
		};

		download.on('error', fail);
		const running = download.run();
		running.catch(fail);
		if (signal?.aborted) {
			killed = true;
			download.kill('SIGKILL');
		}
	});
}

function buildYtDlpOptions(item: DownloadItem): ArgsOptions {
	const profile = getBuiltinProfile(item.profileId ?? item.quality);
	const profileOptions = parseProfileOptions(profile);
	const advanced = parseAdvancedOptions(item.advancedOptionsJson);

	return {
		...profileOptions,
		// Never download thumbnail sidecars when thumbnails are disabled, even if a
		// profile (e.g. "archive") requests them.
		...(ENABLE_THUMBNAILS ? {} : { writeThumbnail: false }),
		...(advanced.embedSubtitles ? { embedSubs: true, writeSubs: true } : {}),
		...(advanced.retries !== undefined ? { retries: advanced.retries } : {}),
		...(advanced.rateLimit ? { limitRate: advanced.rateLimit } : {}),
		...(advanced.postprocessors?.length ? { usePostProcessor: advanced.postprocessors } : {}),
		...(advanced.extractorArgs ? { extractorArgs: advanced.extractorArgs } : {}),
		additionalOptions: advanced.customArgs ?? profileOptions.additionalOptions
	};
}

function parseAdvancedOptions(input?: string | null): AdvancedOptions {
	if (!input) return {};
	try {
		return JSON.parse(input) as AdvancedOptions;
	} catch {
		return {};
	}
}

async function moveCompletedFile(outputBase: string, targetFolder: string) {
	const entries = await fs.readdir(TEMP_DOWNLOAD_FOLDER, { withFileTypes: true });
	const candidates = entries
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.filter(
			(name) =>
				name.startsWith(`${outputBase}.`) && !name.endsWith('.part') && !name.endsWith('.ytdl')
		)
		.sort((a, b) => b.length - a.length);

	const media = candidates.find((name) => isPlayableMedia(name)) ?? candidates[0];
	if (!media) throw new Error('Download completed, but no output file was found');

	const source = path.join(TEMP_DOWNLOAD_FOLDER, media);
	const destination = await nextAvailablePath(path.join(targetFolder, media));
	await moveFile(source, destination);

	for (const sidecar of candidates.filter((name) => name !== media)) {
		await moveFile(
			path.join(TEMP_DOWNLOAD_FOLDER, sidecar),
			await nextAvailablePath(path.join(targetFolder, sidecar))
		);
	}

	return destination;
}

function isPlayableMedia(fileName: string) {
	return /\.(mp4|webm|mkv|mov|avi|mp3|m4a|opus|flac|wav|ogg)$/i.test(fileName);
}

async function nextAvailablePath(candidate: string) {
	try {
		await fs.access(candidate);
	} catch {
		return candidate;
	}

	const parsed = path.parse(candidate);
	for (let i = 1; i < 1000; i++) {
		const next = path.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`);
		try {
			await fs.access(next);
		} catch {
			return next;
		}
	}

	throw new Error('Could not find a free filename');
}

async function moveFile(source: string, destination: string) {
	await fs.mkdir(path.dirname(destination), { recursive: true });
	try {
		await fs.rename(source, destination);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'EXDEV') throw err;
		await fs.copyFile(source, destination);
		await fs.unlink(source);
	}
}
