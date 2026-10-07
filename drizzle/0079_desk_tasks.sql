CREATE TABLE "desk_task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desk_task_done" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"task_id" text NOT NULL,
	"member_id" text NOT NULL,
	"done_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desk_task" ADD CONSTRAINT "desk_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_task_done" ADD CONSTRAINT "desk_task_done_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_task_done" ADD CONSTRAINT "desk_task_done_task_id_desk_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."desk_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_task_done" ADD CONSTRAINT "desk_task_done_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desk_task_org_idx" ON "desk_task" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "desk_task_done_org_idx" ON "desk_task_done" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "desk_task_done_task_date_idx" ON "desk_task_done" USING btree ("task_id","done_on");