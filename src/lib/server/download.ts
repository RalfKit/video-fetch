import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const targetTail = new Map<string, Promise<void>>();

function targetLockKeys(item: DownloadItem, outputBase: string): string[] {
	const keys = [`file:${outputBase}`];
	if (item.canonicalUrl) keys.push(`url:${item.canonicalUrl}`);
	else if (item.videoUrl) keys.push(`url:${item.videoUrl}`);
	if (item.mediaKey) keys.push(`media:${item.mediaKey}`);
	return [...new Set(keys)].sort();
}

/** One running yt-dlp per output file and per video. The next job waits until the process tree is gone. */
function withTargetLock(key: string, run: () => Promise<void>): Promise<void> {
	const previous = targetTail.get(key) ?? Promise.resolve();
	const runAfter = previous.catch(() => {}).then(run);
	const settled = runAfter.then(
		() => {},
		() => {}
	);
	targetTail.set(key, settled);
	void settled.finally(() => {
		if (targetTail.get(key) === settled) targetTail.delete(key);
	});
	return runAfter;
}

function withTargetLocks(keys: string[], run: () => Promise<void>): Promise<void> {
	const [key, ...rest] = keys;
	if (!key) return run();
	return withTargetLock(key, () => withTargetLocks(rest, run));
}

function directChildren(pid: number): number[] {
	if (process.platform === 'linux') {
		try {
			const raw = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
			if (!raw) return [];
			return raw
				.split(/\s+/)
				.map(Number)
				.filter((value) => Number.isInteger(value) && value > 0);
		} catch {
			return [];
		}
	}

	try {
		const raw = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).trim();
		if (!raw) return [];
		return raw
			.split(/\s+/)
			.map(Number)
			.filter((value) => Number.isInteger(value) && value > 0);
	} catch {
		return [];
	}
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Stop yt-dlp and the ffmpeg processes it spawned.
 * `child.kill()` signals only the direct child, so a merge can keep writing
 * the part files after the list entry is gone. Already downloaded parts are
 * not deleted; a later add resumes from them.
 */
function killProcessTree(pid: number): number[] {
	const stopped = new Set<number>();
	const visit = (current: number) => {
		if (stopped.has(current)) return;
		try {
			process.kill(current, 'SIGSTOP');
		} catch {
			return;
		}
		stopped.add(current);
		for (const child of directChildren(current)) visit(child);
	};

	visit(pid);
	for (const current of stopped) {
		for (const child of directChildren(current)) visit(child);
	}
	for (const current of stopped) {
		try {
			process.kill(current, 'SIGKILL');
		} catch {
			/* already gone */
		}
	}
	return [...stopped];
}

function stopDownloadProcess(download: Stoppable): number[] {
	const pid = download.pid;
	if (pid !== undefined && process.platform === 'win32') {
		try {
			execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
		} catch (err) {
			console.warn('Failed to kill child process:', err);
		}
		return [pid];
	}
	if (pid !== undefined) return killProcessTree(pid);

	try {
		download.kill('SIGKILL');
	} catch (err) {
		console.warn('Failed to kill child process:', err);
	}
	return [];
}

async function waitUntilDead(pids: number[]) {
	const pending = new Set(pids);
	const deadline = Date.now() + 5000;
	while (pending.size > 0 && Date.now() < deadline) {
		for (const pid of [...pending]) {
			if (!processAlive(pid)) pending.delete(pid);
		}
		if (pending.size === 0) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
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
	const outputBase = downloadOutputBase(
		item.fileName || item.title || item.extractorVideoId || item.id
	);
	return withTargetLocks(targetLockKeys(item, outputBase), () =>
		runDownload(item, signal, outputBase)
	);
}

async function runDownload(
	item: DownloadItem,
	signal: AbortSignal | undefined,
	outputBase: string
): Promise<void> {
	if (signal?.aborted) return;

	const stderrBuffer: string[] = [];
	const targetFolder = await ensureExistingDownloadFolder(item.folder);
	if (signal?.aborted) return;
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
	let doomed: number[] = [];
	const timeoutMs = resolveInactivityTimeoutMs();

	// Assigned inside the run() promise. Abort can fire before that promise
	// observes the child "close" event (a killed shell may leave stdio open).
	let fail = () => {};

	const halt = () => {
		killed = true;
		const pids = stopDownloadProcess(download);
		if (pids.length > 0) doomed = pids;
	};

	const onAbort = () => {
		if (finished) return;

		setImmediate(() => {
			if (finished) return;
			halt();
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
			// Flag the timeout before kill(). A synchronous error from kill must
			// not be stored as a user cancellation.
			halt();
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
				if (timedOut || killed || signal?.aborted) await waitUntilDead(doomed);
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
			halt();
			fail();
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
