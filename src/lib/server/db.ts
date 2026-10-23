import { and, eq, inArray, ne, or, type SQL } from 'drizzle-orm';
import { db } from './db/index';
import { downloads as downloadsSchema, type Download, type DownloadAdd } from './db/schema';
import { downloads } from './store';
import type { DownloadStatus } from '$lib/types/download';
import { DELETE_FILE_ON_DELETE } from './config';
import { deleteDownloadFile } from './folders';
import { isReliableMediaIdentity } from './media-identity';
import { filenameKeyFor } from './media-extensions';
import { canonicalVideoUrl, mediaKeyFor } from './url-canonical';
import {
	alreadyInListMessage,
	classifyDuplicateMatches,
	isUniqueConstraintError,
	preferDuplicateRow,
	RETRYABLE_DOWNLOAD_STATUSES,
	type DuplicateCandidate,
	type ListedDuplicate
} from './duplicate-guard';

export type { ListedDuplicate };
export { isUniqueConstraintError };

export type AddDownloadsOutcome = {
	queued: Download[];
	retried: Download[];
	duplicates: ListedDuplicate[];
};

type IdentityKeys = {
	videoUrl?: string | null;
	canonicalUrl?: string | null;
	mediaKey?: string | null;
	filenameKey?: string | null;
	extractor?: string | null;
	extractorVideoId?: string | null;
};

function withIdentity(item: DownloadAdd): DownloadAdd {
	const canonicalUrl = item.canonicalUrl ?? canonicalVideoUrl(item.videoUrl);
	const mediaKey = item.mediaKey ?? mediaKeyFor(item.extractor, item.extractorVideoId);
	// An explicit null opts out (playlist rows that share the parent's name).
	const filenameKey = Object.prototype.hasOwnProperty.call(item, 'filenameKey')
		? item.filenameKey || null
		: filenameKeyFor(item.fileName);
	return {
		...item,
		canonicalUrl: canonicalUrl || null,
		mediaKey: mediaKey || null,
		filenameKey
	};
}

function identityWhere(keys: IdentityKeys, exceptId?: string): SQL | undefined {
	const parts: SQL[] = [];
	if (keys.videoUrl) parts.push(eq(downloadsSchema.videoUrl, keys.videoUrl));
	if (keys.canonicalUrl) parts.push(eq(downloadsSchema.canonicalUrl, keys.canonicalUrl));
	if (keys.mediaKey) parts.push(eq(downloadsSchema.mediaKey, keys.mediaKey));
	if (keys.filenameKey) parts.push(eq(downloadsSchema.filenameKey, keys.filenameKey));

	const identityId = isReliableMediaIdentity(keys.extractor, keys.extractorVideoId)
		? keys.extractorVideoId
		: null;
	if (keys.extractor && identityId) {
		const identity = and(
			eq(downloadsSchema.extractor, keys.extractor),
			eq(downloadsSchema.extractorVideoId, identityId)
		);
		if (identity) parts.push(identity);
	}

	if (parts.length === 0) return undefined;
	const match = parts.length === 1 ? parts[0] : or(...parts);
	if (!match) return undefined;
	if (!exceptId) return match;
	return and(match, ne(downloadsSchema.id, exceptId));
}

function retryPatch(
	item: DownloadAdd,
	existing: Download,
	matches: Download[] = []
): Partial<DownloadAdd> {
	const canonicalTaken = matches.some(
		(row) => row.id !== existing.id && !!item.canonicalUrl && row.canonicalUrl === item.canonicalUrl
	);
	const mediaTaken = matches.some(
		(row) => row.id !== existing.id && !!item.mediaKey && row.mediaKey === item.mediaKey
	);
	const filenameTaken = matches.some(
		(row) => row.id !== existing.id && !!item.filenameKey && row.filenameKey === item.filenameKey
	);

	return {
		status: 'pending',
		errorMessage: null,
		finishedAt: null,
		fileName: item.fileName ?? existing.fileName,
		folder: item.folder ?? existing.folder,
		profileId: item.profileId ?? existing.profileId,
		quality: item.quality,
		appendTitle: item.appendTitle,
		advancedOptionsJson: item.advancedOptionsJson ?? existing.advancedOptionsJson,
		canonicalUrl: existing.canonicalUrl ?? (canonicalTaken ? null : (item.canonicalUrl ?? null)),
		mediaKey: existing.mediaKey ?? (mediaTaken ? null : (item.mediaKey ?? null)),
		filenameKey: filenameTaken ? existing.filenameKey : (item.filenameKey ?? existing.filenameKey)
	};
}

