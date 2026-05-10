import { and, eq, lte, or } from 'drizzle-orm';
import { db } from './db/index';
import { downloads, subscriptions, type Subscription } from './db/schema';
import { prepareDownloadItems } from './downloads-helper';
import { addDownloads } from './db';
import { processDownloads } from './process';
import type { PlaylistInfo, VideoInfo } from 'ytdlp-nodejs';

export type SubscriptionImportMode = 'new_only' | 'last_days' | 'last_videos' | 'full_archive';

type SubscriptionEntry = {
	key: string;
	url: string;
	title: string | null;
	duration: number | null;
	timestamp: Date | null;
	isShort: boolean;
	raw: Record<string, unknown>;
};

type SubscriptionCheckpoint = {
	seenKeys: string[];
	updatedAt: string;
};

const MAX_CHECKPOINT_KEYS = 2000;

const schedulerState = {
	started: false,
	timer: null as NodeJS.Timeout | null
};

const deletedSubscriptions = new Set<string>();
const activeChecks = new Set<string>();

export async function listSubscriptions() {
	return db.select().from(subscriptions);
}

export function validateSubscriptionFilterRules(now = new Date()) {
	const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
	const entries: SubscriptionEntry[] = [
		validationEntry('normal-new', 'Normal new video', 600, oneDayAgo, false),
		validationEntry('short-new', 'Short new video #shorts', 35, oneDayAgo, true),
		validationEntry('normal-old', 'Normal old video', 700, tenDaysAgo, false)
	];

	const stats = emptyStats(entries.length);
	const noInitial = selectInitialImportEntries(entries, 'new_only', null, stats).length === 0;
	const lastTwoVideos =
		selectInitialImportEntries(entries, 'last_videos', 2, emptyStats(entries.length)).map((entry) => entry.key)
			.join(',') === 'normal-new,short-new';
	const lastThreeDays =
		selectInitialImportEntries(entries, 'last_days', 3, emptyStats(entries.length)).map((entry) => entry.key)
			.join(',') === 'normal-new,short-new';
	const noShorts =
		filterContent(
			entries,
			{
				excludeShorts: true,
				minDuration: null,
				maxDuration: null,
				includeKeywords: null,
				excludeKeywords: null
			},
			emptyStats(entries.length)
		).map((entry) => entry.key).join(',') === 'normal-new,normal-old';
	const combined =
		selectInitialImportEntries(
			filterContent(
				entries,
				{
					excludeShorts: true,
					minDuration: null,
					maxDuration: null,
					includeKeywords: null,
					excludeKeywords: null
				},
				emptyStats(entries.length)
			),
			'last_days',
			3,
			emptyStats(entries.length)
		).map((entry) => entry.key).join(',') === 'normal-new';

	return { noInitial, lastTwoVideos, lastThreeDays, noShorts, combined };
}

export async function addSubscription(input: {
	url: string;
	intervalMinutes: number;
	startTime?: string | null;
	folder?: string | null;
	profileId?: string | null;
	importMode?: SubscriptionImportMode;
	importLimit?: number | null;
	excludeShorts?: boolean;
	minDuration?: number | null;
	maxDuration?: number | null;
	includeKeywords?: string | null;
	excludeKeywords?: string | null;
}) {
	const intervalMinutes = Math.max(15, Math.floor(input.intervalMinutes || 1440));
	const importMode = input.importMode ?? 'new_only';
	const now = new Date();

	const entries = await fetchSubscriptionEntries(input.url);
	const eligibleEntries = await runImportPipeline(entries, {
		subscriptionId: null,
		importMode,
		importLimit: input.importLimit ?? null,
		excludeShorts: !!input.excludeShorts,
		minDuration: input.minDuration ?? null,
		maxDuration: input.maxDuration ?? null,
		includeKeywords: input.includeKeywords ?? null,
		excludeKeywords: input.excludeKeywords ?? null,
		lastCheckedAt: null,
		checkpoint: null,
		stage: 'initial'
	});

	const [subscription] = await db
		.insert(subscriptions)
		.values({
			url: input.url,
			intervalMinutes,
			startTime: input.startTime || null,
			folder: input.folder || null,
			profileId: input.profileId || 'best',
			lastCheckedAt: now,
			nextCheckAt: nextCheckDate(intervalMinutes, input.startTime),
			checkpointJson: buildCheckpoint(entries),
			importMode,
			importLimit: input.importLimit ?? null,
			excludeShorts: !!input.excludeShorts,
			minDuration: input.minDuration ?? null,
			maxDuration: input.maxDuration ?? null,
			includeKeywords: normalizeKeywordText(input.includeKeywords),
			excludeKeywords: normalizeKeywordText(input.excludeKeywords)
		})
		.onConflictDoNothing()
		.returning();

	if (!subscription) return null;

	if (eligibleEntries.length > 0) {
		await enqueueEntries(subscription, eligibleEntries);
	}

	return subscription;
}

