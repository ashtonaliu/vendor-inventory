CREATE VIEW latest_prices AS
SELECT DISTINCT ON (item_id, price_key)
  item_id, price_key, as_of, market_cents
FROM price_snapshots
ORDER BY item_id, price_key, as_of DESC;
--> statement-breakpoint

-- One row per lot, valued at today's market. Raw singles use the NM price
-- scaled by the condition multiplier; graded lots use their own grade's price.
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
--> statement-breakpoint

-- One row per outgoing line (sale or trade-away). Transaction fees are split
-- across that transaction's outgoing lines in proportion to their revenue.
CREATE VIEW realized_sales AS
WITH out_lines AS (
  SELECT
    tl.id,
    tl.transaction_id,
    tl.lot_id,
    tl.qty,
    tl.unit_price_cents,
    tl.unit_market_cents,
    t.type,
    t.occurred_at,
    t.event_id,
    t.channel,
    t.fees_cents,
    tl.unit_price_cents::bigint * tl.qty AS revenue_cents,
    sum(tl.unit_price_cents::bigint * tl.qty) OVER (PARTITION BY tl.transaction_id) AS txn_revenue_cents,
    count(*) OVER (PARTITION BY tl.transaction_id) AS txn_line_count
  FROM transaction_lines tl
  JOIN transactions t ON t.id = tl.transaction_id
  WHERE tl.direction = 'out'
)
SELECT
  o.id AS line_id,
  o.transaction_id,
  o.type,
  o.occurred_at,
  o.event_id,
  o.channel,
  o.lot_id,
  l.item_id,
  CASE
    WHEN l.grader IS NOT NULL THEN 'graded'
    WHEN i.kind = 'sealed' THEN 'sealed'
    ELSE 'single'
  END AS category,
  i.name,
  o.qty,
  o.unit_price_cents,
  o.unit_market_cents,
  l.unit_cost_cents,
  o.revenue_cents,
  l.unit_cost_cents::bigint * o.qty AS cost_cents,
  fee.fee_cents,
  o.revenue_cents - l.unit_cost_cents::bigint * o.qty - fee.fee_cents AS profit_cents
FROM out_lines o
JOIN lots l ON l.id = o.lot_id
JOIN items i ON i.id = l.item_id
CROSS JOIN LATERAL (
  SELECT round(
    CASE
      WHEN o.txn_revenue_cents = 0 THEN o.fees_cents::numeric / o.txn_line_count
      ELSE o.fees_cents::numeric * o.revenue_cents / o.txn_revenue_cents
    END
  )::bigint AS fee_cents
) fee;
