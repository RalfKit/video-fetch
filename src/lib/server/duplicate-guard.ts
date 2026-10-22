/**
 * Duplicate policy for downloads.
 *
 * Pending, queued, fetching, downloading and completed rows block a new add.
 * Failed and cancelled rows are retried in place. Completed videos stay
 * blocked so a finished file is not downloaded again; removing that list entry
 * is the way to start a fresh copy.
 */

export const BLOCKING_DOWNLOAD_STATUSES = new Set([
	'pending',
	'metadata_fetching',
	'queued',
	'downloading',
	'completed'
]);

export const RETRYABLE_DOWNLOAD_STATUSES = new Set(['failed', 'cancelled']);

const STATUS_RANK: Record<string, number> = {
	downloading: 0,
	metadata_fetching: 1,
	queued: 2,
	pending: 3,
	completed: 4,
	failed: 5,
	cancelled: 6
};

export type DuplicateCandidate = {
	id: string;
	status: string;
	filePath?: string | null;
	createdAt?: Date | number | null;
	updatedAt?: Date | number | null;
	finishedAt?: Date | number | null;
};

export type ListedDuplicate = {
	id: string;
	label: string;
	status: string;
	videoUrl: string;
	message: string;
};

type LabeledDownload = {
	id: string;
	title: string | null;
	fileName: string | null;
	videoUrl: string;
	status: string;
};

function timeValue(value: Date | number | null | undefined): number {
	if (value instanceof Date) return value.getTime();
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	return 0;
}

export function downloadLabel(row: {
	title?: string | null;
	fileName?: string | null;
	videoUrl: string;
}): string {
	return row.title?.trim() || row.fileName?.trim() || row.videoUrl;
}

export function alreadyInListMessage(existing: LabeledDownload): string {
	const label = downloadLabel(existing);
	const again =
		existing.status === 'completed'
			? ' Remove that entry from the list before downloading it again.'
			: '';
	return `Already in the list: "${label}" (${existing.status}). Open /video/${existing.id}.${again}`;
}

export function duplicateErrorBody(rows: ListedDuplicate[]): {
	error: string;
	duplicates: ListedDuplicate[];
} {
	return {
		error: rows.map((duplicate) => duplicate.message).join('\n'),
		duplicates: rows
	};
}

/**
 * Which existing row should own the dedupe key, or be shown in the error.
 * Active work wins, then a completed row that still has a file, then the
 * newest of whatever remains.
 */
export function preferDuplicateRow<T extends DuplicateCandidate>(rows: T[]): T {
	if (rows.length === 0) throw new Error('preferDuplicateRow called with no rows');

	return [...rows].sort((a, b) => {
		const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
		if (rank !== 0) return rank;

		if (a.status === 'completed' && b.status === 'completed') {
			const file = Number(!a.filePath) - Number(!b.filePath);
			if (file !== 0) return file;
		}

		return (
			timeValue(b.finishedAt) - timeValue(a.finishedAt) ||
			timeValue(b.updatedAt) - timeValue(a.updatedAt) ||
			timeValue(b.createdAt) - timeValue(a.createdAt)
		);
	})[0];
}

export function classifyDuplicateMatches<T extends DuplicateCandidate>(
	matches: T[]
): { kind: 'insert' } | { kind: 'retry'; existing: T } | { kind: 'reject'; existing: T } {
	if (matches.length === 0) return { kind: 'insert' };

	const blocking = matches.filter((row) => BLOCKING_DOWNLOAD_STATUSES.has(row.status));
	if (blocking.length > 0) return { kind: 'reject', existing: preferDuplicateRow(blocking) };

	const retryable = matches.filter((row) => RETRYABLE_DOWNLOAD_STATUSES.has(row.status));
	if (retryable.length > 0) return { kind: 'retry', existing: preferDuplicateRow(retryable) };

	return { kind: 'reject', existing: preferDuplicateRow(matches) };
}

export function isUniqueConstraintError(err: unknown): boolean {
	const seen = new Set<unknown>();
	let current: unknown = err;

	while (current && typeof current === 'object' && !seen.has(current)) {
		seen.add(current);
		const code = 'code' in current && typeof current.code === 'string' ? current.code : '';
		if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;

		const message = current instanceof Error ? current.message : '';
		if (/UNIQUE constraint failed/i.test(message)) return true;

		current = 'cause' in current ? current.cause : undefined;
	}

	return false;
}