export async function deleteSubscription(id: string) {
	deletedSubscriptions.add(id);

	await db.transaction((tx) => {
		tx.update(downloads).set({ subscriptionId: null }).where(eq(downloads.subscriptionId, id)).run();
		tx.delete(subscriptions).where(eq(subscriptions.id, id)).run();
	});

	console.info('[subscriptions] Deleted subscription', {
		id,
		activeCheckWasRunning: activeChecks.has(id)
	});
}

export async function updateSubscriptionEnabled(id: string, enabled: boolean) {
	if (deletedSubscriptions.has(id)) return;
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
		if (deletedSubscriptions.has(subscription.id)) continue;
		await checkSubscription(subscription);
	}
}

async function checkSubscription(subscription: Subscription) {
	if (deletedSubscriptions.has(subscription.id) || activeChecks.has(subscription.id)) return;
	activeChecks.add(subscription.id);

	try {
		const entries = await fetchSubscriptionEntries(subscription.url);
		const checkpoint = parseCheckpoint(subscription.checkpointJson);
		const newEntries = await runImportPipeline(entries, {
			subscriptionId: subscription.id,
			importMode: 'new_only',
			importLimit: null,
			excludeShorts: !!subscription.excludeShorts,
			minDuration: subscription.minDuration,
			maxDuration: subscription.maxDuration,
			includeKeywords: subscription.includeKeywords,
			excludeKeywords: subscription.excludeKeywords,
			lastCheckedAt: subscription.lastCheckedAt ?? subscription.createdAt,
			checkpoint,
			stage: 'poll'
		});

		if (deletedSubscriptions.has(subscription.id) || !(await subscriptionExists(subscription.id))) return;

		await enqueueEntries(subscription, newEntries);
		await markSubscriptionChecked(subscription, entries, null);
		void processDownloads();
	} catch (err) {
		if (deletedSubscriptions.has(subscription.id) || !(await subscriptionExists(subscription.id))) return;
		await db
			.update(subscriptions)
			.set({
				lastCheckedAt: new Date(),
				nextCheckAt: nextCheckDate(subscription.intervalMinutes, subscription.startTime),
				errorMessage: (err as Error).message
			})
			.where(eq(subscriptions.id, subscription.id));
	} finally {
		activeChecks.delete(subscription.id);
	}
}

async function fetchSubscriptionEntries(url: string) {
	const { ytdlp } = await import('./ytdlp');
	const info = (await ytdlp.getInfoAsync(url)) as PlaylistInfo | VideoInfo;
	const rawEntries =
		info._type === 'playlist' && Array.isArray(info.entries) ? info.entries : [info as VideoInfo];

	return rawEntries
		.map((entry) => normalizeEntry(entry as unknown as Record<string, unknown>))
		.filter((entry): entry is SubscriptionEntry => entry !== null);
}

function normalizeEntry(entry: Record<string, unknown>): SubscriptionEntry | null {
	const url = entryUrl(entry);
	if (!url) return null;

	const id = stringOrNull(entry.id);
	const key = id || url;

	return {
		key,
		url,
		title: stringOrNull(entry.title),
		duration: numberOrNull(entry.duration),
		timestamp: entryDate(entry),
		isShort: detectShort(entry),
		raw: entry
	};
}

