ALTER TABLE `subscriptions` ADD `checkpoint_json` text;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `import_mode` text NOT NULL DEFAULT 'new_only';
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `import_limit` integer;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `exclude_shorts` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `min_duration` integer;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `max_duration` integer;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `include_keywords` text;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `exclude_keywords` text;
