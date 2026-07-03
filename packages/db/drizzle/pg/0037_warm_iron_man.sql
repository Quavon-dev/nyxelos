ALTER TABLE "plugin" ADD COLUMN "ref" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin" ADD COLUMN "resolved_sha" text;--> statement-breakpoint
ALTER TABLE "plugin" ADD COLUMN "ref_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin" ADD COLUMN "risk_findings" jsonb DEFAULT '[]'::jsonb NOT NULL;