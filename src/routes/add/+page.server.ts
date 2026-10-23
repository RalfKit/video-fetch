import { fail, redirect, type ActionFailure } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { prepareDownloadItems, ValidationError } from '$lib/server/downloads-helper';
import { addDownloads, type AddDownloadsOutcome } from '$lib/server/db';
import { duplicateErrorBody, type ListedDuplicate } from '$lib/server/duplicate-guard';
import { processDownloads } from '$lib/server/process';
import { listDownloadFolders } from '$lib/server/folders';
import { listProfiles } from '$lib/server/profiles';

export const load: PageServerLoad = async () => ({
	folders: await listDownloadFolders(),
	profiles: await listProfiles()
});

type AddForm = { error: string; duplicates: ListedDuplicate[] };

export const actions: Actions = {
	addUrl: async ({ request }): Promise<ActionFailure<AddForm>> => {
		try {
			const formData = await request.formData();
			const videoUrl = (formData.get('video_url')?.toString() || '').trim();
			const fileName = formData.get('filename')?.toString() || null;
			const appendTitle = formData.get('append_title') === 'on';
			const profileId = formData.get('profile_id')?.toString() || 'best';
			const folder = formData.get('folder')?.toString() || null;
			const advancedEnabled = formData.get('advanced_enabled') === 'on';
			const customArgs = advancedEnabled ? formData.get('custom_args')?.toString() || null : null;
			const retries = advancedEnabled ? formData.get('retries')?.toString() : null;
			const rateLimit = advancedEnabled ? formData.get('rate_limit')?.toString() || null : null;
			const embedSubtitles = advancedEnabled && formData.get('embed_subtitles') === 'on';

			const items = await prepareDownloadItems({
				videoUrl,
				fileName,
				appendTitle,
				profileId,
				folder,
				customArgs,
				advanced: advancedEnabled
					? {
							retries: retries ? Number(retries) : undefined,
							rateLimit,
							embedSubtitles
						}
					: null
			});

			const outcome = await addDownloads(items);
			const duplicate = duplicateForm(outcome);
			if (duplicate) return fail(409, { error: duplicate.error, duplicates: duplicate.duplicates });
		} catch (err) {
			if (err instanceof ValidationError)
				return fail(err.status, { error: err.message, duplicates: [] });
			return fail(400, { error: (err as Error).message, duplicates: [] });
		}

		redirect(302, '/');
	},

	importBatch: async ({ request }): Promise<ActionFailure<AddForm>> => {
		try {
			const formData = await request.formData();
			const file = formData.get('import_file') as File | null;
			const text = formData.get('import_text')?.toString() || '';

			let content = '';
			if (text.trim()) content = text;
			else if (file && file.size > 0) content = await file.text();

			if (!content.trim()) return fail(400, { error: 'No import data found', duplicates: [] });

			const lines = content
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean);
			if (lines.length === 0) return fail(400, { error: 'No valid lines found', duplicates: [] });

			// Create input array for prepareDownloadItems
			const profileId = formData.get('profile_id')?.toString() || 'best';
			const folder = formData.get('folder')?.toString() || null;

			const raw: Array<{
				videoUrl: string;
				fileName?: string | null;
				profileId: string;
				folder: string | null;
			}> = lines.map((line) => {
				const [url, filename] = line.split('\t');
				return {
					videoUrl: (url || '').trim(),
					fileName: (filename || '').trim() || null,
					profileId,
					folder
				};
			});

			const items = await prepareDownloadItems(raw);
			const outcome = await addDownloads(items);
			const duplicate = duplicateForm(outcome);
			if (duplicate) return fail(409, { error: duplicate.error, duplicates: duplicate.duplicates });
		} catch (err) {
			if (err instanceof ValidationError)
				return fail(err.status, { error: err.message, duplicates: [] });
			return fail(400, { error: (err as Error).message, duplicates: [] });
		}

		redirect(302, '/');
	}
};

function duplicateForm(outcome: AddDownloadsOutcome) {
	const added = outcome.queued.length + outcome.retried.length;
	if (added > 0) void processDownloads();
	if (outcome.duplicates.length === 0) return null;

	const body = duplicateErrorBody(outcome.duplicates);
	return {
		error: added > 0 ? `Added ${added}.\n${body.error}` : body.error,
		duplicates: body.duplicates
	};
}