async function runImportPipeline(
	entries: SubscriptionEntry[],
	options: {
		subscriptionId: string | null;
		importMode: SubscriptionImportMode;
		importLimit: number | null;
		excludeShorts: boolean;
		minDuration?: number | null;
		maxDuration?: number | null;
		includeKeywords?: string | null;
		excludeKeywords?: string | null;
		lastCheckedAt: Date | null;
		checkpoint: SubscriptionCheckpoint | null;
		stage: 'initial' | 'poll';
	}
) {
	const stats = emptyStats(entries.length);

	let current = entries;

	current = await filterDuplicates(current, stats);

	if (options.stage === 'poll') {
		const seen = new Set(options.checkpoint?.seenKeys ?? []);
		current = current.filter((entry) => {
			if (seen.has(entry.key)) {
				stats.checkpoint++;
				return false;
			}
			if (options.lastCheckedAt && entry.timestamp && entry.timestamp <= options.lastCheckedAt) {
				stats.notNew++;
				return false;
			}
			return true;
		});
	}

	current = filterContent(current, options, stats);
	current = selectInitialImportEntries(current, options.importMode, options.importLimit, stats);
	stats.selected = current.length;

	console.info('[subscriptions] Import filter result', {
		subscriptionId: options.subscriptionId,
		stage: options.stage,
		importMode: options.importMode,
		importLimit: options.importLimit,
		excludeShorts: options.excludeShorts,
		stats
	});

	if (stats.fetched > 0 && current.length === 0) {
		console.info('[subscriptions] No entries selected after filtering', {
			subscriptionId: options.subscriptionId,
			stage: options.stage,
			importMode: options.importMode,
			stats
		});
	}

	return current;
}

async function filterDuplicates(entries: SubscriptionEntry[], stats: Record<string, number>) {
	const result: SubscriptionEntry[] = [];

	for (const entry of entries) {
		const extractor = stringOrNull(entry.raw.extractor);
		const id = stringOrNull(entry.raw.id);
		const duplicate = await db
			.select({ id: downloads.id })
			.from(downloads)
			.where(
				or(
					eq(downloads.videoUrl, entry.url),
					and(eq(downloads.extractor, extractor ?? ''), eq(downloads.extractorVideoId, id ?? ''))
				)
			)
			.limit(1);

		if (duplicate.length > 0) {
			stats.duplicate++;
			continue;
		}

		result.push(entry);
	}

	return result;
}

function selectInitialImportEntries(
	entries: SubscriptionEntry[],
	importMode: SubscriptionImportMode,
	importLimit: number | null,
	stats: Record<string, number>
) {
	switch (importMode) {
		case 'new_only':
			return [];
		case 'last_days': {
			const days = Math.max(1, Math.floor(importLimit || 7));
			const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
			return entries.filter((entry) => {
				if (!entry.timestamp || entry.timestamp < cutoff) {
					stats.date++;
					return false;
				}
				return true;
			});
		}
		case 'last_videos':
			return entries.slice(0, Math.max(1, Math.floor(importLimit || 20)));
		case 'full_archive':
			return entries;
	}
}

function emptyStats(fetched: number): Record<string, number> {
	return {
		fetched,
		duplicate: 0,
		checkpoint: 0,
		notNew: 0,
		shorts: 0,
		duration: 0,
		includeKeyword: 0,
		excludeKeyword: 0,
		date: 0,
		selected: 0
	};
}

function validationEntry(
	key: string,
	title: string,
	duration: number,
	timestamp: Date,
	isShort: boolean
): SubscriptionEntry {
	return {
		key,
		url: `https://example.com/watch/${key}`,
		title,
		duration,
		timestamp,
		isShort,
		raw: { id: key, title, duration, timestamp: Math.floor(timestamp.getTime() / 1000) }
	};
}

function filterContent(
	entries: SubscriptionEntry[],
	filter: {
		excludeShorts: boolean;
		minDuration?: number | null;
		maxDuration?: number | null;
		includeKeywords?: string | null;
		excludeKeywords?: string | null;
	},
	stats: Record<string, number>
) {
	const include = parseKeywords(filter.includeKeywords);
	const exclude = parseKeywords(filter.excludeKeywords);

	return entries.filter((entry) => {
		const title = (entry.title ?? '').toLowerCase();
		if (filter.excludeShorts && entry.isShort) {
			stats.shorts++;
			return false;
		}
		if (filter.minDuration && entry.duration !== null && entry.duration < filter.minDuration) {
			stats.duration++;
			return false;
		}
		if (filter.maxDuration && entry.duration !== null && entry.duration > filter.maxDuration) {
			stats.duration++;
			return false;
		}
		if (include.length > 0 && !include.some((keyword) => title.includes(keyword))) {
			stats.includeKeyword++;
			return false;
		}
		if (exclude.length > 0 && exclude.some((keyword) => title.includes(keyword))) {
			stats.excludeKeyword++;
			return false;
		}
		return true;
	});
}

async function enqueueEntries(subscription: Subscription, entries: SubscriptionEntry[]) {
	if (entries.length === 0) return;
	if (deletedSubscriptions.has(subscription.id) || !(await subscriptionExists(subscription.id))) return;

	const rawItems = entries.map((entry) => ({
		videoUrl: entry.url,
		source: 'subscription' as const,
		subscriptionId: subscription.id,
		folder: subscription.folder,
		profileId: subscription.profileId
	}));

	const queueItems = await prepareDownloadItems(rawItems, 'subscription');
	if (deletedSubscriptions.has(subscription.id) || !(await subscriptionExists(subscription.id))) return;
	await addDownloads(queueItems);
	void processDownloads();
}

