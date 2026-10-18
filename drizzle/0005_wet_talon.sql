CREATE TABLE `rr_page_lens_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text,
	`capture` text,
	FOREIGN KEY (`session_id`) REFERENCES `rr_page_lens_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rr_lens_pending` ON `rr_page_lens_commands` (`session_id`,`state`);--> statement-breakpoint
CREATE TABLE `rr_page_lens_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`pair_hash` text NOT NULL,
	`token_hash` text,
	`session_hash` text NOT NULL,
	`room_id` text NOT NULL,
	`member_id` text NOT NULL,
	`article_url` text NOT NULL,
	`extension_origin` text,
	`created_at` text NOT NULL,
	`pair_expires_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`paired_at` text,
	`revoked_at` text,
	FOREIGN KEY (`session_hash`) REFERENCES `rr_sessions`(`token_hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rr_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rr_page_lens_sessions_pair_hash_unique` ON `rr_page_lens_sessions` (`pair_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `rr_page_lens_sessions_token_hash_unique` ON `rr_page_lens_sessions` (`token_hash`);