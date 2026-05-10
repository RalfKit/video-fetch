// +page.server.ts
import { concurrency, downloads, paused } from '$lib/server/store';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { get } from 'svelte/store';
import { deleteDownload, setStatus } from '$lib/server/db';
import { removeFromQueue } from '$lib/server/process';
import { processDownloads } from '$lib/server/process';

export const load: PageServerLoad = () => {
	const download = get(downloads);
	const isPaused = get(paused);
	const parallelDownloads = get(concurrency);

	return {
		download,
		isPaused,
		parallelDownloads
	};
};

export const actions = {
	setPause: async ({ request }) => {
		try {
			const formData = await request.formData();

			const pause = formData.get('pause') === 'true'; // Checkbox liefert "on" wenn angehakt

			paused.set(pause);

			// Optional: Erfolgsmeldung zurück ans Frontend
			return { success: true };
		} catch (error) {
			console.log('error: ', (error as Error).message);
			return fail(400, { error: (error as Error).message });
		}
	},
	setConcurrency: async ({ request }) => {
		try {
			const formData = await request.formData();

			const newConcurrency = parseInt(formData.get('concurrency')?.toString() || '1', 10);

			concurrency.set(newConcurrency);

			// Optional: Erfolgsmeldung zurück ans Frontend
			return { success: true };
		} catch (error) {
			console.log('error: ', (error as Error).message);
			return fail(400, { error: (error as Error).message });
		}
	},
	deleteDownload: async ({ request }) => {
		const formData = await request.formData();

		const id = formData.get('id')?.toString() || null;

		if (id?.length !== 36) {
			console.log("error: 'Invalid ID'");
			return fail(400, { error: 'Invalid ID' });
		}

		await deleteDownload(id);

		return { success: true };
	},
	cancelDownload: async ({ request }) => {
		const formData = await request.formData();

		const id = formData.get('id')?.toString() || null;

		if (id?.length !== 36) {
			console.log("error: 'Invalid ID'");
			return fail(400, { error: 'Invalid ID' });
		}

		try {
			await removeFromQueue(id);
		} catch (err) {
			console.warn('Cancel ignored:', err);
		}

		return { success: true };
	},
	retryDownload: async ({ request }) => {
		const formData = await request.formData();

		const id = formData.get('id')?.toString() || null;

		if (id?.length !== 36) {
			console.log("error: 'Invalid ID'", id?.length);
			return fail(400, { error: 'Invalid ID' });
		}

		await setStatus(id, 'pending', null);

		void processDownloads();

		return { success: true };
	}
} satisfies Actions;
