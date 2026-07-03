CREATE TYPE "public"."lead_scout_draft_status" AS ENUM('draft', 'approved', 'rejected', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lead_scout_email_provider" AS ENUM('smtp', 'resend', 'mailgun', 'custom');--> statement-breakpoint
CREATE TYPE "public"."lead_scout_lead_status" AS ENUM('new', 'reviewed', 'prototype_requested', 'prototype_ready', 'email_drafted', 'approved_to_send', 'sending', 'sent', 'rejected', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."lead_scout_outreach_mode" AS ENUM('draft_only', 'review_and_send');--> statement-breakpoint
CREATE TYPE "public"."lead_scout_prototype_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lead_scout_provider" AS ENUM('manual_csv', 'google_places_api', 'osm_overpass', 'custom_api');--> statement-breakpoint
CREATE TYPE "public"."lead_scout_scan_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lead_scout_website_status" AS ENUM('unknown', 'has_website', 'missing_website', 'invalid_website');--> statement-breakpoint
CREATE TABLE "lead_scout_campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"extension_id" text NOT NULL,
	"name" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"radius_km" double precision DEFAULT 10 NOT NULL,
	"niches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_results_per_run" integer DEFAULT 25 NOT NULL,
	"provider" "lead_scout_provider" NOT NULL,
	"min_confidence" integer DEFAULT 50 NOT NULL,
	"outreach_mode" "lead_scout_outreach_mode" DEFAULT 'draft_only' NOT NULL,
	"schedule_enabled" boolean DEFAULT false NOT NULL,
	"schedule_cron_expression" text,
	"next_scan_at" timestamp,
	"last_scan_at" timestamp,
	"auto_generate_prototype" boolean DEFAULT false NOT NULL,
	"auto_draft_email" boolean DEFAULT false NOT NULL,
	"auto_send_after_approval" boolean DEFAULT false NOT NULL,
	"require_approval_before_prototype" boolean DEFAULT true NOT NULL,
	"require_approval_before_email_send" boolean DEFAULT true NOT NULL,
	"prototype_agent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_scout_email_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "lead_scout_email_provider" DEFAULT 'smtp' NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"credentials" text,
	"daily_send_limit" integer DEFAULT 20 NOT NULL,
	"per_campaign_send_limit" integer DEFAULT 10 NOT NULL,
	"dry_run_mode" boolean DEFAULT true NOT NULL,
	"legal_footer" text,
	"unsubscribe_text" text DEFAULT 'Reply STOP to opt out.' NOT NULL,
	"send_count_today" integer DEFAULT 0 NOT NULL,
	"send_count_date" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_scout_email_settings_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "lead_scout_lead" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"scan_run_id" text,
	"source_provider" "lead_scout_provider" NOT NULL,
	"source_id" text NOT NULL,
	"business_name" text NOT NULL,
	"category" text,
	"niche" text,
	"formatted_address" text,
	"postal_code" text,
	"city" text,
	"phone" text,
	"email" text,
	"website" text,
	"website_status" "lead_scout_website_status" DEFAULT 'unknown' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"evidence_summary" text,
	"missing_reason" text,
	"status" "lead_scout_lead_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_scout_outreach_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"prototype_id" text,
	"task_id" text,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"status" "lead_scout_draft_status" DEFAULT 'draft' NOT NULL,
	"error_message" text,
	"approved_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_scout_prototype" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"task_id" text,
	"status" "lead_scout_prototype_status" DEFAULT 'pending' NOT NULL,
	"concept" text,
	"hero_copy" text,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"call_to_action" text,
	"style_direction" text,
	"artifact_markdown" text,
	"approved" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_scout_scan_run" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "lead_scout_provider" NOT NULL,
	"status" "lead_scout_scan_run_status" DEFAULT 'running' NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"new_lead_count" integer DEFAULT 0 NOT NULL,
	"missing_website_count" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "lead_scout_source_config" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "lead_scout_provider" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"api_key" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_scout_suppression" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text,
	"domain" text,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_scout_campaign" ADD CONSTRAINT "lead_scout_campaign_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_campaign" ADD CONSTRAINT "lead_scout_campaign_extension_id_extension_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."extension"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_campaign" ADD CONSTRAINT "lead_scout_campaign_prototype_agent_id_agent_id_fk" FOREIGN KEY ("prototype_agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_email_settings" ADD CONSTRAINT "lead_scout_email_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_lead" ADD CONSTRAINT "lead_scout_lead_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_lead" ADD CONSTRAINT "lead_scout_lead_campaign_id_lead_scout_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."lead_scout_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_lead" ADD CONSTRAINT "lead_scout_lead_scan_run_id_lead_scout_scan_run_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."lead_scout_scan_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_outreach_draft" ADD CONSTRAINT "lead_scout_outreach_draft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_outreach_draft" ADD CONSTRAINT "lead_scout_outreach_draft_lead_id_lead_scout_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead_scout_lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_outreach_draft" ADD CONSTRAINT "lead_scout_outreach_draft_prototype_id_lead_scout_prototype_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "public"."lead_scout_prototype"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_outreach_draft" ADD CONSTRAINT "lead_scout_outreach_draft_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_prototype" ADD CONSTRAINT "lead_scout_prototype_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_prototype" ADD CONSTRAINT "lead_scout_prototype_lead_id_lead_scout_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead_scout_lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_prototype" ADD CONSTRAINT "lead_scout_prototype_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_scan_run" ADD CONSTRAINT "lead_scout_scan_run_campaign_id_lead_scout_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."lead_scout_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_scan_run" ADD CONSTRAINT "lead_scout_scan_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_source_config" ADD CONSTRAINT "lead_scout_source_config_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scout_suppression" ADD CONSTRAINT "lead_scout_suppression_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_scout_lead_campaign_source_idx" ON "lead_scout_lead" USING btree ("campaign_id","source_provider","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_scout_source_config_workspace_provider_idx" ON "lead_scout_source_config" USING btree ("workspace_id","provider");