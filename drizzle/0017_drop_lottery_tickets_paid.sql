ALTER TABLE "lottery_tickets" DROP CONSTRAINT "lottery_tickets_counts_check";--> statement-breakpoint
ALTER TABLE "lottery_tickets" DROP COLUMN "paid";--> statement-breakpoint
ALTER TABLE "lottery_tickets" ADD CONSTRAINT "lottery_tickets_counts_check" CHECK ("lottery_tickets"."returned" >= 0 and "lottery_tickets"."returned" <= "lottery_tickets"."handed_out");