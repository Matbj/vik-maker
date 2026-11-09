CREATE TYPE "public"."workout_group_kind" AS ENUM('level', 'team');--> statement-breakpoint
ALTER TABLE "workout_groups" ADD COLUMN "kind" "workout_group_kind" DEFAULT 'level' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_groups" ADD COLUMN "level_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_groups" ADD COLUMN "league" integer;