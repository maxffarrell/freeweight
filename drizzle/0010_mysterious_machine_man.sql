ALTER TYPE "public"."membership_status" ADD VALUE 'suspended' BEFORE 'cancelled';--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "suspend_after_days" integer;