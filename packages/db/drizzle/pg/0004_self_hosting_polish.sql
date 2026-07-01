CREATE TYPE "public"."installation_mode" AS ENUM('pc', 'server');--> statement-breakpoint
CREATE TABLE "installation" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" "installation_mode" NOT NULL,
	"owner_user_id" text NOT NULL,
	"primary_workspace_id" text NOT NULL,
	"app_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "installation" ADD CONSTRAINT "installation_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation" ADD CONSTRAINT "installation_primary_workspace_id_workspace_id_fk" FOREIGN KEY ("primary_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
