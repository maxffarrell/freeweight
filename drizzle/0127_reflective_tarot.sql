ALTER TABLE "gym_member" ADD COLUMN "parq_answers" jsonb;--> statement-breakpoint
ALTER TABLE "gym_member" ADD COLUMN "parq_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "kiosk_pin" text DEFAULT '' NOT NULL;