CREATE TABLE `extension` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`installed_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seo_project` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`extension_id` text NOT NULL,
	`domain` text NOT NULL,
	`repo_path` text NOT NULL,
	`blog_config` text,
	`fixer_agent_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extension_id`) REFERENCES `extension`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fixer_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `seo_analysis_run` (
	`id` text PRIMARY KEY NOT NULL,
	`seo_project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`score` integer,
	`pages_scanned` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`error_message` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`seo_project_id`) REFERENCES `seo_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seo_finding` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seo_project_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`recommendation` text NOT NULL,
	`location` text,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `seo_analysis_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seo_project_id`) REFERENCES `seo_project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seo_blog_post` (
	`id` text PRIMARY KEY NOT NULL,
	`seo_project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`keyword` text NOT NULL,
	`title` text,
	`file_path` text,
	`status` text DEFAULT 'suggested' NOT NULL,
	`task_id` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`seo_project_id`) REFERENCES `seo_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null
);
