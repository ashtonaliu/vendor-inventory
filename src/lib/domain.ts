// Shared by the database schema, server code, and client components.
// Must not import anything server-only.

export const ITEM_KINDS = ["single", "sealed"] as const;
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export const CHANNELS = ["show", "ebay", "tcgplayer", "local", "other"] as const;
export const GRADERS = ["PSA", "CGC", "BGS", "TAG"] as const;
export const GRADE_OPTIONS = ["10", "9.5", "9", "8.5", "8", "7", "6", "5", "4", "3", "2", "1"] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];
export type Condition = (typeof CONDITIONS)[number];
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  show: "Card show",
  ebay: "eBay",
  tcgplayer: "TCGplayer",
  local: "Local",
  other: "Other",
};

export type Grading = { condition: Condition | null; grader: string | null; grade: string | null };

// Must match the price_key expression in the lot_valuations view.
export function priceKeyFor(kind: ItemKind, grading: Grading): string {
  if (grading.grader && grading.grade) return `${grading.grader}${Number(grading.grade)}`;
  if (kind === "sealed") return "SEALED";
  return "NM";
}

export function suggestMarketCents(
  kind: ItemKind,
  prices: Record<string, number>,
  grading: Grading,
  multipliers: Record<Condition, number>,
): number | null {
  const base = prices[priceKeyFor(kind, grading)];
  if (base == null) return null;
  const rawSingle = kind === "single" && !grading.grader && grading.condition;
  return Math.round(base * (rawSingle ? multipliers[grading.condition!] : 1));
}

// Splits an integer total across weights so the parts sum exactly to the total
// (largest-remainder rounding). Zero total weight splits evenly.
export function allocateByWeight(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const safe = weights.reduce((a, b) => a + b, 0) > 0 ? weights : weights.map(() => 1);
  const sum = safe.reduce((a, b) => a + b, 0);
  const raw = safe.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const byFraction = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; remainder > 0; k = (k + 1) % byFraction.length, remainder--) parts[byFraction[k][1]]++;
  return parts;
}

export type TradeGive = { qty: number; unitMarketCents: number; unitCostCents: number };
export type TradeGet = { qty: number; unitMarketCents: number };

// Cards traded away are treated as sold for the market value of what came back,
// plus cash received, minus cash paid. Cards received take their market value as cost.
export function computeTrade(give: TradeGive[], get: TradeGet[], cashInCents: number, cashOutCents: number) {
  const giveMarketCents = give.reduce((s, l) => s + l.unitMarketCents * l.qty, 0);
  const getMarketCents = get.reduce((s, l) => s + l.unitMarketCents * l.qty, 0);
  const giveCostCents = give.reduce((s, l) => s + l.unitCostCents * l.qty, 0);
  const proceedsCents = getMarketCents + cashInCents - cashOutCents;
  const lineProceedsCents = allocateByWeight(proceedsCents, give.map((l) => l.unitMarketCents * l.qty));

  return {
    giveMarketCents,
    getMarketCents,
    proceedsCents,
    lineProceedsCents,
    profitCents: proceedsCents - giveCostCents,
    // Positive means you came out ahead on market value.
    valueEdgeCents: proceedsCents - giveMarketCents,
  };
}

export function isValidGrade(grade: number): boolean {
  return grade >= 1 && grade <= 10 && Number.isInteger(grade * 2);
}

const DOLLARS = /^\s*\$?\s*(\d{0,7})(?:\.(\d{0,2}))?\s*$/;

export function parseDollarsToCents(input: string): number | null {
  const match = DOLLARS.exec(input.replace(/,/g, ""));
  if (!match || (!match[1] && !match[2])) return null;
  const cents = (match[2] ?? "").padEnd(2, "0");
  return Number(match[1] || 0) * 100 + Number(cents);
}
