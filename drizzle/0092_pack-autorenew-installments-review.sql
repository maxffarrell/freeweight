ALTER TABLE "course" ADD COLUMN "installments" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "review_url" text;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "review_after_visits" integer;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "auto_renew" boolean DEFAULT false NOT NULL;