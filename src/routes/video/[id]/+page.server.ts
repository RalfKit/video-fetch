import fs from 'fs';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { downloads } from '$lib/server/db/schema';
import { resolveWithinDownloadFolder } from '$lib/server/folders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [download] = await db.select().from(downloads).where(eq(downloads.id, params.id)).limit(1);

	if (!download) throw error(404, 'Download not found');

	// Determine whether the underlying file is still present and inside the
	// download folder. Missing/moved files are surfaced as a friendly state
	// instead of a broken media element.
	let available = false;
	if (download.filePath) {
		try {
			available = fs.existsSync(resolveWithinDownloadFolder(download.filePath));
		} catch {
			available = false;
		}
	}

	return {
		id: download.id,
		title: download.title ?? download.fileName ?? download.videoUrl,
		status: download.status,
		videoUrl: download.videoUrl,
		hasFile: !!download.filePath,
		available
	};
};
