CREATE TABLE `skill` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`kind` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`sensitive` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `automation` ADD `trigger_type` text DEFAULT 'cron' NOT NULL;
--> statement-breakpoint
ALTER TABLE `automation` ADD `watch_path` text;
--> statement-breakpoint
ALTER TABLE `automation` ADD `watch_glob` text;
--> statement-breakpoint
ALTER TABLE `automation` ADD `last_watch_check_at` integer;
--> statement-breakpoint
ALTER TABLE `knowledge_base_config` ADD `inject_into_prompts` integer DEFAULT true NOT NULL;
