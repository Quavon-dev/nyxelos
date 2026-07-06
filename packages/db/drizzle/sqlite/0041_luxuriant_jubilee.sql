CREATE TABLE `lead_scout_campaign` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`extension_id` text NOT NULL,
	`name` text NOT NULL,
	`postal_code` text NOT NULL,
	`country` text DEFAULT 'US' NOT NULL,
	`radius_km` real DEFAULT 10 NOT NULL,
	`niches` text DEFAULT '[]' NOT NULL,
	`max_results_per_run` integer DEFAULT 25 NOT NULL,
	`provider` text NOT NULL,
	`min_confidence` integer DEFAULT 50 NOT NULL,
	`outreach_mode` text DEFAULT 'draft_only' NOT NULL,
	`schedule_enabled` integer DEFAULT false NOT NULL,
	`schedule_cron_expression` text,
	`next_scan_at` integer,
	`last_scan_at` integer,
	`auto_generate_prototype` integer DEFAULT false NOT NULL,
	`auto_draft_email` integer DEFAULT false NOT NULL,
	`auto_send_after_approval` integer DEFAULT false NOT NULL,
	`require_approval_before_prototype` integer DEFAULT true NOT NULL,
	`require_approval_before_email_send` integer DEFAULT true NOT NULL,
	`prototype_agent_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extension_id`) REFERENCES `extension`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prototype_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `lead_scout_email_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text DEFAULT 'smtp' NOT NULL,
	`from_name` text NOT NULL,
	`from_email` text NOT NULL,
	`reply_to` text,
	`credentials` text,
	`daily_send_limit` integer DEFAULT 20 NOT NULL,
	`per_campaign_send_limit` integer DEFAULT 10 NOT NULL,
	`dry_run_mode` integer DEFAULT true NOT NULL,
	`legal_footer` text,
	`unsubscribe_text` text DEFAULT 'Reply STOP to opt out.' NOT NULL,
	`send_count_today` integer DEFAULT 0 NOT NULL,
	`send_count_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_scout_email_settings_workspace_id_unique` ON `lead_scout_email_settings` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `lead_scout_lead` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`scan_run_id` text,
	`source_provider` text NOT NULL,
	`source_id` text NOT NULL,
	`business_name` text NOT NULL,
	`category` text,
	`niche` text,
	`formatted_address` text,
	`postal_code` text,
	`city` text,
	`phone` text,
	`email` text,
	`website` text,
	`website_status` text DEFAULT 'unknown' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`evidence_summary` text,
	`missing_reason` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `lead_scout_campaign`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `lead_scout_scan_run`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_scout_lead_campaign_source_idx` ON `lead_scout_lead` (`campaign_id`,`source_provider`,`source_id`);--> statement-breakpoint
CREATE TABLE `lead_scout_outreach_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`prototype_id` text,
	`task_id` text,
	`subject` text,
	`body_text` text,
	`body_html` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`error_message` text,
	`approved_at` integer,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `lead_scout_lead`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prototype_id`) REFERENCES `lead_scout_prototype`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `lead_scout_prototype` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`task_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`concept` text,
	`hero_copy` text,
	`sections` text DEFAULT '[]' NOT NULL,
	`call_to_action` text,
	`style_direction` text,
	`artifact_markdown` text,
	`approved` integer DEFAULT false NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `lead_scout_lead`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `lead_scout_scan_run` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`new_lead_count` integer DEFAULT 0 NOT NULL,
	`missing_website_count` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`error_message` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `lead_scout_campaign`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lead_scout_source_config` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`api_key` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_scout_source_config_workspace_provider_idx` ON `lead_scout_source_config` (`workspace_id`,`provider`);--> statement-breakpoint
CREATE TABLE `lead_scout_suppression` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text,
	`domain` text,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
