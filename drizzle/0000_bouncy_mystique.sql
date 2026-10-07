CREATE TYPE "public"."booking_status" AS ENUM('booked', 'waitlisted', 'cancelled', 'attended', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."charge_kind" AS ENUM('membership', 'signup', 'dropin', 'other');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('open', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."check_in_method" AS ENUM('qr', 'manual');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'cash', 'bank', 'stripe', 'other');--> statement-breakpoint
CREATE TYPE "public"."plan_interval" AS ENUM('week', 'month', 'year');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"member_id" text NOT NULL,
	"status" "booking_status" DEFAULT 'booked' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"membership_id" text,
	"kind" charge_kind DEFAULT 'other' NOT NULL,
	"description" text,
	"period_start" date,
	"due_date" date NOT NULL,
	"amount" integer NOT NULL,
	"status" charge_status DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_in" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"location_id" text,
	"method" "check_in_method" DEFAULT 'manual' NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"class_type_id" text NOT NULL,
	"location_id" text,
	"instructor_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"capacity" integer DEFAULT 20 NOT NULL,
	"instructor_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text,
	"portal_user_id" text,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"joined_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"public_page" boolean DEFAULT true NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"next_charge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"recipient" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"charge_id" text,
	"amount" integer NOT NULL,
	"method" "payment_method" DEFAULT 'card' NOT NULL,
	"reference" text,
	"notes" text,
	"recorded_by" text,
	"external_id" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_provider" (
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"account_id" text,
	"account_ready" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_organization_id_provider_pk" PRIMARY KEY("organization_id","provider")
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" integer NOT NULL,
	"interval" "plan_interval" DEFAULT 'month' NOT NULL,
	"signup_fee" integer DEFAULT 0 NOT NULL,
	"class_credits" integer,
	"listed" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_delivery_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_membership_id_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."membership"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_class_type_id_class_type_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_instructor_id_member_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_type" ADD CONSTRAINT "class_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_type" ADD CONSTRAINT "class_type_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_type" ADD CONSTRAINT "class_type_instructor_id_member_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member" ADD CONSTRAINT "gym_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member" ADD CONSTRAINT "gym_member_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member" ADD CONSTRAINT "gym_member_portal_user_id_user_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD CONSTRAINT "gym_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider" ADD CONSTRAINT "payment_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_org_created_idx" ON "activity" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_entity_idx" ON "activity" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "booking_session_idx" ON "booking" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "booking_member_idx" ON "booking" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_open_idx" ON "booking" USING btree ("session_id","member_id") WHERE "booking"."status" != 'cancelled';--> statement-breakpoint
CREATE INDEX "charge_org_due_idx" ON "charge" USING btree ("organization_id","due_date");--> statement-breakpoint
CREATE INDEX "charge_member_idx" ON "charge" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charge_membership_period_idx" ON "charge" USING btree ("membership_id","period_start") WHERE "charge"."kind" = 'membership';--> statement-breakpoint
CREATE INDEX "check_in_org_time_idx" ON "check_in" USING btree ("organization_id","checked_at");--> statement-breakpoint
CREATE INDEX "check_in_member_idx" ON "check_in" USING btree ("member_id","checked_at");--> statement-breakpoint
CREATE INDEX "class_session_org_starts_idx" ON "class_session" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "class_session_type_idx" ON "class_session" USING btree ("class_type_id");--> statement-breakpoint
CREATE INDEX "class_type_org_idx" ON "class_type" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "gym_member_org_idx" ON "gym_member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "gym_member_email_idx" ON "gym_member" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "gym_member_portal_idx" ON "gym_member" USING btree ("portal_user_id");--> statement-breakpoint
CREATE INDEX "location_org_idx" ON "location" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "membership_member_idx" ON "membership" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "membership_org_charge_idx" ON "membership" USING btree ("organization_id","next_charge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_once_idx" ON "notification_log" USING btree ("kind","entity_id","recipient");--> statement-breakpoint
CREATE INDEX "payment_org_paid_idx" ON "payment" USING btree ("organization_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_external_idx" ON "payment" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "payment_member_idx" ON "payment" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "payment_provider_account_idx" ON "payment_provider" USING btree ("provider","account_id");--> statement-breakpoint
CREATE INDEX "plan_org_idx" ON "plan" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_org_idx" ON "webhook" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");