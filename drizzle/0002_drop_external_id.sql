CREATE TABLE "sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"data_as_of" date,
	"groups_total" integer DEFAULT 0 NOT NULL,
	"groups_failed" integer DEFAULT 0 NOT NULL,
	"products_seen" integer DEFAULT 0 NOT NULL,
	"items_linked" integer DEFAULT 0 NOT NULL,
	"snapshots_written" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_external_id_unique";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "external_id";