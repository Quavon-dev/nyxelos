CREATE TABLE `knowledge_base_config` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`vault_path` text DEFAULT 'knowledge-base' NOT NULL,
	`obsidian_rest_url` text,
	`obsidian_api_key` text,
	`docs_agent_enabled` integer DEFAULT true NOT NULL,
	`last_docs_sync_at` integer,
	`last_docs_sync_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
