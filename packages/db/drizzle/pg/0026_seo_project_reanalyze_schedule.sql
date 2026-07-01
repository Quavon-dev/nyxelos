ALTER TABLE "seo_project" ADD COLUMN "reanalyze_cron_expression" text;--> statement-breakpoint
ALTER TABLE "seo_project" ADD COLUMN "next_reanalyze_at" timestamp;--> statement-breakpoint
ALTER TABLE "seo_project" ADD COLUMN "last_reanalyze_at" timestamp;
