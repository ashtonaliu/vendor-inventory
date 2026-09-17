import { and, asc, desc, eq, gt, gte, ilike, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import {
  conditionMultipliers,
  events,
  items,
  latestPrices,
  lots,
  lotValuations,
  realizedSales,
  transactionLines,
  transactions,
  type Category,
} from "@/db/schema";
import type { Condition } from "@/lib/domain";
import { rangeStart, type CategoryFilter, type RangeValue } from "@/lib/filters";

const sumCents = (column: SQLWrapper) =>
  sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

// Every whitespace-separated term must appear somewhere in the searchable text.
function matchAllTerms(searchable: SQL, query: string) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((term) => ilike(searchable, `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
}

const lotSearchText = sql`(${lotValuations.name} || ' ' || ${lotValuations.setName} || ' ' || coalesce(${lotValuations.cardNumber}, ''))`;
// Same expression as items_search_trgm_idx so Postgres can use the trigram index.
const itemSearchText = sql`(${items.name} || ' ' || ${items.setName} || ' ' || coalesce(${items.cardNumber}, ''))`;

const lotCategory = sql<Category>`case
  when ${lots.grader} is not null then 'graded'
  when ${items.kind} = 'sealed' then 'sealed'
  else 'single' end`;

export async function getDashboard(range: RangeValue, category: CategoryFilter) {
  const since = rangeStart(range);

  const inventoryWhere = and(
    gt(lotValuations.qtyRemaining, 0),
    category === "all" ? undefined : eq(lotValuations.category, category),
  );

  const salesWhere = and(
    since ? gte(realizedSales.occurredAt, since) : undefined,
    category === "all" ? undefined : eq(realizedSales.category, category),
  );

  const [inventory, sales, buys, tableFees, byCategory, byMonth, recentSales] = await Promise.all([
    db
      .select({
        marketValueCents: sumCents(lotValuations.marketValueCents),
        costCents: sumCents(lotValuations.costRemainingCents),
        unrealizedCents: sumCents(lotValuations.unrealizedCents),
        units: sumCents(lotValuations.qtyRemaining),
      })
      .from(lotValuations)
      .where(inventoryWhere),

    db
      .select({
        profitCents: sumCents(realizedSales.profitCents),
        revenueCents: sumCents(realizedSales.revenueCents),
        units: sumCents(realizedSales.qty),
        marketCents: sumCents(sql`${realizedSales.unitMarketCents}::bigint * ${realizedSales.qty}`),
      })
      .from(realizedSales)
      .where(salesWhere),

    db
      .select({
        paidCents: sumCents(sql`${transactionLines.unitPriceCents}::bigint * ${transactionLines.qty}`),
        marketCents: sumCents(sql`${transactionLines.unitMarketCents}::bigint * ${transactionLines.qty}`),
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactions.id, transactionLines.transactionId))
      .innerJoin(lots, eq(lots.id, transactionLines.lotId))
      .innerJoin(items, eq(items.id, lots.itemId))
      .where(
        and(
          eq(transactionLines.direction, "in"),
          since ? gte(transactions.occurredAt, since) : undefined,
          category === "all" ? undefined : sql`${lotCategory} = ${category}`,
        ),
      ),

    db
      .select({ cents: sumCents(events.tableFeeCents) })
      .from(events)
      .where(since ? gte(events.startsOn, since.toISOString().slice(0, 10)) : undefined),

    db
      .select({
        category: realizedSales.category,
        profitCents: sumCents(realizedSales.profitCents),
        revenueCents: sumCents(realizedSales.revenueCents),
      })
      .from(realizedSales)
      .where(since ? gte(realizedSales.occurredAt, since) : undefined)
      .groupBy(realizedSales.category),

    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${realizedSales.occurredAt}), 'YYYY-MM')`,
        profitCents: sumCents(realizedSales.profitCents),
      })
      .from(realizedSales)
      .where(salesWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    db
      .select({
        lineId: realizedSales.lineId,
        name: realizedSales.name,
        category: realizedSales.category,
        occurredAt: realizedSales.occurredAt,
        channel: realizedSales.channel,
        qty: realizedSales.qty,
        revenueCents: realizedSales.revenueCents,
        profitCents: realizedSales.profitCents,
        unitPriceCents: realizedSales.unitPriceCents,
        unitMarketCents: realizedSales.unitMarketCents,
      })
      .from(realizedSales)
      .where(salesWhere)
      .orderBy(desc(realizedSales.occurredAt), desc(realizedSales.lineId))
      .limit(6),
  ]);

  const s = sales[0];
  const b = buys[0];

  return {
    inventory: inventory[0],
    realized: {
      profitCents: s.profitCents,
      revenueCents: s.revenueCents,
      units: s.units,
      tableFeesCents: category === "all" ? tableFees[0].cents : null,
    },
    buyPctOfMarket: b.marketCents > 0 ? b.paidCents / b.marketCents : null,
    sellPctOfMarket: s.marketCents > 0 ? s.revenueCents / s.marketCents : null,
    byCategory,
    byMonth: fillMonths(byMonth, since),
    recentSales,
  };
}

