import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { CHANNELS, CONDITIONS, ITEM_KINDS } from "@/lib/domain";

export const itemKind = pgEnum("item_kind", ITEM_KINDS);
export const cardCondition = pgEnum("card_condition", CONDITIONS);
export const transactionType = pgEnum("transaction_type", ["buy", "sell", "trade"]);
export const lineDirection = pgEnum("line_direction", ["in", "out"]);
export const salesChannel = pgEnum("sales_channel", CHANNELS);

export const items = pgTable(
  "items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: itemKind("kind").notNull(),
    name: text("name").notNull(),
    setName: text("set_name").notNull(),
    cardNumber: text("card_number"),
    variant: text("variant"),
    rarity: text("rarity"),
    tcgplayerProductId: integer("tcgplayer_product_id").unique(),
    imageUrl: text("image_url"),
    // Latest TCGplayer market price for the NM (singles) or sealed price key.
    // Full history is only kept in price_snapshots for items you've owned.
    marketCents: integer("market_cents"),
    marketAsOf: date("market_as_of"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("items_search_trgm_idx").using(
      "gin",
      sql`(${t.name} || ' ' || ${t.setName} || ' ' || coalesce(${t.cardNumber}, '')) gin_trgm_ops`,
    ),
  ],
);

// price_key is 'NM' for raw singles, 'SEALED' for sealed, or grader+grade like 'PSA10'.
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    priceKey: text("price_key").notNull(),
    asOf: date("as_of").notNull(),
    marketCents: integer("market_cents").notNull(),
    source: text("source").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.priceKey, t.asOf] }),
    check("market_cents_nonnegative", sql`${t.marketCents} >= 0`),
  ],
);

export const conditionMultipliers = pgTable("condition_multipliers", {
  condition: cardCondition("condition").primaryKey(),
  multiplier: numeric("multiplier", { precision: 4, scale: 3 }).notNull(),
});

export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  startsOn: date("starts_on").notNull(),
  tableFeeCents: integer("table_fee_cents").notNull().default(0),
});

export const lots = pgTable(
  "lots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => items.id),
    condition: cardCondition("condition"),
    grader: text("grader"),
    grade: numeric("grade", { precision: 3, scale: 1 }),
    qtyAcquired: integer("qty_acquired").notNull(),
    qtyRemaining: integer("qty_remaining").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
  },
  (t) => [
    index("lots_item_idx").on(t.itemId),
    check("qty_remaining_in_range", sql`${t.qtyRemaining} between 0 and ${t.qtyAcquired}`),
    check("grader_and_grade_together", sql`(${t.grader} is null) = (${t.grade} is null)`),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: transactionType("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    eventId: bigint("event_id", { mode: "number" }).references(() => events.id),
    channel: salesChannel("channel").notNull(),
    cashInCents: integer("cash_in_cents").notNull().default(0),
    cashOutCents: integer("cash_out_cents").notNull().default(0),
    feesCents: integer("fees_cents").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [index("transactions_occurred_at_idx").on(t.occurredAt)],
);

// unit_market_cents is frozen at the time of the transaction so buy/sell
// "% of market" stays accurate after prices move.
export const transactionLines = pgTable(
  "transaction_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    transactionId: bigint("transaction_id", { mode: "number" })
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    lotId: bigint("lot_id", { mode: "number" })
      .notNull()
      .references(() => lots.id),
    direction: lineDirection("direction").notNull(),
    qty: integer("qty").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    unitMarketCents: integer("unit_market_cents").notNull(),
  },
  (t) => [
    index("transaction_lines_transaction_idx").on(t.transactionId),
    index("transaction_lines_lot_idx").on(t.lotId),
    check("qty_positive", sql`${t.qty} > 0`),
  ],
);

export const syncRuns = pgTable("sync_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  source: text("source").notNull(),
  status: text("status").$type<"running" | "succeeded" | "partial" | "failed">().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  dataAsOf: date("data_as_of"),
  groupsTotal: integer("groups_total").notNull().default(0),
  groupsFailed: integer("groups_failed").notNull().default(0),
  productsSeen: integer("products_seen").notNull().default(0),
  itemsLinked: integer("items_linked").notNull().default(0),
  snapshotsWritten: integer("snapshots_written").notNull().default(0),
  error: text("error"),
});

export type Category = "single" | "sealed" | "graded";

// Views are created by hand-written SQL in drizzle/0001_profit_views.sql.
export const latestPrices = pgView("latest_prices", {
  itemId: bigint("item_id", { mode: "number" }).notNull(),
  priceKey: text("price_key").notNull(),
  asOf: date("as_of").notNull(),
  marketCents: integer("market_cents").notNull(),
}).existing();

export const lotValuations = pgView("lot_valuations", {
  lotId: bigint("lot_id", { mode: "number" }).notNull(),
  itemId: bigint("item_id", { mode: "number" }).notNull(),
  category: text("category").$type<Category>().notNull(),
  name: text("name").notNull(),
  setName: text("set_name").notNull(),
  cardNumber: text("card_number"),
  imageUrl: text("image_url"),
  condition: cardCondition("condition"),
  grader: text("grader"),
  grade: numeric("grade", { precision: 3, scale: 1 }),
  qtyRemaining: integer("qty_remaining").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
  unitMarketCents: integer("unit_market_cents"),
  priceAsOf: date("price_as_of"),
  marketValueCents: bigint("market_value_cents", { mode: "number" }),
  costRemainingCents: bigint("cost_remaining_cents", { mode: "number" }).notNull(),
  unrealizedCents: bigint("unrealized_cents", { mode: "number" }),
}).existing();

export const realizedSales = pgView("realized_sales", {
  lineId: bigint("line_id", { mode: "number" }).notNull(),
  transactionId: bigint("transaction_id", { mode: "number" }).notNull(),
  type: transactionType("type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  eventId: bigint("event_id", { mode: "number" }),
  channel: salesChannel("channel").notNull(),
  lotId: bigint("lot_id", { mode: "number" }).notNull(),
  itemId: bigint("item_id", { mode: "number" }).notNull(),
  category: text("category").$type<Category>().notNull(),
  name: text("name").notNull(),
  qty: integer("qty").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  unitMarketCents: integer("unit_market_cents").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  revenueCents: bigint("revenue_cents", { mode: "number" }).notNull(),
  costCents: bigint("cost_cents", { mode: "number" }).notNull(),
  feeCents: bigint("fee_cents", { mode: "number" }).notNull(),
  profitCents: bigint("profit_cents", { mode: "number" }).notNull(),
}).existing();
