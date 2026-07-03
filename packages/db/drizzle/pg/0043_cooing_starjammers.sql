ALTER TABLE "agent_run" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "heartbeat_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "cancel_requested_at" timestamp;