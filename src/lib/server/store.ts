import { defaultConcurrency, maxConcurrency } from '$lib';
import { building } from '$app/environment';
import { writable } from 'svelte/store';
import { db } from './db/index';
import { downloads as downloadsSchema } from './db/schema';
import type { DownloadItem } from '$lib/types/download';
import { processDownloads, setConcurrency, setPause } from './process';
import { inArray } from 'drizzle-orm';
import { startSubscriptionScheduler } from './subscriptions';
import { concurrencyForNow, parseConcurrencyWindows } from './scheduler';

/**
 * Liste aller Downloads, die aktuell in der Queue oder in Bearbeitung sind.
 * Jeder Eintrag ist vom Typ DownloadItem (enthält URL, optionalen Dateinamen, Status, Fortschritt etc.).
 */
export const downloads = writable<DownloadItem[]>([]);

if (!building) void initializeStore();

async function initializeStore() {
	// Alle "hängenden" Downloads als Fehler markieren
	await db
		.update(downloadsSchema)
		.set({
			status: 'failed',
			errorMessage: 'The download was terminated due to a restart or crash.'
		})
		.where(inArray(downloadsSchema.status, ['downloading', 'queued', 'metadata_fetching']));

	// Neu aus DB laden
	const items = await db.select().from(downloadsSchema);

	downloads.set(
		items.map((item) => ({
			...item,
			progress: null
		}))
	);

	// Queue neu starten (nur pending Downloads werden berücksichtigt)
	void processDownloads();
	startSubscriptionScheduler();
}

/**
 * Anzahl paralleler Downloads.
 * Typisch: 1–3, initial auf 1 gesetzt.
 */
export const concurrency = writable(Math.min(defaultConcurrency, maxConcurrency));
const concurrencyWindows = parseConcurrencyWindows();

concurrency.subscribe((value) => {
	setConcurrency(value);
});

if (concurrencyWindows.length > 0) {
	setInterval(() => {
		concurrency.set(
			Math.min(maxConcurrency, concurrencyForNow(concurrencyWindows, Math.min(defaultConcurrency, maxConcurrency)))
		);
	}, 60_000);
	concurrency.set(
		Math.min(maxConcurrency, concurrencyForNow(concurrencyWindows, Math.min(defaultConcurrency, maxConcurrency)))
	);
}

/**
 * Flag, ob alle Downloads aktuell pausiert sind.
 * true → Downloads werden nicht gestartet, false → Downloads laufen wie erlaubt.
 */
export const paused = writable(false);

paused.subscribe((isPaused) => {
	setPause(isPaused);
});
