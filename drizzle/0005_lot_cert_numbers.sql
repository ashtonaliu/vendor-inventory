ALTER TABLE "lots" ADD COLUMN "cert_number" text;--> statement-breakpoint
CREATE INDEX "lots_cert_idx" ON "lots" USING btree ("grader","cert_number");--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "cert_only_on_single_slab" CHECK ("lots"."cert_number" is null or ("lots"."grader" is not null and "lots"."qty_acquired" = 1));