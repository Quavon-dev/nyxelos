CREATE TYPE "public"."automation_trigger_type" AS ENUM('cron', 'file_watch');--> statement-breakpoint
CREATE TYPE "public"."skill_kind" AS ENUM('http_fetch', 'file_read', 'file_write', 'file_list', 'kb_search', 'custom_code');--> statement-breakpoint
CREATE TABLE "skill" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"kind" "skill_kind" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensitive" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "cron_expression" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "trigger_type" "automation_trigger_type" DEFAULT 'cron' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "watch_path" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "watch_glob" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "last_watch_check_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_base_config" ADD COLUMN "inject_into_prompts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;