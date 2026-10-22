-- Nullable dedupe keys. Existing duplicate rows are not deleted: the application
-- assigns each key to one preferred row on startup and leaves the other rows
-- with NULL. SQLite allows many NULLs in a unique index, so this migration
-- succeeds even when the database already contains the same video twice.
ALTER TABLE `downloads` ADD `canonical_url` text;
--> statement-breakpoint
ALTER TABLE `downloads` ADD `media_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_downloads_canonical_url` ON `downloads` (`canonical_url`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_downloads_media_key` ON `downloads` (`media_key`);
