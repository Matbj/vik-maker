CREATE TABLE "coaches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"svenskalag_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_coach_attendance" (
	"workout_id" uuid NOT NULL,
	"coach_id" uuid NOT NULL,
	"response" "player_response" DEFAULT 'unanswered' NOT NULL,
	"coach_check" "coach_check",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_coach_attendance_workout_id_coach_id_pk" PRIMARY KEY("workout_id","coach_id")
);
--> statement-breakpoint
ALTER TABLE "workout_coach_attendance" ADD CONSTRAINT "workout_coach_attendance_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_coach_attendance" ADD CONSTRAINT "workout_coach_attendance_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coaches_svenskalag_id_idx" ON "coaches" USING btree ("svenskalag_id");