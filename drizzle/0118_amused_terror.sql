ALTER TABLE "challenge" ADD COLUMN "team_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenge_entry" ADD COLUMN "team" text;