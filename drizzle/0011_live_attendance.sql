ALTER TABLE "workouts" ADD COLUMN "live_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "live_started_by" uuid;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "presence_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "presence_pushed_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "presence_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "presence_pushed_ids" jsonb;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "presence_push_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "presence_push_error" text;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "presence_overwrote_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_live_started_by_coaches_id_fk" FOREIGN KEY ("live_started_by") REFERENCES "public"."coaches"("id") ON DELETE set null ON UPDATE no action;