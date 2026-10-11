ALTER TABLE "gym_member" ADD COLUMN "parq_history" jsonb;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "door_webhook_url" text DEFAULT '' NOT NULL;