CREATE TABLE `rr_room_articles` (
	`room_id` text NOT NULL,
	`page_id` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`room_id`, `page_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rr_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_id`) REFERENCES `education_pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rr_room_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`page_id` text NOT NULL,
	`member_id` text NOT NULL,
	`parent_id` text,
	`request_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rr_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_id`) REFERENCES `education_pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rr_comment_status" CHECK("rr_room_comments"."status" IN ('pending','approved','hidden'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rr_comment_request` ON `rr_room_comments` (`room_id`,`member_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `rr_comments_page` ON `rr_room_comments` (`room_id`,`page_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `rr_comments_parent` ON `rr_room_comments` (`room_id`,`page_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `rr_room_members` (
	`room_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text NOT NULL,
	`revoked_at` text,
	PRIMARY KEY(`room_id`, `member_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rr_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rr_membership_role" CHECK("rr_room_members"."role" IN ('owner','member'))
);
--> statement-breakpoint
CREATE INDEX `rr_membership_member` ON `rr_room_members` (`member_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `rr_room_migrations` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rr_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`moderation` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rr_room_moderation" CHECK("rr_rooms"."moderation" IN ('open','approval'))
);
--> statement-breakpoint
ALTER TABLE `rr_invites` ADD `room_id` text REFERENCES rr_rooms(id);--> statement-breakpoint
ALTER TABLE `rr_invites` ADD `article_id` text REFERENCES education_pages(id);