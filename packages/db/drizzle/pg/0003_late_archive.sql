CREATE TABLE "knowledge_base_config" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"vault_path" text DEFAULT 'knowledge-base' NOT NULL,
	"obsidian_rest_url" text,
	"obsidian_api_key" text,
	"docs_agent_enabled" boolean DEFAULT true NOT NULL,
	"last_docs_sync_at" timestamp,
	"last_docs_sync_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_base_config" ADD CONSTRAINT "knowledge_base_config_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
