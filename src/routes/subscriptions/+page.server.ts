import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	addSubscription,
	checkSubscriptionNow,
	deleteSubscription,
	listSubscriptions,
	type SubscriptionImportMode,
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
		const importMode = normalizeImportMode(formData.get('import_mode')?.toString());
		const importLimit = Number(formData.get('import_limit') || 0) || null;
		const excludeShorts = formData.get('exclude_shorts') === 'on';
		const minDuration = minutesToSeconds(formData.get('min_duration')?.toString());
		const maxDuration = minutesToSeconds(formData.get('max_duration')?.toString());
		const includeKeywords = formData.get('include_keywords')?.toString() || null;
		const excludeKeywords = formData.get('exclude_keywords')?.toString() || null;

		if (!url) return fail(400, { error: 'URL is required' });

		try {
			await addSubscription({
				url,
				intervalMinutes,
				startTime,
				folder,
				profileId,
				importMode,
				importLimit,
				excludeShorts,
				minDuration,
				maxDuration,
				includeKeywords,
				excludeKeywords
			});
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
	},
	delete: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id')?.toString() || '';
		if (!id) return fail(400, { error: 'Subscription ID is required' });
		await deleteSubscription(id);
		return { success: true, deletedId: id };
	}
};

function normalizeImportMode(value?: string | null): SubscriptionImportMode {
	if (value === 'last_days' || value === 'last_videos' || value === 'full_archive') return value;
	return 'new_only';
}

function minutesToSeconds(value?: string | null) {
	const minutes = Number(value);
	if (!Number.isFinite(minutes) || minutes <= 0) return null;
	return Math.floor(minutes * 60);
}
