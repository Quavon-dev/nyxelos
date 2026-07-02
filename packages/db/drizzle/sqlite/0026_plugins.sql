CREATE TABLE `plugin` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`version` text,
	`author` text,
	`homepage` text,
	`repo_url` text NOT NULL,
	`manifest` text DEFAULT '{}' NOT NULL,
	`skill_slugs` text DEFAULT '[]' NOT NULL,
	`agent_defs` text DEFAULT '[]' NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`install_dir` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
