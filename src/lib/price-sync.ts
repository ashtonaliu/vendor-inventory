import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, syncRuns } from "@/db/schema";
import type { ItemKind } from "@/lib/domain";
import { getGroups, getLastUpdated, getPrices, getProducts, type TcgGroup, type TcgPrice, type TcgProduct } from "@/lib/tcgcsv";

const SOURCE = "tcgcsv";
const REQUEST_GAP_MS = 150;
const BATCH_SIZE = 500;
const STALE_RUN_MS = 2 * 60 * 60 * 1000;

// When a product has several printings, the headline price comes from the first match.
const SUBTYPE_PREFERENCE = ["Holofoil", "Normal", "1st Edition Holofoil", "Unlimited Holofoil", "1st Edition", "Unlimited"];

// "SWSH07: Evolving Skies" -> "Evolving Skies". Names like "Crown Zenith: Galarian Gallery" are kept whole.
export function setNameFromGroup(groupName: string): string {
  return groupName.replace(/^[A-Z]{1,6}\d*(?:\.\d+)?[a-z]?:\s+/, "");
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// "005/012" and "5/12" are the same card number.
export function sameCardNumber(a: string, b: string): boolean {
  const key = (n: string) =>
    n
      .trim()
      .toLowerCase()
      .split("/")
      .map((part) => part.replace(/^([a-z]*)0+(?=\d)/, "$1"))
      .join("/");
  return key(a) === key(b);
}

// Many TCGplayer names repeat the card number ("Umbreon ex - 161/131"), which the UI already shows.
export function displayName(product: TcgProduct): string {
  const match = / - ([0-9A-Za-z]+\/[0-9A-Za-z]+)$/.exec(product.name);
  if (!product.number || !match || !sameCardNumber(match[1], product.number)) return product.name;
  return product.name.slice(0, match.index);
}

export function isImportable(product: TcgProduct): boolean {
  return !/^code card\b/i.test(product.name);
}

export function kindOf(product: TcgProduct): ItemKind {
  return product.number ? "single" : "sealed";
}

export function pickPrice(prices: TcgPrice[]): TcgPrice | null {
  const priced = prices.filter((p) => p.marketPrice != null);
  if (priced.length === 0) return null;
  for (const subtype of SUBTYPE_PREFERENCE) {
    const match = priced.find((p) => p.subTypeName === subtype);
    if (match) return match;
  }
  return priced[0];
}

type UnlinkedItem = { id: number; kind: ItemKind; name: string; setName: string; cardNumber: string | null };

// Links hand-entered items to a product only when exactly one product fits, so a
// wrong guess never silently takes over an item's price.
export function matchUnlinked(unlinked: UnlinkedItem[], setName: string, products: TcgProduct[]) {
  const setKey = normalize(setName);
  const matches: { itemId: number; productId: number }[] = [];

  for (const item of unlinked) {
    if (normalize(item.setName) !== setKey) continue;
    const candidates = products.filter((p) =>
      item.kind === "single"
        ? kindOf(p) === "single" && item.cardNumber != null && p.number != null && sameCardNumber(p.number, item.cardNumber)
        : kindOf(p) === "sealed" && normalize(p.name) === normalize(item.name),
    );
    if (candidates.length === 1) matches.push({ itemId: item.id, productId: candidates[0].productId });
  }
  return matches;
}

export type SyncSummary = {
  runId: number;
  status: "succeeded" | "partial" | "failed";
  dataAsOf: string;
  groupsTotal: number;
  groupsFailed: number;
  productsSeen: number;
  itemsLinked: number;
  snapshotsWritten: number;
  failures: string[];
};

export async function syncPrices({
  onlyGroups,
  log = console.log,
}: { onlyGroups?: string; log?: (message: string) => void } = {}): Promise<SyncSummary> {
  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "Abandoned: never finished" })
    .where(and(eq(syncRuns.source, SOURCE), eq(syncRuns.status, "running"), lt(syncRuns.startedAt, new Date(Date.now() - STALE_RUN_MS))));

  let runId: number;
  try {
    [{ id: runId }] = await db.insert(syncRuns).values({ source: SOURCE, status: "running" }).returning({ id: syncRuns.id });
  } catch {
    throw new Error("A price sync is already running.");
  }

  const failures: string[] = [];
  const counts = { groupsTotal: 0, productsSeen: 0, itemsLinked: 0, snapshotsWritten: 0 };
  let dataAsOf = "";

  try {
    const lastUpdated = await getLastUpdated();
    dataAsOf = lastUpdated.toISOString().slice(0, 10);
    log(`TCGCSV data last updated ${lastUpdated.toISOString()}`);

    let groups: TcgGroup[] = await getGroups();
    if (onlyGroups) {
      const needle = onlyGroups.toLowerCase();
      groups = groups.filter((g) => g.name.toLowerCase().includes(needle));
    }
    counts.groupsTotal = groups.length;
    log(`Syncing ${groups.length} sets`);

    const unlinked: UnlinkedItem[] = await db
      .select({ id: items.id, kind: items.kind, name: items.name, setName: items.setName, cardNumber: items.cardNumber })
      .from(items)
      .where(isNull(items.tcgplayerProductId));
    const linkedProductIds = new Set(
      (await db.select({ id: items.tcgplayerProductId }).from(items).where(isNotNull(items.tcgplayerProductId))).map((r) => r.id!),
    );

    for (const [index, group] of groups.entries()) {
      try {
        const products = (await getProducts(group.groupId)).filter(isImportable);
        await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
        const prices = await getPrices(group.groupId);
        await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));

        const setName = setNameFromGroup(group.name);
        const pricesByProduct = Map.groupBy(prices, (p) => p.productId);
        const links = matchUnlinked(unlinked, setName, products).filter((m) => !linkedProductIds.has(m.productId));

        const rows = products.map((product) => {
          const price = pickPrice(pricesByProduct.get(product.productId) ?? []);
          const kind = kindOf(product);
          return {
            kind,
            name: displayName(product),
            setName,
            cardNumber: kind === "single" ? product.number : null,
            rarity: product.rarity,
            variant: price?.subTypeName ?? null,
            imageUrl: product.imageUrl,
            tcgplayerProductId: product.productId,
            marketCents: price ? Math.round(price.marketPrice! * 100) : null,
            marketAsOf: price ? dataAsOf : null,
          };
        });

        await db.transaction(async (tx) => {
          for (const link of links) {
            await tx
              .update(items)
              .set({ tcgplayerProductId: link.productId })
              .where(and(eq(items.id, link.itemId), isNull(items.tcgplayerProductId)));
          }
          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            await tx
              .insert(items)
              .values(rows.slice(i, i + BATCH_SIZE))
              .onConflictDoUpdate({
                target: items.tcgplayerProductId,
                set: {
                  kind: sql`excluded.kind`,
                  name: sql`excluded.name`,
                  setName: sql`excluded.set_name`,
                  cardNumber: sql`excluded.card_number`,
                  rarity: sql`excluded.rarity`,
                  variant: sql`coalesce(excluded.variant, ${items.variant})`,
                  imageUrl: sql`coalesce(excluded.image_url, ${items.imageUrl})`,
                  marketCents: sql`coalesce(excluded.market_cents, ${items.marketCents})`,
                  marketAsOf: sql`coalesce(excluded.market_as_of, ${items.marketAsOf})`,
                },
              });
          }
        });

        for (const link of links) linkedProductIds.add(link.productId);
        for (const row of rows) linkedProductIds.add(row.tcgplayerProductId);
        const linkedItemIds = new Set(links.map((l) => l.itemId));
        for (let i = unlinked.length - 1; i >= 0; i--) if (linkedItemIds.has(unlinked[i].id)) unlinked.splice(i, 1);

        counts.productsSeen += rows.length;
        counts.itemsLinked += links.length;
        log(`[${index + 1}/${groups.length}] ${group.name}: ${rows.length} products${links.length ? `, linked ${links.length}` : ""}`);
      } catch (err) {
        failures.push(`${group.name}: ${err instanceof Error ? err.message : String(err)}`);
        log(`[${index + 1}/${groups.length}] ${group.name}: FAILED (${err instanceof Error ? err.message : err})`);
      }
    }

    // Keep daily history only for things you've actually held.
    const written = await db.execute(sql`
      INSERT INTO price_snapshots (item_id, price_key, as_of, market_cents, source)
      SELECT i.id, CASE WHEN i.kind = 'sealed' THEN 'SEALED' ELSE 'NM' END, i.market_as_of, i.market_cents, 'tcgplayer'
      FROM items i
      WHERE i.market_as_of = ${dataAsOf}
        AND i.market_cents IS NOT NULL
        AND EXISTS (SELECT 1 FROM lots l WHERE l.item_id = i.id)
      ON CONFLICT (item_id, price_key, as_of)
      DO UPDATE SET market_cents = excluded.market_cents, source = excluded.source
    `);
    counts.snapshotsWritten = written.count;

    const status = failures.length === 0 ? "succeeded" : failures.length < groups.length ? "partial" : "failed";
    await db
      .update(syncRuns)
      .set({
        status,
        finishedAt: new Date(),
        dataAsOf,
        ...counts,
        groupsFailed: failures.length,
        error: failures.length ? failures.join("\n").slice(0, 4000) : null,
      })
      .where(eq(syncRuns.id, runId));

    return { runId, status, dataAsOf, ...counts, groupsFailed: failures.length, failures };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        dataAsOf: dataAsOf || null,
        ...counts,
        groupsFailed: failures.length,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 4000),
      })
      .where(eq(syncRuns.id, runId));
    throw err;
  }
}
