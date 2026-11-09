ALTER TYPE "public"."attendance_status" RENAME TO "player_response";--> statement-breakpoint
ALTER TABLE "workout_attendance" RENAME COLUMN "status" TO "player_response";--> statement-breakpoint
CREATE TYPE "public"."coach_check" AS ENUM('present', 'absent');--> statement-breakpoint
ALTER TABLE "workout_attendance" ADD COLUMN "coach_check" "coach_check";
