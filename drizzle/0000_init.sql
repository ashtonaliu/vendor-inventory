CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."card_condition" AS ENUM('NM', 'LP', 'MP', 'HP', 'DMG');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('single', 'sealed');--> statement-breakpoint
CREATE TYPE "public"."line_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('show', 'ebay', 'tcgplayer', 'local', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('buy', 'sell', 'trade');--> statement-breakpoint
CREATE TABLE "condition_multipliers" (
	"condition" "card_condition" PRIMARY KEY NOT NULL,
	"multiplier" numeric(4, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"starts_on" date NOT NULL,
	"table_fee_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" "item_kind" NOT NULL,
	"name" text NOT NULL,
	"set_name" text NOT NULL,
	"card_number" text,
	"variant" text,
	"rarity" text,
	"external_id" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" bigint NOT NULL,
	"condition" "card_condition",
	"grader" text,
	"grade" numeric(3, 1),
	"qty_acquired" integer NOT NULL,
	"qty_remaining" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"notes" text,
	CONSTRAINT "qty_remaining_in_range" CHECK ("lots"."qty_remaining" between 0 and "lots"."qty_acquired"),
	CONSTRAINT "grader_and_grade_together" CHECK (("lots"."grader" is null) = ("lots"."grade" is null))
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"item_id" bigint NOT NULL,
	"price_key" text NOT NULL,
	"as_of" date NOT NULL,
	"market_cents" integer NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "price_snapshots_item_id_price_key_as_of_pk" PRIMARY KEY("item_id","price_key","as_of"),
	CONSTRAINT "market_cents_nonnegative" CHECK ("price_snapshots"."market_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" bigint NOT NULL,
	"lot_id" bigint NOT NULL,
	"direction" "line_direction" NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"unit_market_cents" integer NOT NULL,
	CONSTRAINT "qty_positive" CHECK ("transaction_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" "transaction_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_id" bigint,
	"channel" "sales_channel" NOT NULL,
	"cash_in_cents" integer DEFAULT 0 NOT NULL,
	"cash_out_cents" integer DEFAULT 0 NOT NULL,
	"fees_cents" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_search_trgm_idx" ON "items" USING gin (("name" || ' ' || "set_name" || ' ' || coalesce("card_number", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "lots_item_idx" ON "lots" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "transaction_lines_transaction_idx" ON "transaction_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_lines_lot_idx" ON "transaction_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "transactions_occurred_at_idx" ON "transactions" USING btree ("occurred_at");