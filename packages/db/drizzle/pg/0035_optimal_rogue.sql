CREATE TYPE "public"."automation_target_kind" AS ENUM('agent', 'workflow');--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "prompt" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "workflow_id" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "target_kind" "automation_target_kind" DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;