CREATE TABLE `rr_private_asset_parts` (
	`upload_id` text NOT NULL,
	`part` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`upload_id`, `part`),
	FOREIGN KEY (`upload_id`) REFERENCES `rr_private_assets`(`upload_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rr_private_assets` (
	`name` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`parts` integer NOT NULL,
	`sha256` text NOT NULL,
	`ready` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "rr_asset_ready" CHECK("rr_private_assets"."ready" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rr_private_assets_upload_id_unique` ON `rr_private_assets` (`upload_id`);