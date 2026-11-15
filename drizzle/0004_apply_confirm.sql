ALTER TABLE `jobs` ADD `apply_note` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `apply_method` text DEFAULT 'manual' NOT NULL;