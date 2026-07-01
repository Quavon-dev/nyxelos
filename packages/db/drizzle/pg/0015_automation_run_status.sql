CREATE TYPE "public"."automation_run_status" AS ENUM('success', 'error', 'pending_approval');--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "last_run_status" "automation_run_status";--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "last_error_message" text;
