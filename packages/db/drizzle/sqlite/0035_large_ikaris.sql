ALTER TABLE `plugin` ADD `ref` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugin` ADD `resolved_sha` text;--> statement-breakpoint
ALTER TABLE `plugin` ADD `ref_pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plugin` ADD `risk_findings` text DEFAULT '[]' NOT NULL;