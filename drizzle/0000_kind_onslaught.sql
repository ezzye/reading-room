CREATE TABLE `education_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`n` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `education_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`source_hash` text NOT NULL,
	`source_url` text NOT NULL,
	`title` text NOT NULL,
	`document` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `education_pages_source_hash_unique` ON `education_pages` (`source_hash`);--> statement-breakpoint
CREATE TABLE `education_shares` (
	`token` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`request_id` text NOT NULL,
	`day` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `education_pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_request` ON `education_shares` (`page_id`,`request_id`);