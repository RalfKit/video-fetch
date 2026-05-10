ALTER TABLE `downloads` ADD `original_url` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `source` text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE `downloads` ADD `subscription_id` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `profile_id` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `folder` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `title` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `extractor` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `extractor_video_id` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `thumbnail_url` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `duration` integer;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `file_path` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `metadata_json` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `advanced_options_json` text;
--> statement-breakpoint
UPDATE `downloads` SET `status` = 'completed' WHERE `status` = 'finished';
--> statement-breakpoint
UPDATE `downloads` SET `status` = 'failed' WHERE `status` = 'error';
--> statement-breakpoint
CREATE INDEX `idx_downloads_status` ON `downloads` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_downloads_media_identity` ON `downloads` (`extractor`, `extractor_video_id`);
--> statement-breakpoint
CREATE TABLE `download_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`options_json` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`interval_minutes` integer DEFAULT 1440 NOT NULL,
	`start_time` text,
	`last_checked_at` integer,
	`next_check_at` integer,
	`folder` text,
	`profile_id` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_subscriptions_url` ON `subscriptions` (`url`);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_due` ON `subscriptions` (`enabled`, `next_check_at`);
