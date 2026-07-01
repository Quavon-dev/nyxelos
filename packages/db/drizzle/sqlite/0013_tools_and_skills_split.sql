ALTER TABLE `skill` RENAME TO `tool`;--> statement-breakpoint
ALTER TABLE `agent` RENAME COLUMN `skill_ids` TO `tool_ids`;--> statement-breakpoint
ALTER TABLE `agent` ADD COLUMN `skill_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `approval_request` RENAME COLUMN `skill_id` TO `tool_id`;--> statement-breakpoint
ALTER TABLE `approval_request` ADD COLUMN `skill_id` text;--> statement-breakpoint
UPDATE `approval_request` SET `kind` = 'tool' WHERE `kind` = 'skill';
