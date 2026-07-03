CREATE TYPE "public"."nyxel_event_type" AS ENUM('agent.run.started', 'agent.run.completed', 'agent.run.failed', 'approval.created', 'approval.resolved', 'workflow.completed', 'task.failed', 'library.file.created', 'automation.triggered');--> statement-breakpoint
CREATE TABLE "nyxel_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "nyxel_event_type" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nyxel_event" ADD CONSTRAINT "nyxel_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;