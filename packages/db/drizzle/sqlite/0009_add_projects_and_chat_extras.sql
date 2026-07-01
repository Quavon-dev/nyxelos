CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chat` ADD `project_id` text REFERENCES project(id);--> statement-breakpoint
ALTER TABLE `chat` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `chat` ADD `share_id` text;--> statement-breakpoint
ALTER TABLE `chat` ADD `shared_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_share_id_unique` ON `chat` (`share_id`);