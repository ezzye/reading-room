CREATE TABLE `rr_article_links` (
	`code` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`page_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`,`page_id`) REFERENCES `rr_room_articles`(`room_id`,`page_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rr_article_link_target` ON `rr_article_links` (`room_id`,`page_id`);