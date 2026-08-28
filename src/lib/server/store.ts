import { defaultConcurrency, maxConcurrency } from '$lib';
import { writable } from 'svelte/store';
import { db } from './db/index';
import { downloads as downloadsSchema } from './db/schema';
import type { DownloadItem } from '$lib/types/download';
import { processDownloads, setConcurrency, setPause } from './process';
import { inArray } from 'drizzle-orm';
import { startSubscriptionScheduler, stopSubscriptionScheduler } from './subscriptions';
import { concurrencyForNow, parseConcurrencyWindows } from './scheduler';

/**
 * Liste aller Downloads, die aktuell in der Queue oder in Bearbeitung sind.
 * Jeder Eintrag ist vom Typ DownloadItem (enthält URL, optionalen Dateinamen, Status, Fortschritt etc.).
 */
export const downloads = writable<DownloadItem[]>([]);

/**
 * Anzahl paralleler Downloads.
 * Typisch: 1–3, initial auf 1 gesetzt.
 */
export const concurrency = writable(Math.min(defaultConcurrency, maxConcurrency));

concurrency.subscribe((value) => {
	setConcurrency(value);
});

/**
 * Flag, ob alle Downloads aktuell pausiert sind.
 * true → Downloads werden nicht gestartet, false → Downloads laufen wie erlaubt.
 */
export const paused = writable(false);

paused.subscribe((isPaused) => {
	setPause(isPaused);
});

let initialized = false;
let concurrencyTimer: NodeJS.Timeout | null = null;

/**
 * One-time server initialization.
 *
 * This intentionally runs from the SvelteKit `init` server hook rather than as
 * a module-load side effect. Running it at import time is fragile: the server
 * modules form a cycle (store → process → store, store → subscriptions →
 * process → store), so invoking cross-module functions during evaluation can
 * hit a temporal-dead-zone error (e.g. "Cannot access 'schedulerState' before
 * initialization"). Deferring to `init` guarantees every module is fully
 * evaluated first, and the `initialized` guard prevents duplicate startup.
 */
export async function initializeServer() {
	if (initialized) return;
	initialized = true;

	// Alle "hängenden" Downloads eines vorherigen Laufs als Fehler markieren.
	await db
		.update(downloadsSchema)
		.set({
			status: 'failed',
			errorMessage: 'The download was terminated due to a restart or crash.'
		})
		.where(inArray(downloadsSchema.status, ['downloading', 'queued', 'metadata_fetching']));

	// Aktuellen Stand aus der DB laden.
	const items = await db.select().from(downloadsSchema);
	downloads.set(
		items.map((item) => ({
			...item,
			progress: null
		}))
	);

	// Queue neu starten (nur pending/queued Downloads werden berücksichtigt).
	void processDownloads();

	// Zeitfenster-gesteuerte Parallelität anwenden (optional via CONCURRENCY_WINDOWS).
	const concurrencyWindows = parseConcurrencyWindows();
	if (concurrencyWindows.length > 0) {
		const applyWindow = () =>
			concurrency.set(
				Math.min(
					maxConcurrency,
					concurrencyForNow(concurrencyWindows, Math.min(defaultConcurrency, maxConcurrency))
				)
			);
		applyWindow();
		concurrencyTimer = setInterval(applyWindow, 60_000);
		concurrencyTimer.unref?.();
	}

	startSubscriptionScheduler();
}

/**
 * Stoppt Hintergrund-Timer für einen sauberen Shutdown/Restart.
 * Idempotent und für erneutes `initializeServer()` vorbereitet.
 */
export function shutdownServer() {
	if (concurrencyTimer) {
		clearInterval(concurrencyTimer);
		concurrencyTimer = null;
	}
	stopSubscriptionScheduler();
	initialized = false;
}