function toListedDuplicate(row: Download): ListedDuplicate {
	return {
		id: row.id,
		label: row.title?.trim() || row.fileName?.trim() || row.videoUrl,
		status: row.status,
		videoUrl: row.videoUrl,
		message: alreadyInListMessage(row)
	};
}

type ClaimExecutor = Pick<typeof db, 'select' | 'insert' | 'update'>;

function readMatches(tx: ClaimExecutor, where: SQL | undefined): Download[] {
	if (!where) return [];
	return tx.select().from(downloadsSchema).where(where).all();
}

function claimOne(
	tx: ClaimExecutor,
	item: DownloadAdd
): { queued?: Download; retried?: Download; duplicate?: ListedDuplicate } {
	const where = identityWhere(item);

	const apply = (matches: Download[]) => {
		const decision = classifyDuplicateMatches(matches);
		if (decision.kind === 'insert') return null;
		if (decision.kind === 'reject') return { duplicate: toListedDuplicate(decision.existing) };

		try {
			const [updated] = tx
				.update(downloadsSchema)
				.set(retryPatch(item, decision.existing, matches))
				.where(eq(downloadsSchema.id, decision.existing.id))
				.returning()
				.all();
			return { retried: updated ?? decision.existing };
		} catch (err) {
			if (!isUniqueConstraintError(err)) throw err;
			const rest = retryPatch(item, decision.existing, matches);
			delete rest.canonicalUrl;
			delete rest.mediaKey;
			delete rest.filenameKey;
			const [updated] = tx
				.update(downloadsSchema)
				.set(rest)
				.where(eq(downloadsSchema.id, decision.existing.id))
				.returning()
				.all();
			return { retried: updated ?? decision.existing };
		}
	};

	const decided = apply(readMatches(tx, where));
	if (decided) return decided;

	try {
		const [inserted] = tx.insert(downloadsSchema).values(item).returning().all();
		return { queued: inserted };
	} catch (err) {
		if (!isUniqueConstraintError(err)) throw err;
		const recovered = apply(readMatches(tx, where));
		if (recovered) return recovered;
		throw err;
	}
}

function rememberOutcome(outcome: AddDownloadsOutcome) {
	downloads.update((items) => {
		const retriedIds = new Map(outcome.retried.map((row) => [row.id, row]));
		const next = items.map((item) => {
			const updated = retriedIds.get(item.id);
			return updated ? { ...item, ...updated, progress: null } : item;
		});
		return [...next, ...outcome.queued.map((row) => ({ ...row, progress: null }))];
	});
}

export async function addDownload(download: DownloadAdd) {
	const outcome = await addDownloads([download]);
	return [...outcome.queued, ...outcome.retried];
}

export async function addDownloads(download: DownloadAdd[]): Promise<AddDownloadsOutcome> {
	if (download.length === 0) return { queued: [], retried: [], duplicates: [] };

	const prepared = download.map(withIdentity);
	const outcome = db.transaction((tx) => {
		const queued: Download[] = [];
		const retried: Download[] = [];
		const duplicates: ListedDuplicate[] = [];

		for (const item of prepared) {
			const result = claimOne(tx, item);
			if (result.queued) queued.push(result.queued);
			if (result.retried) retried.push(result.retried);
			if (result.duplicate) duplicates.push(result.duplicate);
		}

		return { queued, retried, duplicates };
	});

	rememberOutcome(outcome);
	return outcome;
}

