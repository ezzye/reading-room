CREATE TABLE `rr_article_source_aliases` (
	`room_id` text NOT NULL,
	`publisher_url` text NOT NULL,
	`page_id` text NOT NULL,
	`verified_at` text NOT NULL,
	PRIMARY KEY(`room_id`, `publisher_url`),
	FOREIGN KEY (`room_id`,`page_id`) REFERENCES `rr_verified_library_pages`(`room_id`,`page_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rr_library_import_claims` (
	`room_id` text NOT NULL,
	`library_url` text NOT NULL,
	`claim_id` text NOT NULL,
	`member_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `library_url`),
	FOREIGN KEY (`room_id`) REFERENCES `rr_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rr_library_import_claims_claim_id_unique` ON `rr_library_import_claims` (`claim_id`);--> statement-breakpoint
CREATE TABLE `rr_verified_library_pages` (
	`room_id` text NOT NULL,
	`page_id` text NOT NULL,
	`library_url` text NOT NULL,
	`publisher_key` text NOT NULL,
	`publication` text NOT NULL,
	`source_title` text NOT NULL,
	`source_date` text NOT NULL,
	`paragraph_fingerprint` text NOT NULL,
	`proof_revision` text NOT NULL,
	`verified_at` text NOT NULL,
	PRIMARY KEY(`room_id`, `page_id`),
	FOREIGN KEY (`room_id`,`page_id`) REFERENCES `rr_room_articles`(`room_id`,`page_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rr_verified_library_record` ON `rr_verified_library_pages` (`room_id`,`library_url`);