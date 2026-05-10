import { and, eq } from 'drizzle-orm';
import { db } from './db/index';
import { downloads as downloadsSchema } from './db/schema';
import { downloads } from './store';
import type { DownloadStatus } from '$lib/types/download';

export async function addDownload(download: typeof downloadsSchema.$inferInsert) {
	const newDownload = await db.insert(downloadsSchema).values(download).onConflictDoNothing().returning();

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

export async function updateDownload(id: string, values: Partial<typeof downloadsSchema.$inferInsert>) {
	const updated = await db
		.update(downloadsSchema)
		.set(values)
		.where(eq(downloadsSchema.id, id))
		.returning();

	if (updated[0]) {
		downloads.update((items) =>
			items.map((item) => (item.id === id ? { ...item, ...updated[0], progress: item.progress } : item))
		);
	}

	return updated[0] ?? null;
}

export async function findDuplicateByMediaIdentity(extractor?: string | null, videoId?: string | null) {
	if (!extractor || !videoId) return null;

	const [match] = await db
		.select()
		.from(downloadsSchema)
		.where(
			and(
				eq(downloadsSchema.extractor, extractor),
				eq(downloadsSchema.extractorVideoId, videoId)
			)
		)
		.limit(1);

	return match ?? null;
}

export async function deleteDownload(id: string) {
	await db.delete(downloadsSchema).where(eq(downloadsSchema.id, id));

	downloads.update((d) => d.filter((i) => i.id !== id));
}
