ALTER TABLE "model_installation" ADD COLUMN "disabled_model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
