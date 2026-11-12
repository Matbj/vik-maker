CREATE TABLE "lottery_players" (
	"lottery_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"included" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lottery_players_lottery_id_player_id_pk" PRIMARY KEY("lottery_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "lottery_players" ADD CONSTRAINT "lottery_players_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lottery_players" ADD CONSTRAINT "lottery_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;