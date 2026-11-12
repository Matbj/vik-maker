ALTER TABLE "lottery_tickets" ADD COLUMN "handed_out_at" timestamp with time zone;--> statement-breakpoint
UPDATE "lottery_tickets" SET "handed_out_at" = "created_at" WHERE "handed_out" > 0;