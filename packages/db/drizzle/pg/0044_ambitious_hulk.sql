ALTER TYPE "public"."agent_run_status" ADD VALUE 'dead_letter';--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "max_retries" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "next_retry_at" timestamp;