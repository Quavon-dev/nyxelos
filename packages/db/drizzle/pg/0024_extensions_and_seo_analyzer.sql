ALTER TYPE "public"."agent_run_trigger" ADD VALUE 'extension';--> statement-breakpoint
CREATE TYPE "public"."seo_analysis_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."seo_finding_category" AS ENUM('seo', 'geo', 'aeo');--> statement-breakpoint
CREATE TYPE "public"."seo_finding_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."seo_blog_post_status" AS ENUM('suggested', 'generating', 'written', 'failed');--> statement-breakpoint
CREATE TABLE "extension" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "extension" ADD CONSTRAINT "extension_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "seo_project" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"extension_id" text NOT NULL,
	"domain" text NOT NULL,
	"repo_path" text NOT NULL,
	"blog_config" jsonb,
	"fixer_agent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "seo_project" ADD CONSTRAINT "seo_project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_project" ADD CONSTRAINT "seo_project_extension_id_extension_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."extension"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_project" ADD CONSTRAINT "seo_project_fixer_agent_id_agent_id_fk" FOREIGN KEY ("fixer_agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "seo_analysis_run" (
	"id" text PRIMARY KEY NOT NULL,
	"seo_project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"status" "seo_analysis_run_status" DEFAULT 'running' NOT NULL,
	"score" integer,
	"pages_scanned" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);--> statement-breakpoint
ALTER TABLE "seo_analysis_run" ADD CONSTRAINT "seo_analysis_run_seo_project_id_seo_project_id_fk" FOREIGN KEY ("seo_project_id") REFERENCES "public"."seo_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_analysis_run" ADD CONSTRAINT "seo_analysis_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "seo_finding" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seo_project_id" text NOT NULL,
	"category" "seo_finding_category" NOT NULL,
	"severity" "seo_finding_severity" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"recommendation" text NOT NULL,
	"location" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "seo_finding" ADD CONSTRAINT "seo_finding_run_id_seo_analysis_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."seo_analysis_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_finding" ADD CONSTRAINT "seo_finding_seo_project_id_seo_project_id_fk" FOREIGN KEY ("seo_project_id") REFERENCES "public"."seo_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "seo_blog_post" (
	"id" text PRIMARY KEY NOT NULL,
	"seo_project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"keyword" text NOT NULL,
	"title" text,
	"file_path" text,
	"status" "seo_blog_post_status" DEFAULT 'suggested' NOT NULL,
	"task_id" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "seo_blog_post" ADD CONSTRAINT "seo_blog_post_seo_project_id_seo_project_id_fk" FOREIGN KEY ("seo_project_id") REFERENCES "public"."seo_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_blog_post" ADD CONSTRAINT "seo_blog_post_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_blog_post" ADD CONSTRAINT "seo_blog_post_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;
