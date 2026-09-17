import { sql } from "drizzle-orm";
import { db, pgClient } from "@/db";
import { conditionMultipliers, events, items, priceSnapshots } from "@/db/schema";
import { recordBuy, recordSale } from "@/lib/ledger";

// Sample data for local development. Prices are illustrative, not real market data.

const usd = (dollars: number) => Math.round(dollars * 100);
const at = (iso: string) => new Date(`${iso}T12:00:00-07:00`);

const itemSeeds: Record<string, typeof items.$inferInsert> = {
  umbreonVmax: { kind: "single", name: "Umbreon VMAX", setName: "Evolving Skies", cardNumber: "215/203", rarity: "Alternate Art Secret" },
  charizardEx: { kind: "single", name: "Charizard ex", setName: "Scarlet & Violet 151", cardNumber: "199/165", rarity: "Special Illustration Rare" },
  pikachuEx: { kind: "single", name: "Pikachu ex", setName: "Surging Sparks", cardNumber: "238/191", rarity: "Special Illustration Rare" },
  umbreonEx: { kind: "single", name: "Umbreon ex", setName: "Prismatic Evolutions", cardNumber: "161/131", rarity: "Special Illustration Rare" },
  giratinaVstar: { kind: "single", name: "Giratina VSTAR", setName: "Lost Origin", cardNumber: "212/196", rarity: "Alternate Art Secret" },
  iono: { kind: "single", name: "Iono", setName: "Paldea Evolved", cardNumber: "269/193", rarity: "Special Illustration Rare" },
  rayquazaVmax: { kind: "single", name: "Rayquaza VMAX", setName: "Evolving Skies", cardNumber: "218/203", rarity: "Alternate Art Secret" },
  esBox: { kind: "sealed", name: "Evolving Skies Booster Box", setName: "Evolving Skies" },
  peEtb: { kind: "sealed", name: "Prismatic Evolutions Elite Trainer Box", setName: "Prismatic Evolutions" },
  czEtb: { kind: "sealed", name: "Crown Zenith Elite Trainer Box", setName: "Crown Zenith" },
};

// [item, price key, price at start of year, price now]
const priceTrends: [string, string, number, number][] = [
  ["umbreonVmax", "NM", 1480, 1850],
  ["charizardEx", "NM", 400, 455],
  ["pikachuEx", "NM", 290, 335],
  ["umbreonEx", "NM", 560, 520],
  ["umbreonEx", "PSA10", 1250, 1180],
  ["giratinaVstar", "NM", 190, 180],
  ["iono", "NM", 150, 145],
  ["rayquazaVmax", "NM", 335, 295],
  ["esBox", "SEALED", 1180, 1400],
  ["peEtb", "SEALED", 190, 172],
  ["czEtb", "SEALED", 95, 110],
];

