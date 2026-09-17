-- Adds cert_number. Column order changes, so the view is dropped and recreated.
DROP VIEW lot_valuations;
--> statement-breakpoint

CREATE VIEW lot_valuations AS
WITH priced AS (
  SELECT
    l.id AS lot_id,
    l.item_id,
    CASE
      WHEN l.grader IS NOT NULL THEN 'graded'
      WHEN i.kind = 'sealed' THEN 'sealed'
      ELSE 'single'
    END AS category,
    i.name,
    i.set_name,
    i.card_number,
    i.image_url,
    l.condition,
    l.grader,
    l.grade,
    l.cert_number,
    l.qty_remaining,
    l.unit_cost_cents,
    l.acquired_at,
    CASE
      WHEN l.grader IS NOT NULL OR i.kind = 'sealed' THEN lp.market_cents
      ELSE round(lp.market_cents * coalesce(cm.multiplier, 1))::integer
    END AS unit_market_cents,
    lp.as_of AS price_as_of
  FROM lots l
  JOIN items i ON i.id = l.item_id
  LEFT JOIN condition_multipliers cm ON cm.condition = coalesce(l.condition, 'NM')
  LEFT JOIN latest_prices lp
    ON lp.item_id = l.item_id
   AND lp.price_key = CASE
         WHEN l.grader IS NOT NULL THEN l.grader || trim_scale(l.grade)::text
         WHEN i.kind = 'sealed' THEN 'SEALED'
         ELSE 'NM'
       END
)
SELECT
  priced.*,
  unit_market_cents::bigint * qty_remaining AS market_value_cents,
  unit_cost_cents::bigint * qty_remaining AS cost_remaining_cents,
  (unit_market_cents::bigint - unit_cost_cents) * qty_remaining AS unrealized_cents
FROM priced;
