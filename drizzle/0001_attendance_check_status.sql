CREATE TYPE "public"."attendance_check_status" AS ENUM('present', 'absent');--> statement-breakpoint
ALTER TABLE "workout_attendance" ADD COLUMN "check_status" "attendance_check_status";