export async function findConflictingDownload(keys: IdentityKeys, exceptId?: string) {
	const where = identityWhere(keys, exceptId);
	if (!where) return null;

	const matches = await db.select().from(downloadsSchema).where(where);
	if (matches.length === 0) return null;
	return preferDuplicateRow(matches);
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

/**
 * A row created for a URL we only recognized as a duplicate after metadata.
 * Failed or cancelled originals are restarted. The new row is removed when it
 * has no file yet, so the list does not keep two titles for one video.
 * Historical rows are never deleted here.
 */
export async function absorbNewerDuplicate(incoming: Download, existing: Download) {
	if (incoming.id === existing.id) return;

	if (RETRYABLE_DOWNLOAD_STATUSES.has(existing.status)) {
		await updateDownload(existing.id, retryPatch(incoming, existing));
	}

	if (!incoming.filePath) {
		await deleteDownload(incoming.id);
		return;
	}

	await setStatus(incoming.id, 'cancelled', alreadyInListMessage(existing));
}

type DedupeRow = Download & {
	computedCanonical: string | null;
	computedMedia: string | null;
	computedFilename: string | null;
};

/**
 * Assigns `canonical_url`, `media_key` and `filename_key` on databases that
 * already contain rows. When several rows normalize to the same video, one
 * preferred row keeps the key and the others stay in the list with NULL.
 * Nothing is deleted. Rows without a filename keep a NULL filename key.
 */
export function backfillDuplicateKeys() {
	const rows: DedupeRow[] = db
		.select()
		.from(downloadsSchema)
		.all()
		.map((row) => ({
			...row,
			computedCanonical: canonicalVideoUrl(row.videoUrl),
			computedMedia: mediaKeyFor(row.extractor, row.extractorVideoId),
			computedFilename: filenameKeyFor(row.fileName)
		}));

	const canonical = planKeyAssignment(
		rows,
		(row) => row.computedCanonical,
		(row) => row.canonicalUrl
	);
	const media = planKeyAssignment(
		rows,
		(row) => row.computedMedia,
		(row) => row.mediaKey
	);
	const filename = planKeyAssignment(
		rows,
		(row) => row.computedFilename,
		(row) => row.filenameKey
	);

	if (
		canonical.clears.length +
			canonical.sets.length +
			media.clears.length +
			media.sets.length +
			filename.clears.length +
			filename.sets.length ===
		0
	) {
		return;
	}

	db.transaction((tx) => {
		for (const id of canonical.clears) {
			tx.update(downloadsSchema)
				.set({ canonicalUrl: null })
				.where(eq(downloadsSchema.id, id))
				.run();
		}
		for (const id of media.clears) {
			tx.update(downloadsSchema).set({ mediaKey: null }).where(eq(downloadsSchema.id, id)).run();
		}
		for (const id of filename.clears) {
			tx.update(downloadsSchema).set({ filenameKey: null }).where(eq(downloadsSchema.id, id)).run();
		}
		for (const assignment of canonical.sets) {
			tx.update(downloadsSchema)
				.set({ canonicalUrl: assignment.value })
				.where(eq(downloadsSchema.id, assignment.id))
				.run();
		}
		for (const assignment of media.sets) {
			tx.update(downloadsSchema)
				.set({ mediaKey: assignment.value })
				.where(eq(downloadsSchema.id, assignment.id))
				.run();
		}
		for (const assignment of filename.sets) {
			tx.update(downloadsSchema)
				.set({ filenameKey: assignment.value })
				.where(eq(downloadsSchema.id, assignment.id))
				.run();
		}
	});

	console.info(
		`[duplicates] Updated dedupe keys on ${
			new Set([
				...canonical.clears,
				...media.clears,
				...filename.clears,
				...canonical.sets.map((row) => row.id),
				...media.sets.map((row) => row.id),
				...filename.sets.map((row) => row.id)
			]).size
		} existing row(s). Duplicate list entries were kept.`
	);
}

function planKeyAssignment<T extends DuplicateCandidate>(
	rows: T[],
	compute: (row: T) => string | null,
	current: (row: T) => string | null
) {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const key = compute(row);
		if (!key) continue;
		const group = groups.get(key);
		if (group) group.push(row);
		else groups.set(key, [row]);
	}

	const clears: string[] = [];
	const sets: { id: string; value: string }[] = [];

	for (const [key, group] of groups) {
		const winner = preferDuplicateRow(group);
		for (const row of group) {
			const desired = row.id === winner.id ? key : null;
			if (current(row) === desired) continue;
			if (desired === null) clears.push(row.id);
			else sets.push({ id: row.id, value: desired });
		}
	}

	return { clears, sets };
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
