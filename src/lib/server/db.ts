import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db/index';
import { downloads as downloadsSchema } from './db/schema';
import { downloads } from './store';
import type { DownloadStatus } from '$lib/types/download';
import { DELETE_FILE_ON_DELETE } from './config';
import { deleteDownloadFile } from './folders';

export async function addDownload(download: typeof downloadsSchema.$inferInsert) {
	const newDownload = await db
		.insert(downloadsSchema)
		.values(download)
		.onConflictDoNothing()
		.returning();

	downloads.update((d) => [...d, ...newDownload.map((item) => ({ ...item, progress: null }))]);
	return newDownload;
}

export async function addDownloads(download: (typeof downloadsSchema.$inferInsert)[]) {
	if (download.length === 0) return [];

	const newDownloads = await db
		.insert(downloadsSchema)
		.values(download)
		.onConflictDoNothing()
		.returning();

	downloads.update((d) => [...d, ...newDownloads.map((item) => ({ ...item, progress: null }))]);
	return newDownloads;
}

export async function setStatus(id: string, status: DownloadStatus, errorMessage?: string | null) {
	const now = new Date();
	const finishedAt = ['completed', 'failed', 'cancelled'].includes(status) ? now : null;

	// 1️⃣ Update Store
	downloads.update((items) =>
		items.map((item) =>
			item.id === id
				? {
						...item,
						status,
						errorMessage: errorMessage ? errorMessage : null,
						finishedAt: finishedAt
					}
				: item
		)
	);

	// 2️⃣ Update DB
	const updateData: Partial<typeof downloadsSchema.$inferInsert> = {
		status,
		finishedAt: finishedAt
	};
	if (errorMessage || errorMessage === null) updateData.errorMessage = errorMessage;

	await db.update(downloadsSchema).set(updateData).where(eq(downloadsSchema.id, id));
}

export async function updateDownload(
	id: string,
	values: Partial<typeof downloadsSchema.$inferInsert>
) {
	const updated = await db
		.update(downloadsSchema)
		.set(values)
		.where(eq(downloadsSchema.id, id))
		.returning();

	if (updated[0]) {
		downloads.update((items) =>
			items.map((item) =>
				item.id === id ? { ...item, ...updated[0], progress: item.progress } : item
			)
		);
	}

	return updated[0] ?? null;
}

export async function findDuplicateByMediaIdentity(
	extractor?: string | null,
	videoId?: string | null
) {
	if (!extractor || !videoId) return null;

	const [match] = await db
		.select()
		.from(downloadsSchema)
		.where(
			and(eq(downloadsSchema.extractor, extractor), eq(downloadsSchema.extractorVideoId, videoId))
		)
		.limit(1);

	return match ?? null;
}

/**
 * Löscht einen Download-Eintrag. Standardmäßig wird nur der Datenbankeintrag
 * entfernt; die heruntergeladene Datei bleibt erhalten.
 *
 * Ist `DELETE_FILE_ON_DELETE` aktiviert, wird zusätzlich die zugehörige Datei
 * gelöscht – ausschließlich innerhalb von `DOWNLOAD_PATH` (Path-Traversal- und
 * Absolutpfad-Schutz in `deleteDownloadFile`).
 */
export async function deleteDownload(id: string) {
	const [existing] = await db
		.select({ filePath: downloadsSchema.filePath })
		.from(downloadsSchema)
		.where(eq(downloadsSchema.id, id))
		.limit(1);

	await db.delete(downloadsSchema).where(eq(downloadsSchema.id, id));

	downloads.update((d) => d.filter((i) => i.id !== id));

	if (DELETE_FILE_ON_DELETE && existing?.filePath) {
		try {
			await deleteDownloadFile(existing.filePath);
		} catch (err) {
			console.warn('[delete] Failed to remove file for download', id, err);
		}
	}
}

/**
 * Bulk-löschen aller Downloads mit einem der angegebenen Status.
 *
 * Verhält sich wie {@link deleteDownload}: standardmäßig werden nur die
 * Datenbankeinträge entfernt; ist `DELETE_FILE_ON_DELETE` aktiv, werden auch die
 * zugehörigen Dateien gelöscht (mit dem sicheren Pfad-Guard). Gibt die Anzahl
 * der entfernten Einträge zurück.
 */
export async function deleteDownloadsByStatus(statuses: DownloadStatus[]) {
	if (statuses.length === 0) return 0;

	const rows = await db
		.select({ id: downloadsSchema.id, filePath: downloadsSchema.filePath })
		.from(downloadsSchema)
		.where(inArray(downloadsSchema.status, statuses));

	if (rows.length === 0) return 0;

	const removedIds = new Set(rows.map((row) => row.id));

	await db.delete(downloadsSchema).where(inArray(downloadsSchema.status, statuses));

	downloads.update((list) => list.filter((item) => !removedIds.has(item.id)));

	if (DELETE_FILE_ON_DELETE) {
		for (const row of rows) {
			if (!row.filePath) continue;
			try {
				await deleteDownloadFile(row.filePath);
			} catch (err) {
				console.warn('[delete] Failed to remove file for download', row.id, err);
			}
		}
	}

	return rows.length;
}
