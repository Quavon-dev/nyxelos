ALTER TABLE `message` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `message` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `cache_read_tokens` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `total_tokens` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `cost_micros` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `thinking_ms` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `line_count` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `code_line_count` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `code_block_count` integer;
