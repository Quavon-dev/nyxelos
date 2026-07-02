CREATE TABLE `model_parameter` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`model_id` text NOT NULL,
	`custom_name` text,
	`custom_instructions` text,
	`max_output_tokens` integer,
	`temperature` real,
	`top_p` real,
	`frequency_penalty` real,
	`presence_penalty` real,
	`stop_sequences` text DEFAULT '[]' NOT NULL,
	`reasoning_effort` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_parameter_workspace_model_idx` ON `model_parameter` (`workspace_id`,`model_id`);
