-- Latest price per item and price key, from either the daily history or the
-- current catalog price stored on the item. The newest as_of wins.
CREATE OR REPLACE VIEW latest_prices AS
SELECT DISTINCT ON (item_id, price_key)
  item_id, price_key, as_of, market_cents
FROM (
  SELECT item_id, price_key, as_of, market_cents
  FROM price_snapshots
  UNION ALL
  SELECT id, CASE WHEN kind = 'sealed' THEN 'SEALED' ELSE 'NM' END, market_as_of, market_cents
  FROM items
  WHERE market_cents IS NOT NULL AND market_as_of IS NOT NULL
) prices
ORDER BY item_id, price_key, as_of DESC;
--> statement-breakpoint

ALTER TABLE sync_runs
  ADD CONSTRAINT sync_runs_status_valid CHECK (status IN ('running', 'succeeded', 'partial', 'failed'));
--> statement-breakpoint

-- At most one sync per source can be running at a time.
CREATE UNIQUE INDEX sync_runs_one_running ON sync_runs (source) WHERE status = 'running';
