ALTER TABLE "tool" ALTER COLUMN "kind" TYPE text USING "kind"::text;--> statement-breakpoint
DROP TYPE "public"."tool_kind";--> statement-breakpoint
ALTER TABLE "tool" ADD COLUMN "builtin" boolean DEFAULT false NOT NULL;
