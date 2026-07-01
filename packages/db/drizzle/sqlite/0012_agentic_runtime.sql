ALTER TABLE `agent` ADD COLUMN `role` text;--> statement-breakpoint
ALTER TABLE `agent` ADD COLUMN `goal_template` text;--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspace`(`id`) ON DELETE cascade,
	`parent_task_id` text,
	`source_chat_id` text REFERENCES `chat`(`id`) ON DELETE set null,
	`created_by_agent_id` text REFERENCES `agent`(`id`) ON DELETE set null,
	`assigned_agent_id` text REFERENCES `agent`(`id`) ON DELETE set null,
	`title` text NOT NULL,
	`instruction` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`plan` text,
	`handoff` text,
	`result_summary` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspace`(`id`) ON DELETE cascade,
	`task_id` text REFERENCES `task`(`id`) ON DELETE set null,
	`agent_id` text NOT NULL REFERENCES `agent`(`id`) ON DELETE cascade,
	`chat_id` text REFERENCES `chat`(`id`) ON DELETE set null,
	`automation_id` text REFERENCES `automation`(`id`) ON DELETE set null,
	`trigger` text NOT NULL,
	`step_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`final_output` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE `task_event` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL REFERENCES `task`(`id`) ON DELETE cascade,
	`workspace_id` text NOT NULL REFERENCES `workspace`(`id`) ON DELETE cascade,
	`agent_run_id` text REFERENCES `agent_run`(`id`) ON DELETE set null,
	`agent_id` text REFERENCES `agent`(`id`) ON DELETE set null,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL
);--> statement-breakpoint
ALTER TABLE `approval_request` ADD COLUMN `task_id` text REFERENCES `task`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `approval_request` ADD COLUMN `agent_run_id` text REFERENCES `agent_run`(`id`) ON DELETE set null;
