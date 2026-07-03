ALTER TABLE `agent_run` ADD `retry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `max_retries` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `next_retry_at` integer;