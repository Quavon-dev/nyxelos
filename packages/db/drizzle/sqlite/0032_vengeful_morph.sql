PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text,
	`workflow_id` text,
	`target_kind` text DEFAULT 'agent' NOT NULL,
	`name` text NOT NULL,
	`trigger_type` text DEFAULT 'cron' NOT NULL,
	`cron_expression` text DEFAULT '' NOT NULL,
	`watch_path` text,
	`watch_glob` text,
	`last_watch_check_at` integer,
	`prompt` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`last_run_status` text,
	`last_error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_automation`("id", "workspace_id", "agent_id", "name", "trigger_type", "cron_expression", "watch_path", "watch_glob", "last_watch_check_at", "prompt", "enabled", "last_run_at", "next_run_at", "last_run_status", "last_error_message", "created_at") SELECT "id", "workspace_id", "agent_id", "name", "trigger_type", "cron_expression", "watch_path", "watch_glob", "last_watch_check_at", "prompt", "enabled", "last_run_at", "next_run_at", "last_run_status", "last_error_message", "created_at" FROM `automation`;--> statement-breakpoint
DROP TABLE `automation`;--> statement-breakpoint
ALTER TABLE `__new_automation` RENAME TO `automation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;