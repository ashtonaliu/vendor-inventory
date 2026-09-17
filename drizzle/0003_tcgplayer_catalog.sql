ALTER TABLE "items" ADD COLUMN "tcgplayer_product_id" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "market_cents" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "market_as_of" date;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tcgplayer_product_id_unique" UNIQUE("tcgplayer_product_id");