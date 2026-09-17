// Shared by the database schema, server code, and client components.
// Must not import anything server-only.

export const ITEM_KINDS = ["single", "sealed"] as const;
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export const CHANNELS = ["show", "ebay", "tcgplayer", "local", "other"] as const;
export const GRADERS = ["PSA", "CGC", "BGS", "TAG"] as const;

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
