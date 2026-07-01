CREATE TYPE "public"."model_provider_kind" AS ENUM('anthropic', 'openai', 'openai_compatible');--> statement-breakpoint
CREATE TABLE "model_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"label" text NOT NULL,
	"provider_kind" "model_provider_kind" NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text,
	"model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_installation" ADD CONSTRAINT "model_installation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
