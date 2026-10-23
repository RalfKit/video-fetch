import { exec as execChild } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { DOWNLOAD_FOLDER, TEMP_DOWNLOAD_FOLDER, ENABLE_THUMBNAILS } from './config';
import * as downloadConfig from './config';
import { setStatus, updateDownload } from './db';
import type { AdvancedOptions, DownloadItem } from '$lib/types/download';
import { downloads } from './store';
import { ytdlp } from './ytdlp';
import type { ArgsOptions, VideoProgress } from 'ytdlp-nodejs';
import { getBuiltinProfile, parseProfileOptions } from './profiles';
import { ensureExistingDownloadFolder } from './folders';
import { downloadOutputBase } from './media-extensions';
import {
	DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS,
	inactivityFailureMessage
} from './inactivity-timeout';

type Stoppable = { kill: (signal: NodeJS.Signals) => boolean; pid?: number };

function stopChild(download: Stoppable) {
	try {
		if (process.platform === 'win32' && download.pid !== undefined) {
			execChild(`taskkill /PID ${download.pid} /T /F`, () => {});
		} else {
			download.kill('SIGKILL');
		}
	} catch (err) {
		console.warn('Failed to kill child process:', err);
	}
}

function resolveInactivityTimeoutMs(): number {
	// Vitest throws if a config mock does not export this helper. Older tests
	// mock the rest of the module, so a missing helper keeps the default window.
	let read: unknown;
	try {
		read = downloadConfig.downloadInactivityTimeoutMs;
	} catch {
		read = undefined;
	}
	if (typeof read !== 'function') {
		return DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS;
	}
	const value = read();
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS;
	}
	return value;
}

export async function startDownload(item: DownloadItem, signal?: AbortSignal): Promise<void> {
	const stderrBuffer: string[] = [];
	const targetFolder = await ensureExistingDownloadFolder(item.folder);
	const outputBase = downloadOutputBase(
		item.fileName || item.title || item.extractorVideoId || item.id
	);
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
	let timedOut = false;
	const timeoutMs = resolveInactivityTimeoutMs();

	// Assigned inside the run() promise. Abort can fire before that promise
	// observes the child "close" event (a killed shell may leave stdio open).
	let fail = () => {};

	const onAbort = () => {
		if (finished) return;

		setImmediate(() => {
			if (finished) return;
			killed = true;
			stopChild(download);
			fail();
		});
	};

	if (signal?.aborted) {
		await setStatus(item.id, 'cancelled', 'Cancelled by user');
		return;
	}
	signal?.addEventListener('abort', onAbort, { once: true });

	return await new Promise<void>((resolve) => {
		let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
		let processStarted = false;

		const clearInactivity = () => {
			if (!inactivityTimer) return;
			clearTimeout(inactivityTimer);
			inactivityTimer = undefined;
		};

		const settle = () => {
			clearInactivity();
			signal?.removeEventListener('abort', onAbort);
			resolve();
		};

		const markFinished = () => {
			if (finished) return false;
			finished = true;
			clearInactivity();
			return true;
		};

		const noteActivity = () => {
			if (finished || timedOut || !(timeoutMs > 0)) return;
			clearInactivity();
			inactivityTimer = setTimeout(onInactivity, timeoutMs);
		};

		const onInactivity = () => {
			if (finished) return;
			timedOut = true;
			killed = true;
			// Flag the timeout before kill(). A synchronous error from kill must
			// not be stored as a user cancellation.
			stopChild(download);
			fail();
		};

		// ytdlp-nodejs 3.4 returns a builder. run() starts the process and
		// emits finish on success. A non-zero exit emits error and rejects.
		download.on('finish', () => {
			// A killed process can still emit finish when the exit code is null.
			if (timedOut || killed || signal?.aborted) {
				fail();
				return;
			}
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

		fail = () => {
			if (!markFinished()) return;
			void (async () => {
				if (timedOut) {
					await setStatus(item.id, 'failed', inactivityFailureMessage(timeoutMs, processStarted));
				} else if (signal?.aborted || killed) {
					await setStatus(item.id, 'cancelled', 'Cancelled by user');
				} else {
					const errorMsg =
						stderrBuffer.filter((v) => v.startsWith('ERROR')).join('\n') || undefined;
					await setStatus(item.id, 'failed', errorMsg);
				}
				settle();
			})();
		};

		download.on('start', () => {
			processStarted = true;
		});
		download.on('stdout', () => {
			noteActivity();
		});
		download.on('stderr', (data) => {
			noteActivity();
			const msg = data.trim();
			if (msg) {
				stderrBuffer.push(msg);
				console.error('[yt-dlp]', msg);
			}
		});
		download.on('progress', (progress: VideoProgress) => {
			noteActivity();
			downloads.update((items) => items.map((d) => (d.id === item.id ? { ...d, progress } : d)));
		});
		download.on('error', fail);

		// Arm before run() so a builder that never spawns yt-dlp still expires.
		noteActivity();
		const running = download.run();
		running.catch(fail);
		if (signal?.aborted) {
			killed = true;
			stopChild(download);
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
