ALTER TABLE "check_in" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "class_session" ADD COLUMN "checkin_code" text;--> statement-breakpoint
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "class_session" SET "checkin_code" = upper(substring(md5(random()::text || id) from 1 for 5)) WHERE "checkin_code" IS NULL AND "cancelled_at" IS NULL;
