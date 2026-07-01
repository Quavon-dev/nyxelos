ALTER TYPE "public"."skill_kind" RENAME TO "tool_kind";--> statement-breakpoint
ALTER TABLE "skill" RENAME TO "tool";--> statement-breakpoint
ALTER TABLE "agent" RENAME COLUMN "skill_ids" TO "tool_ids";--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TYPE "public"."approval_kind" ADD VALUE 'tool';--> statement-breakpoint
ALTER TABLE "approval_request" RENAME COLUMN "skill_id" TO "tool_id";--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "skill_id" text;--> statement-breakpoint
UPDATE "approval_request" SET "kind" = 'tool' WHERE "kind" = 'skill';
