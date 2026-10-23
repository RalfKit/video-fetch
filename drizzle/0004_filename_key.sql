-- Nullable filename duplicate key. Existing rows stay in the list with NULL
-- until startup assigns the key to one preferred row per filename. SQLite
-- allows many NULLs in a unique index, so databases that already contain the
-- same filename twice still migrate. Nothing is deleted.
ALTER TABLE `downloads` ADD `filename_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_downloads_filename_key` ON `downloads` (`filename_key`);
