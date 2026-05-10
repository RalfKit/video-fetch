import type { DownloadQuality, DownloadSource, DownloadStatus } from '$lib/types/download';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const downloads = sqliteTable(
	'downloads',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		videoUrl: text('video_url').notNull(),
		originalUrl: text('original_url'),
		source: text('source').notNull().$type<DownloadSource>().default('manual'),
		subscriptionId: text('subscription_id'),
		profileId: text('profile_id'),
		folder: text('folder'),
		fileName: text('file_name'),
		appendTitle: integer('append_title', { mode: 'boolean' }).notNull(),
		quality: text('quality').notNull().$type<DownloadQuality>(),
		status: text('status').notNull().$type<DownloadStatus>(),
		errorMessage: text('error_message'),
		title: text('title'),
		extractor: text('extractor'),
		extractorVideoId: text('extractor_video_id'),
		thumbnailUrl: text('thumbnail_url'),
		duration: integer('duration'),
		filePath: text('file_path'),
		metadataJson: text('metadata_json'),
		advancedOptionsJson: text('advanced_options_json'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.$onUpdateFn(() => new Date()),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		uniqueIndex('uq_downloads_video_url').on(t.videoUrl),
		index('idx_downloads_status').on(t.status),
		index('idx_downloads_media_identity').on(t.extractor, t.extractorVideoId)
	]
);

export const downloadProfiles = sqliteTable('download_profiles', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	optionsJson: text('options_json').notNull(),
	isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const subscriptions = sqliteTable(
	'subscriptions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		url: text('url').notNull(),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		intervalMinutes: integer('interval_minutes').notNull().default(1440),
		startTime: text('start_time'),
		lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
		nextCheckAt: integer('next_check_at', { mode: 'timestamp_ms' }),
		folder: text('folder'),
		profileId: text('profile_id'),
		errorMessage: text('error_message'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.$onUpdateFn(() => new Date())
	},
	(t) => [uniqueIndex('uq_subscriptions_url').on(t.url), index('idx_subscriptions_due').on(t.enabled, t.nextCheckAt)]
);

export type DownloadAdd = typeof downloads.$inferInsert;
export type Download = typeof downloads.$inferSelect;
export type DownloadProfile = typeof downloadProfiles.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
