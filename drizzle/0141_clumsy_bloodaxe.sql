ALTER TABLE "gym_settings" ADD COLUMN "door_last_event" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "door_last_status" integer;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "door_last_at" timestamp with time zone;