ALTER TABLE `workspace` ADD COLUMN `icon` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD COLUMN `color` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD COLUMN `default_model_id` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD COLUMN `default_autonomy_level` text DEFAULT 'assisted' NOT NULL;
