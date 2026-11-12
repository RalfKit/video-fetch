import { prepareDownloadItems, ValidationError } from '$lib/server/downloads-helper';
import { addDownloads } from '$lib/server/db';
import type { Download } from '$lib/server/db/schema';
import { processDownloads } from '$lib/server/process';
import type { RequestHandler } from './$types';

function existingEntry(row: Download) {
	return {
		id: row.id,
		videoUrl: row.videoUrl,
		status: row.status,
		title: row.title,
		fileName: row.fileName,
		folder: row.folder,
		profileId: row.profileId,
		quality: row.quality
	};
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const data = await request.json();

		const items = await prepareDownloadItems(data, 'api');
		const outcome = await addDownloads(items);
		const added = outcome.queued.length + outcome.retried.length;
		if (added > 0) void processDownloads();

		return new Response(
			JSON.stringify({
				message: 'Downloads added to queue',
				queued: added,
				inserted: outcome.queued.length,
				retried: outcome.retried.length,
				existing: outcome.existing.map(existingEntry)
			}),
			{ status: 202 }
		);
	} catch (err) {
		if (err instanceof ValidationError) {
			return new Response(JSON.stringify({ error: err.message }), { status: err.status });
		}
		return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
	}
};
