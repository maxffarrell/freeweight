ALTER TABLE "gym_settings" ADD COLUMN "anonymize_months" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "export_webhook_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "brand_color" text DEFAULT '' NOT NULL;