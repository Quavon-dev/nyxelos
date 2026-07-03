ALTER TABLE `agent_run` ADD `worker_id` text;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `heartbeat_at` integer;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `lease_until` integer;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `cancel_requested_at` integer;