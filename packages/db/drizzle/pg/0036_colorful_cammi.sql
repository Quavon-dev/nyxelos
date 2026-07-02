CREATE TYPE "public"."artifact_type" AS ENUM('text', 'markdown', 'code_patch', 'diff', 'file', 'report', 'json', 'image_reference', 'task_result', 'command_output');--> statement-breakpoint
CREATE TYPE "public"."memory_source" AS ENUM('user', 'agent', 'automation', 'system');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('user_preference', 'workspace_fact', 'project_decision', 'agent_observation', 'task_summary', 'file_summary', 'repo_summary', 'long_term_note');--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "artifact_type" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"task_id" text,
	"agent_run_id" text,
	"agent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "memory_type" NOT NULL,
	"content" text NOT NULL,
	"source" "memory_source" NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"created_by_agent_id" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "affected_resources" jsonb;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "diff_preview" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "permission_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entry" ADD CONSTRAINT "memory_entry_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entry" ADD CONSTRAINT "memory_entry_created_by_agent_id_agent_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;