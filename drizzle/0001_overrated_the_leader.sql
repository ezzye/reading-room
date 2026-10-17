CREATE TABLE `rr_invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`created_by` text NOT NULL,
	`purpose` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rr_invite_purpose" CHECK("rr_invites"."purpose" IN ('member','device'))
);
--> statement-breakpoint
CREATE INDEX `rr_invites_expiry` ON `rr_invites` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rr_library_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`state` text NOT NULL,
	`checked_at` text NOT NULL,
	`last_error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rr_members` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	CONSTRAINT "rr_member_role" CHECK("rr_members"."role" IN ('owner','member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rr_one_owner` ON `rr_members` (`role`) WHERE "rr_members"."role"='owner';--> statement-breakpoint
CREATE TABLE `rr_recovery_codes` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rr_recovery_expiry` ON `rr_recovery_codes` (`expires_at`,`used_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `rr_one_active_recovery` ON `rr_recovery_codes` (`member_id`) WHERE "rr_recovery_codes"."used_at" IS NULL;--> statement-breakpoint
CREATE TABLE `rr_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`device_label` text DEFAULT 'This device' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `rr_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rr_sessions_member` ON `rr_sessions` (`member_id`,`revoked_at`);