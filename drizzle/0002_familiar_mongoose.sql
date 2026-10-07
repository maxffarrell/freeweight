ALTER TABLE "membership" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "is_pack" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "pack_days" integer;