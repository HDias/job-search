PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`stage` text DEFAULT 'queued' NOT NULL,
	`url` text,
	`stack` text,
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
	`job_json` text,
	`job_snapshot` text,
	`llm_question` text,
	`needs_input_rounds` integer DEFAULT 0 NOT NULL,
	`clarification_history` text,
	`cover_letter_guidance` text,
	`include_cover_in_cv` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_runs`("id", "job_id", "stage", "url", "stack", "language_preference", "detected_language", "suggested_language", "needs_language_confirmation", "needs_fit_confirmation", "eligibility_blocked", "has_raw_text", "has_extra_questions", "has_recruiter_message", "error", "fit_json", "job_json", "job_snapshot", "created_at", "updated_at") SELECT "id", "job_id", "stage", "url", "stack", "language_preference", "detected_language", "suggested_language", "needs_language_confirmation", "needs_fit_confirmation", "eligibility_blocked", "has_raw_text", "has_extra_questions", "has_recruiter_message", "error", "fit_json", "job_json", "job_snapshot", "created_at", "updated_at" FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `runs_job_idx` ON `runs` (`job_id`);--> statement-breakpoint
CREATE INDEX `runs_stage_idx` ON `runs` (`stage`);
