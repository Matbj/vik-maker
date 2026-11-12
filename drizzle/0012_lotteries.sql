CREATE TABLE "lotteries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"due_on" date,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lottery_kinds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lottery_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ticket_price" integer NOT NULL,
	"tickets_per_player" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lottery_kinds_ticket_price_check" CHECK ("lottery_kinds"."ticket_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lottery_tickets" (
	"kind_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"handed_out" integer DEFAULT 0 NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"returned" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lottery_tickets_kind_id_player_id_pk" PRIMARY KEY("kind_id","player_id"),
	CONSTRAINT "lottery_tickets_counts_check" CHECK ("lottery_tickets"."paid" >= 0 and "lottery_tickets"."returned" >= 0 and "lottery_tickets"."paid" + "lottery_tickets"."returned" <= "lottery_tickets"."handed_out")
);
--> statement-breakpoint
ALTER TABLE "lottery_kinds" ADD CONSTRAINT "lottery_kinds_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lottery_tickets" ADD CONSTRAINT "lottery_tickets_kind_id_lottery_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."lottery_kinds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lottery_tickets" ADD CONSTRAINT "lottery_tickets_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lottery_kinds_lottery_id_idx" ON "lottery_kinds" USING btree ("lottery_id");