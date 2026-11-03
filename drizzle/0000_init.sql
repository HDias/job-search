CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`run_id` text,
	`kind` text NOT NULL,
	`relative_path` text NOT NULL,
	`mime` text,
	`size_bytes` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `artifacts_job_idx` ON `artifacts` (`job_id`);--> statement-breakpoint
CREATE INDEX `artifacts_kind_idx` ON `artifacts` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_job_kind_path_uq` ON `artifacts` (`job_id`,`kind`,`relative_path`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`vacancy_url` text,
	`apply_url` text,
	`language` text DEFAULT 'pt-br' NOT NULL,
	`stack` text DEFAULT 'ruby' NOT NULL,
	`channel` text,
	`status` text DEFAULT 'drafted' NOT NULL,
	`applied_at` text,
	`fit_rating` real,
	`fit_analysis` text,
	`fit_json` text,
	`applied_emails` text,
	`cover_letter_guidance` text,
	`cover_in_cv_required` integer,
	`cover_in_cv_reason` text,
	`has_recruiter_message` integer DEFAULT false NOT NULL,
	`has_questions` integer DEFAULT false NOT NULL,
	`skill_grounded` integer,
	`fit_confirmed` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_owner_idx` ON `jobs` (`owner_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_applied_at_idx` ON `jobs` (`applied_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`stack` text NOT NULL,
	`language` text NOT NULL,
	`content` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`stack`, `language`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`stage` text DEFAULT 'draft' NOT NULL,
	`url` text,
	`language_preference` text,
	`detected_language` text,
	`suggested_language` text,
	`needs_language_confirmation` integer DEFAULT false NOT NULL,
	`needs_fit_confirmation` integer DEFAULT false NOT NULL,
	`eligibility_blocked` integer DEFAULT false NOT NULL,
	`has_raw_text` integer DEFAULT false NOT NULL,
	`has_extra_questions` integer DEFAULT false NOT NULL,
	`has_recruiter_message` integer DEFAULT false NOT NULL,
	`error` text,
	`fit_json` text,
	`job_snapshot` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `runs_job_idx` ON `runs` (`job_id`);--> statement-breakpoint
CREATE INDEX `runs_stage_idx` ON `runs` (`stage`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text NOT NULL
);
