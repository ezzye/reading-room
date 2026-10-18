CREATE TABLE `rr_library_search_choices` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`member_id` text NOT NULL,
	`publisher_key` text NOT NULL,
	`title` text NOT NULL,
	`source_date` text NOT NULL,
	`publication` text NOT NULL,
	`library_url` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rr_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rr_library_choices_expiry` ON `rr_library_search_choices` (`room_id`,`member_id`,`expires_at`);