CREATE TABLE "plugin" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" text,
	"author" text,
	"homepage" text,
	"repo_url" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skill_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_defs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"install_dir" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "plugin" ADD CONSTRAINT "plugin_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
