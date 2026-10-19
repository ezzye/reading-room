CREATE TABLE `rr_room_article_archive` (
	`room_id` text NOT NULL,
	`page_id` text NOT NULL,
	`archived_by` text NOT NULL,
	`archived_at` text NOT NULL,
	PRIMARY KEY(`room_id`, `page_id`),
	FOREIGN KEY (`archived_by`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`,`page_id`) REFERENCES `rr_room_articles`(`room_id`,`page_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rr_article_archive_order` ON `rr_room_article_archive` (`room_id`,`archived_at`,`page_id`);