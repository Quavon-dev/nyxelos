CREATE TABLE `workflow` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_run` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_run_node` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`node_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`library_file_id` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_file_id`) REFERENCES `library_file`(`id`) ON UPDATE no action ON DELETE set null
);
