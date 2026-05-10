import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	addSubscription,
	checkSubscriptionNow,
	listSubscriptions,
	updateSubscriptionEnabled
} from '$lib/server/subscriptions';
import { listDownloadFolders } from '$lib/server/folders';
import { listProfiles } from '$lib/server/profiles';

export const load: PageServerLoad = async () => ({
	subscriptions: await listSubscriptions(),
	folders: await listDownloadFolders(),
	profiles: await listProfiles()
});

export const actions: Actions = {
	add: async ({ request }) => {
		const formData = await request.formData();
		const url = formData.get('url')?.toString().trim() || '';
		const intervalMinutes = Number(formData.get('interval_minutes') || 1440);
		const startTime = formData.get('start_time')?.toString() || null;
		const folder = formData.get('folder')?.toString() || null;
		const profileId = formData.get('profile_id')?.toString() || 'best';

		if (!url) return fail(400, { error: 'URL is required' });

		try {
			await addSubscription({ url, intervalMinutes, startTime, folder, profileId });
		} catch (err) {
			return fail(400, { error: (err as Error).message });
		}

		redirect(302, '/subscriptions');
	},
	toggle: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id')?.toString() || '';
		const enabled = formData.get('enabled') === 'true';
		await updateSubscriptionEnabled(id, enabled);
		return { success: true };
	},
	checkNow: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id')?.toString() || '';
		await checkSubscriptionNow(id);
		return { success: true };
	}
};
