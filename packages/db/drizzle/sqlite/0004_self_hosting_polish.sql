CREATE TABLE `installation` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`primary_workspace_id` text NOT NULL,
	`app_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`primary_workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
