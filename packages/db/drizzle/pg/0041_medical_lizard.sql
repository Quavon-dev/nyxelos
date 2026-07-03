ALTER TYPE "public"."audit_actor" ADD VALUE 'goal_orchestrator';--> statement-breakpoint
ALTER TYPE "public"."goal_event_kind" ADD VALUE 'plan_created';--> statement-breakpoint
ALTER TYPE "public"."goal_event_kind" ADD VALUE 'task_created';--> statement-breakpoint
ALTER TYPE "public"."goal_event_kind" ADD VALUE 'task_status_changed';--> statement-breakpoint
ALTER TYPE "public"."goal_event_kind" ADD VALUE 'review';--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "default_agent_id" text;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "success_criteria" jsonb;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "orchestration_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "next_review_at" timestamp;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "last_reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "plan_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "goal_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "goal_milestone_id" text;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_default_agent_id_agent_id_fk" FOREIGN KEY ("default_agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_goal_milestone_id_goal_milestone_id_fk" FOREIGN KEY ("goal_milestone_id") REFERENCES "public"."goal_milestone"("id") ON DELETE set null ON UPDATE no action;