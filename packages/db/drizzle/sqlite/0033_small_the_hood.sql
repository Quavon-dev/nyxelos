CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`task_id` text,
	`agent_run_id` text,
	`agent_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `memory_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_by_agent_id` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `approval_request` ADD `title` text;--> statement-breakpoint
ALTER TABLE `approval_request` ADD `description` text;--> statement-breakpoint
ALTER TABLE `approval_request` ADD `risk_level` text;--> statement-breakpoint
ALTER TABLE `approval_request` ADD `affected_resources` text;--> statement-breakpoint
ALTER TABLE `approval_request` ADD `diff_preview` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD `input_hash` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD `permission_snapshot` text;