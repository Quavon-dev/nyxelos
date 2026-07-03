ALTER TABLE `goal` ADD `default_agent_id` text REFERENCES agent(id);--> statement-breakpoint
ALTER TABLE `goal` ADD `success_criteria` text;--> statement-breakpoint
ALTER TABLE `goal` ADD `orchestration_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `goal` ADD `next_review_at` integer;--> statement-breakpoint
ALTER TABLE `goal` ADD `last_reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `goal` ADD `blocked_reason` text;--> statement-breakpoint
ALTER TABLE `goal` ADD `plan_generated_at` integer;--> statement-breakpoint
ALTER TABLE `task` ADD `goal_id` text REFERENCES goal(id);--> statement-breakpoint
ALTER TABLE `task` ADD `goal_milestone_id` text REFERENCES goal_milestone(id);