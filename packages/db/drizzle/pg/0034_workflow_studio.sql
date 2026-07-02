CREATE TYPE "public"."workflow_run_node_status" AS ENUM('queued', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"status" "workflow_run_status" DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run_node" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"status" "workflow_run_node_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"library_file_id" text,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_node" ADD CONSTRAINT "workflow_run_node_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_node" ADD CONSTRAINT "workflow_run_node_library_file_id_library_file_id_fk" FOREIGN KEY ("library_file_id") REFERENCES "public"."library_file"("id") ON DELETE set null ON UPDATE no action;
