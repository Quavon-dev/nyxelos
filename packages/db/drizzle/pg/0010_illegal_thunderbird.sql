CREATE TYPE "public"."chat_tool_mode" AS ENUM('default', 'automatic', 'auto');--> statement-breakpoint
ALTER TYPE "public"."skill_kind" ADD VALUE 'file_delete' BEFORE 'kb_search';--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "tool_mode" "chat_tool_mode" DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "tool_policy" jsonb DEFAULT '{"mode":"default","approveFileWrites":true,"approveFileDeletes":true,"approveCustomCode":true,"approveMcpTools":true}'::jsonb NOT NULL;