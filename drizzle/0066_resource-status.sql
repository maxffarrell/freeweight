ALTER TABLE "facility_resource" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_resource" ADD COLUMN "status_note" text DEFAULT '' NOT NULL;