ALTER TYPE "public"."library_item_kind" ADD VALUE 'video';--> statement-breakpoint
CREATE TYPE "public"."video_generation_job_status" AS ENUM('queued', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "video_generation_job" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"chat_id" text,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"status" "video_generation_job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"size" text NOT NULL,
	"seconds" integer NOT NULL,
	"auto" boolean DEFAULT true NOT NULL,
	"external_job_id" text,
	"library_file_id" text,
	"poster_library_file_id" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "video_generation_job" ADD CONSTRAINT "video_generation_job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generation_job" ADD CONSTRAINT "video_generation_job_library_file_id_library_file_id_fk" FOREIGN KEY ("library_file_id") REFERENCES "public"."library_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generation_job" ADD CONSTRAINT "video_generation_job_poster_library_file_id_library_file_id_fk" FOREIGN KEY ("poster_library_file_id") REFERENCES "public"."library_file"("id") ON DELETE set null ON UPDATE no action;