function fillMonths(rows: { month: string; profitCents: number }[], since: Date | null) {
  const byKey = new Map(rows.map((r) => [r.month, r.profitCents]));
  const now = new Date();
  const first = since ?? (rows[0] ? new Date(`${rows[0].month}-01T00:00:00`) : now);
  const months: { month: string; profitCents: number }[] = [];

  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= now; d.setMonth(d.getMonth() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ month: key, profitCents: byKey.get(key) ?? 0 });
  }
  return months;
}

export type InventorySort = "value" | "gain" | "recent" | "name";

export async function searchInventory({
  query,
  category,
  sort,
}: {
  query: string;
  category: CategoryFilter;
  sort: InventorySort;
}) {
  const termFilters = matchAllTerms(lotSearchText, query);

  const orderBy = {
    value: [sql`${lotValuations.marketValueCents} desc nulls last`],
    gain: [sql`(${lotValuations.unitMarketCents}::numeric / nullif(${lotValuations.unitCostCents}, 0)) desc nulls last`],
    recent: [desc(lotValuations.acquiredAt)],
    name: [asc(lotValuations.name), asc(lotValuations.setName)],
  }[sort];

  return db
    .select()
    .from(lotValuations)
    .where(
      and(
        gt(lotValuations.qtyRemaining, 0),
        category === "all" ? undefined : eq(lotValuations.category, category),
        ...termFilters,
      ),
    )
    .orderBy(...orderBy, asc(lotValuations.lotId));
}

export async function searchStock(query: string, limit = 20) {
  return db
    .select({
      lotId: lotValuations.lotId,
      name: lotValuations.name,
      setName: lotValuations.setName,
      cardNumber: lotValuations.cardNumber,
      category: lotValuations.category,
      condition: lotValuations.condition,
      grader: lotValuations.grader,
      grade: lotValuations.grade,
      qtyRemaining: lotValuations.qtyRemaining,
      unitCostCents: lotValuations.unitCostCents,
      unitMarketCents: lotValuations.unitMarketCents,
    })
    .from(lotValuations)
    .where(and(gt(lotValuations.qtyRemaining, 0), ...matchAllTerms(lotSearchText, query)))
    .orderBy(asc(lotValuations.name), asc(lotValuations.setName), asc(lotValuations.lotId))
    .limit(limit);
}

export type StockResult = Awaited<ReturnType<typeof searchStock>>[number];

export async function searchCatalog(query: string, limit = 20) {
  const found = await db
    .select({
      itemId: items.id,
      kind: items.kind,
      name: items.name,
      setName: items.setName,
      cardNumber: items.cardNumber,
    })
    .from(items)
    .where(and(...matchAllTerms(itemSearchText, query)))
    .orderBy(asc(items.name), asc(items.setName))
    .limit(limit);

  if (found.length === 0) return [];

  const prices = await db
    .select({ itemId: latestPrices.itemId, priceKey: latestPrices.priceKey, marketCents: latestPrices.marketCents })
    .from(latestPrices)
    .where(inArray(latestPrices.itemId, found.map((i) => i.itemId)));

  return found.map((item) => ({
    ...item,
    prices: Object.fromEntries(prices.filter((p) => p.itemId === item.itemId).map((p) => [p.priceKey, p.marketCents])),
  }));
}

export type CatalogResult = Awaited<ReturnType<typeof searchCatalog>>[number];

export async function getConditionMultipliers(): Promise<Record<Condition, number>> {
  const rows = await db.select().from(conditionMultipliers);
  return Object.fromEntries(rows.map((r) => [r.condition, Number(r.multiplier)])) as Record<Condition, number>;
}

export async function getRecentEvents(limit = 8) {
  return db
    .select({ id: events.id, name: events.name, startsOn: events.startsOn })
    .from(events)
    .orderBy(desc(events.startsOn), desc(events.id))
    .limit(limit);
}

export type EventOption = Awaited<ReturnType<typeof getRecentEvents>>[number];
