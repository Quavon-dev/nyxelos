ALTER TYPE "public"."task_event_kind" ADD VALUE 'question';--> statement-breakpoint
ALTER TYPE "public"."task_event_kind" ADD VALUE 'question_answered';--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "model_id" text;