async function markSubscriptionChecked(
	subscription: Subscription,
	entries: SubscriptionEntry[],
	errorMessage: string | null
) {
	if (deletedSubscriptions.has(subscription.id) || !(await subscriptionExists(subscription.id))) return;

	await db
		.update(subscriptions)
		.set({
			lastCheckedAt: new Date(),
			nextCheckAt: nextCheckDate(subscription.intervalMinutes, subscription.startTime),
			checkpointJson: buildCheckpoint(entries, parseCheckpoint(subscription.checkpointJson)),
			errorMessage
		})
		.where(eq(subscriptions.id, subscription.id));
}

function buildCheckpoint(entries: SubscriptionEntry[], previous?: SubscriptionCheckpoint) {
	const keys = [...entries.map((entry) => entry.key), ...(previous?.seenKeys ?? [])];
	return JSON.stringify({
		seenKeys: Array.from(new Set(keys)).slice(0, MAX_CHECKPOINT_KEYS),
		updatedAt: new Date().toISOString()
	} satisfies SubscriptionCheckpoint);
}

function parseCheckpoint(input?: string | null): SubscriptionCheckpoint {
	if (!input) return { seenKeys: [], updatedAt: new Date(0).toISOString() };
	try {
		const parsed = JSON.parse(input) as SubscriptionCheckpoint;
		return {
			seenKeys: Array.isArray(parsed.seenKeys) ? parsed.seenKeys.filter(Boolean) : [],
			updatedAt: parsed.updatedAt || new Date(0).toISOString()
		};
	} catch {
		return { seenKeys: [], updatedAt: new Date(0).toISOString() };
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

function entryDate(entry: Record<string, unknown>) {
	const timestamp =
		numberOrNull(entry.timestamp) ?? numberOrNull(entry.release_timestamp) ?? numberOrNull(entry.epoch);
	if (timestamp) return new Date(timestamp * 1000);

	const uploadDate =
		stringOrNull(entry.upload_date) ??
		stringOrNull(entry.release_date) ??
		stringOrNull(entry.modified_date);
	if (uploadDate && /^\d{8}$/.test(uploadDate)) {
		const year = Number(uploadDate.slice(0, 4));
		const month = Number(uploadDate.slice(4, 6)) - 1;
		const day = Number(uploadDate.slice(6, 8));
		return new Date(Date.UTC(year, month, day));
	}

	return null;
}

function detectShort(entry: Record<string, unknown>) {
	const url = [
		stringOrNull(entry.webpage_url),
		stringOrNull(entry.url),
		stringOrNull(entry.original_url)
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	const title = stringOrNull(entry.title)?.toLowerCase() ?? '';
	const typeHints = [
		stringOrNull(entry.extractor),
		stringOrNull(entry.extractor_key),
		stringOrNull(entry.ie_key),
		stringOrNull(entry.playlist_title),
		stringOrNull(entry.channel),
		stringOrNull(entry.category),
		stringOrNull(entry.media_type),
		stringOrNull(entry.live_status)
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	const duration = numberOrNull(entry.duration);
	const tags = Array.isArray(entry.tags)
		? entry.tags.map((tag) => String(tag).toLowerCase())
		: [];

	if (url.includes('/shorts/')) return true;
	if (typeHints.includes('shorts')) return true;
	if (tags.includes('shorts') || tags.includes('#shorts')) return true;
	if (title.includes('#shorts') || title.includes('#short')) return true;

	// Duration alone is not enough: channels often publish normal clips under a minute.
	return duration !== null && duration <= 60 && (typeHints.includes('short') || url.includes('short'));
}

function parseKeywords(input?: string | null) {
	return (input ?? '')
		.split(',')
		.map((keyword) => keyword.trim().toLowerCase())
		.filter(Boolean);
}

function normalizeKeywordText(input?: string | null) {
	return parseKeywords(input).join(', ');
}

function numberOrNull(value: unknown) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown) {
	return typeof value === 'string' && value.trim() ? value : null;
}

async function subscriptionExists(id: string) {
	const [subscription] = await db
		.select({ id: subscriptions.id })
		.from(subscriptions)
		.where(eq(subscriptions.id, id))
		.limit(1);
	return !!subscription;
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
