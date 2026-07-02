CREATE TYPE "public"."model_reasoning_effort" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "model_parameter" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"model_id" text NOT NULL,
	"custom_name" text,
	"custom_instructions" text,
	"max_output_tokens" integer,
	"temperature" double precision,
	"top_p" double precision,
	"frequency_penalty" double precision,
	"presence_penalty" double precision,
	"stop_sequences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasoning_effort" "model_reasoning_effort",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "model_parameter" ADD CONSTRAINT "model_parameter_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_parameter_workspace_model_idx" ON "model_parameter" USING btree ("workspace_id","model_id");
