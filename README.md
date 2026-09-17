# Binder

Inventory and profit tracking for Pokémon TCG vendors. Track every card and sealed product you
own at today's market price, record buys and sales at card shows, and see whether the business
is actually making money, broken down by category and date range, after table fees.

**Stack:** Next.js 16 (App Router, Server Components) · TypeScript · PostgreSQL 17 · Drizzle ORM · Tailwind CSS 4

## How profit is calculated

- **Realized profit** per sale = sale price − that copy's cost basis − its share of transaction fees.
  Fees on a multi-item sale are split by each line's share of revenue.
- **Unrealized profit** = today's market value − cost basis, for everything still in stock.
- **Buy / sell vs market** compares what you paid or received to the market price *frozen at the
  time of the transaction*, so it measures how well you buy and sell, independent of the market moving.
- Raw singles are valued at the Near Mint price × a condition multiplier (LP = 85%, etc.).
  Graded cards and sealed product use their own price series.

Money is stored as integer cents throughout. Profit is never stored; it's derived by the
`lot_valuations` and `realized_sales` SQL views in [`drizzle/0001_profit_views.sql`](drizzle/0001_profit_views.sql),
so it can't drift out of sync with the transaction history.

## Market prices

Prices come from [TCGCSV](https://tcgcsv.com), a free daily mirror of TCGplayer's catalog and market
prices. It refreshes once a day around 20:00 UTC.

`npm run prices:sync` pulls every English Pokémon set (about 220 sets and 31,000 cards and sealed
products, roughly 80 seconds):

- Imports the full catalog with card images, so any card can be found on the Buy and Trade screens.
- Links items you entered by hand to their TCGplayer product when exactly one product matches
  (same set plus card number, or the exact name for sealed product).
- Stores the latest market price on every catalog item, and adds a daily history row only for items
  you've owned, so the database doesn't grow by 31,000 rows a day.
- Records each run in `sync_runs`. A set that fails is retried, then skipped and logged, and the run is
  marked `partial` rather than stopping. A unique index allows only one sync to run at a time.

TCGplayer's market price is effectively the Near Mint price, so lower conditions still use the
condition multipliers.

### Graded prices (Card Ladder, optional)

Slabs with a cert number can be valued with Card Ladder data through
[Parse's Card Ladder API](https://parse.bot/marketplace/5554022d-8a04-46d0-b2c5-56f3b5abcea2/cardladder-com-api),
an unofficial third-party wrapper. Add cert numbers when buying or trading a slab, or on the
Inventory page, and set `PARSE_API_KEY` in `.env.local`.

`npm run graded:sync` values every slab still in stock (PSA, BGS, CGC, SGC) with one bulk request
per 200 certs (3 credits each, so a daily run fits the free tier), and saves the value as that card's
graded price, e.g. `PSA10`. Slabs of the same card and grade are averaged.

Parse doesn't document its response format, so it was checked against a real response (values are
whole dollars). If Parse changes it, set `RESPONSE_FORMAT_VERIFIED` in
[`src/lib/cardladder.ts`](src/lib/cardladder.ts) to `false`, which stops the sync from writing prices,
and inspect a live response with `npm run cardladder:probe` (one request, 3 credits).

## Data model

| Table | What it holds |
|---|---|
| `items` | Catalog entries: a card or sealed product |
| `lots` | Physical copies you own, each with its own cost basis and remaining quantity |
| `transactions` | A buy, sell, or trade, with cash in/out, fees, channel, and show |
| `transaction_lines` | Which lots moved in each transaction, in which direction |
| `price_snapshots` | Daily market price history per item and price key (`NM`, `SEALED`, `PSA10`) |
| `events` | Card shows and their table fees |
| `condition_multipliers` | Discount applied to NM prices for LP / MP / HP / DMG |
| `sync_runs` | One row per price sync, with counts and any per-set errors |

## Local setup (macOS)

```bash
brew install node postgresql@17
LC_ALL=en_US.UTF-8 pg_ctl -D /opt/homebrew/var/postgresql@17 -l /opt/homebrew/var/log/postgresql@17.log start
createdb vendor_inventory

cp .env.example .env.local   # then set your username in DATABASE_URL
npm install
npm run db:migrate
npm run db:seed              # optional: sample inventory and sales
npm run prices:sync          # import the catalog and current prices
npm run dev
```

Open http://localhost:3000.

Postgres isn't set to start at login, so after a restart run the `pg_ctl ... start` line again
(or `brew services start postgresql@17` to have it start automatically).

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Reset the database to sample data (**deletes existing data**, including the catalog; run `prices:sync` after) |
| `npm run graded:sync` | Value slabs with cert numbers using Card Ladder (needs `PARSE_API_KEY`) |
| `npm run cardladder:probe` | Make one Card Ladder request and print the raw response. `-- --cert 12345678 --grader PSA` picks the slab |
| `npm run prices:sync` | Import the TCGplayer catalog and today's prices. `-- --only "Evolving Skies"` limits it to matching sets |
| `npm run db:studio` | Browse the database in Drizzle Studio |
