ALTER TABLE "membership" ADD COLUMN "pause_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "pause_until" date;