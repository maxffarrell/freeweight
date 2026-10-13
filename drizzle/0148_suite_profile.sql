CREATE TABLE "profile_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"hub_url" text NOT NULL,
	"access_token" text NOT NULL,
	"scopes" text[] NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gym_member" ADD COLUMN "profile_sync" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_link" ADD CONSTRAINT "profile_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;