import { prepareDownloadItems, ValidationError } from '$lib/server/downloads-helper';
import { addDownloads } from '$lib/server/db';
import { duplicateErrorBody } from '$lib/server/duplicate-guard';
import { processDownloads } from '$lib/server/process';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const data = await request.json();

		const items = await prepareDownloadItems(data, 'api');
		const outcome = await addDownloads(items);
		const added = outcome.queued.length + outcome.retried.length;
		if (added > 0) void processDownloads();

		const duplicateBody = duplicateErrorBody(outcome.duplicates);
		if (outcome.duplicates.length > 0 && added === 0) {
			return new Response(JSON.stringify(duplicateBody), { status: 409 });
		}

		return new Response(
			JSON.stringify({
				message:
					duplicateBody.duplicates.length > 0 ? duplicateBody.error : 'Downloads added to queue',
				queued: added,
				inserted: outcome.queued.length,
				retried: outcome.retried.length,
				duplicates: duplicateBody.duplicates
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
