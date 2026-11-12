CREATE TABLE "lottery_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lottery_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"coach_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lottery_payments_amount_check" CHECK ("lottery_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "lottery_payments" ADD CONSTRAINT "lottery_payments_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lottery_payments" ADD CONSTRAINT "lottery_payments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lottery_payments" ADD CONSTRAINT "lottery_payments_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lottery_payments_lottery_id_idx" ON "lottery_payments" USING btree ("lottery_id");--> statement-breakpoint
INSERT INTO "lottery_payments" ("lottery_id", "player_id", "amount", "created_at")
SELECT k."lottery_id", t."player_id", sum(t."paid" * k."ticket_price"), max(t."updated_at")
FROM "lottery_tickets" t
JOIN "lottery_kinds" k ON k."id" = t."kind_id"
WHERE t."paid" > 0
GROUP BY k."lottery_id", t."player_id"
HAVING sum(t."paid" * k."ticket_price") > 0;--> statement-breakpoint
UPDATE "lottery_tickets" SET "paid" = 0 WHERE "paid" > 0;
