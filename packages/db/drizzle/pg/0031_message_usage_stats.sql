ALTER TABLE "message" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "cost_micros" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "thinking_ms" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "line_count" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "code_line_count" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "code_block_count" integer;
