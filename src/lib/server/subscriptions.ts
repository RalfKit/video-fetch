import { and, eq, lte } from 'drizzle-orm';
import { db } from './db/index';
import { subscriptions, type Subscription } from './db/schema';
import { prepareDownloadItems } from './downloads-helper';
import { addDownloads } from './db';
import { processDownloads } from './process';
import type { PlaylistInfo, VideoInfo } from 'ytdlp-nodejs';

const schedulerState = {
	started: false,
	timer: null as NodeJS.Timeout | null
};

export async function listSubscriptions() {
	return db.select().from(subscriptions);
}

export async function addSubscription(input: {
	url: string;
	intervalMinutes: number;
	startTime?: string | null;
	folder?: string | null;
	profileId?: string | null;
}) {
	const intervalMinutes = Math.max(15, Math.floor(input.intervalMinutes || 1440));
	const [subscription] = await db
		.insert(subscriptions)
		.values({
			url: input.url,
			intervalMinutes,
			startTime: input.startTime || null,
			folder: input.folder || null,
			profileId: input.profileId || 'best',
			nextCheckAt: nextCheckDate(intervalMinutes, input.startTime)
		})
		.onConflictDoNothing()
		.returning();

	return subscription ?? null;
}

export async function updateSubscriptionEnabled(id: string, enabled: boolean) {
	await db.update(subscriptions).set({ enabled }).where(eq(subscriptions.id, id));
}

export async function checkSubscriptionNow(id: string) {
	const [subscription] = await db
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.id, id))
		.limit(1);

	if (!subscription) return;
	await checkSubscription(subscription);
}

export function startSubscriptionScheduler() {
	if (schedulerState.started) return;
	schedulerState.started = true;

	schedulerState.timer = setInterval(() => {
		void checkDueSubscriptions();
	}, 60_000);

	void checkDueSubscriptions();
}

async function checkDueSubscriptions() {
	const now = new Date();
	const due = await db
		.select()
		.from(subscriptions)
		.where(and(eq(subscriptions.enabled, true), lte(subscriptions.nextCheckAt, now)));

	for (const subscription of due) {
		await checkSubscription(subscription);
	}
}

async function checkSubscription(subscription: Subscription) {
	try {
		const { ytdlp } = await import('./ytdlp');
		const info = (await ytdlp.getInfoAsync(subscription.url)) as PlaylistInfo | VideoInfo;
		const entries =
			info._type === 'playlist' && Array.isArray(info.entries) ? info.entries : [info as VideoInfo];

		const rawItems = entries
			.map((entry) => entryUrl(entry as unknown as Record<string, unknown>))
			.filter((url): url is string => !!url)
			.map((videoUrl) => ({
				videoUrl,
				source: 'subscription' as const,
				subscriptionId: subscription.id,
				folder: subscription.folder,
				profileId: subscription.profileId
			}));

		const withSubscription = await prepareDownloadItems(rawItems, 'subscription');

		await addDownloads(withSubscription);
		await db
			.update(subscriptions)
			.set({
				lastCheckedAt: new Date(),
				nextCheckAt: nextCheckDate(subscription.intervalMinutes, subscription.startTime),
				errorMessage: null
			})
			.where(eq(subscriptions.id, subscription.id));

		void processDownloads();
	} catch (err) {
		await db
			.update(subscriptions)
			.set({
				lastCheckedAt: new Date(),
				nextCheckAt: nextCheckDate(subscription.intervalMinutes, subscription.startTime),
				errorMessage: (err as Error).message
			})
			.where(eq(subscriptions.id, subscription.id));
	}
}

function entryUrl(entry: Record<string, unknown>) {
	const webpageUrl = stringOrNull(entry.webpage_url);
	const url = stringOrNull(entry.url);
	const id = stringOrNull(entry.id);
	if (webpageUrl) return webpageUrl;
	if (url?.startsWith('http')) return url;
	if (id && stringOrNull(entry.extractor)?.toLowerCase().includes('youtube')) {
		return `https://www.youtube.com/watch?v=${id}`;
	}
	return url || id;
}

function stringOrNull(value: unknown) {
	return typeof value === 'string' && value.trim() ? value : null;
}

function nextCheckDate(intervalMinutes: number, startTime?: string | null) {
	const now = new Date();
	const next = new Date(now.getTime() + intervalMinutes * 60_000);
	if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) return next;

	const [hours, minutes] = startTime.split(':').map(Number);
	const anchored = new Date(now);
	anchored.setHours(hours, minutes, 0, 0);
	while (anchored <= now) anchored.setMinutes(anchored.getMinutes() + intervalMinutes);
	return anchored;
}