function weeklyDates(fromIso: string, toIso: string): string[] {
  const dates: string[] = [];
  for (let d = new Date(`${fromIso}T00:00:00Z`); d <= new Date(`${toIso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function main() {
  await db.execute(sql`
    TRUNCATE transaction_lines, transactions, lots, price_snapshots, events, items, condition_multipliers
    RESTART IDENTITY CASCADE
  `);

  await db.insert(conditionMultipliers).values([
    { condition: "NM", multiplier: "1.000" },
    { condition: "LP", multiplier: "0.850" },
    { condition: "MP", multiplier: "0.700" },
    { condition: "HP", multiplier: "0.500" },
    { condition: "DMG", multiplier: "0.350" },
  ]);

  const inserted = await db
    .insert(items)
    .values(Object.values(itemSeeds))
    .returning({ id: items.id });
  const id = Object.fromEntries(Object.keys(itemSeeds).map((key, i) => [key, inserted[i].id]));

  const dates = weeklyDates("2026-01-05", "2026-09-14");
  const snapshots = priceTrends.flatMap(([key, priceKey, start, end], trendIndex) =>
    dates.map((asOf, week) => {
      const progress = week / (dates.length - 1);
      const wobble = start * 0.02 * Math.sin(week * 0.9 + trendIndex);
      return {
        itemId: id[key],
        priceKey,
        asOf,
        marketCents: usd(start + (end - start) * progress + wobble),
        source: "seed",
      };
    }),
  );
  await db.insert(priceSnapshots).values(snapshots);

  const [sanJose, sacramento, expo] = await db
    .insert(events)
    .values([
      { name: "San Jose Card Show", location: "San Jose, CA", startsOn: "2026-06-13", tableFeeCents: usd(150) },
      { name: "Sacramento Card Show", location: "Sacramento, CA", startsOn: "2026-08-22", tableFeeCents: usd(200) },
      { name: "Bay Area TCG Expo", location: "Santa Clara, CA", startsOn: "2026-09-12", tableFeeCents: usd(250) },
    ])
    .returning({ id: events.id });

  // Bought at $1,300 (market $1,500), sold months later at $1,700 (market $1,800).
  const umbreon = await recordBuy({ itemId: id.umbreonVmax, condition: "NM", qty: 1, unitPriceCents: usd(1300), unitMarketCents: usd(1500), occurredAt: at("2026-02-10"), channel: "local" });
  await recordSale({ lotId: umbreon.lotId, qty: 1, unitPriceCents: usd(1700), unitMarketCents: usd(1800), occurredAt: at("2026-08-22"), eventId: sacramento.id, channel: "show" });

  const charizard = await recordBuy({ itemId: id.charizardEx, condition: "NM", qty: 2, unitPriceCents: usd(360), unitMarketCents: usd(410), occurredAt: at("2026-03-02"), channel: "ebay", feesCents: usd(12) });
  await recordSale({ lotId: charizard.lotId, qty: 1, unitPriceCents: usd(430), unitMarketCents: usd(445), occurredAt: at("2026-06-13"), eventId: sanJose.id, channel: "show" });

  const pikachu = await recordBuy({ itemId: id.pikachuEx, condition: "NM", qty: 3, unitPriceCents: usd(210), unitMarketCents: usd(280), occurredAt: at("2026-06-13"), eventId: sanJose.id, channel: "show" });
  await recordSale({ lotId: pikachu.lotId, qty: 1, unitPriceCents: usd(315), unitMarketCents: usd(330), occurredAt: at("2026-07-20"), channel: "ebay", feesCents: usd(41) });

  await recordBuy({ itemId: id.umbreonEx, condition: "LP", qty: 3, unitPriceCents: usd(380), unitMarketCents: usd(442), occurredAt: at("2026-05-05"), channel: "tcgplayer" });
  await recordBuy({ itemId: id.umbreonEx, grader: "PSA", grade: "10", qty: 1, unitPriceCents: usd(1050), unitMarketCents: usd(1200), occurredAt: at("2026-07-01"), channel: "local" });

  const esBox = await recordBuy({ itemId: id.esBox, qty: 2, unitPriceCents: usd(1050), unitMarketCents: usd(1250), occurredAt: at("2026-01-20"), channel: "local" });
  await recordSale({ lotId: esBox.lotId, qty: 1, unitPriceCents: usd(1320), unitMarketCents: usd(1380), occurredAt: at("2026-09-12"), eventId: expo.id, channel: "show" });

  const peEtb = await recordBuy({ itemId: id.peEtb, qty: 6, unitPriceCents: usd(120), unitMarketCents: usd(160), occurredAt: at("2026-03-15"), channel: "local" });
  await recordSale({ lotId: peEtb.lotId, qty: 4, unitPriceCents: usd(165), unitMarketCents: usd(170), occurredAt: at("2026-06-13"), eventId: sanJose.id, channel: "show" });

  const czEtb = await recordBuy({ itemId: id.czEtb, qty: 4, unitPriceCents: usd(70), unitMarketCents: usd(100), occurredAt: at("2026-02-28"), channel: "local" });
  await recordSale({ lotId: czEtb.lotId, qty: 2, unitPriceCents: usd(110), unitMarketCents: usd(108), occurredAt: at("2026-09-12"), eventId: expo.id, channel: "show" });

  await recordBuy({ itemId: id.giratinaVstar, condition: "MP", qty: 1, unitPriceCents: usd(95), unitMarketCents: usd(126), occurredAt: at("2026-08-22"), eventId: sacramento.id, channel: "show" });
  await recordBuy({ itemId: id.iono, condition: "NM", qty: 1, unitPriceCents: usd(99), unitMarketCents: usd(145), occurredAt: at("2026-09-12"), eventId: expo.id, channel: "show" });

  // A losing flip, so the dashboard isn't all green.
  const rayquaza = await recordBuy({ itemId: id.rayquazaVmax, condition: "NM", qty: 1, unitPriceCents: usd(300), unitMarketCents: usd(330), occurredAt: at("2026-04-02"), channel: "tcgplayer" });
  await recordSale({ lotId: rayquaza.lotId, qty: 1, unitPriceCents: usd(285), unitMarketCents: usd(300), occurredAt: at("2026-09-12"), eventId: expo.id, channel: "show" });

  console.log(`Seeded ${inserted.length} items, ${snapshots.length} price snapshots, 3 events`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
