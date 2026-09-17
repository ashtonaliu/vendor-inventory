const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number | null | undefined, { exact = false } = {}): string {
  if (cents == null) return "—";
  return (exact ? usdCents : usd).format(cents / 100);
}

export function formatSignedCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const formatted = formatCents(Math.abs(cents));
  if (cents > 0) return `+${formatted}`;
  if (cents < 0) return `−${formatted}`;
  return formatted;
}

export function formatPercent(ratio: number | null | undefined, { signed = false } = {}): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const pct = Math.round(ratio * 100);
  if (signed && pct > 0) return `+${pct}%`;
  if (signed && pct < 0) return `−${Math.abs(pct)}%`;
  return `${pct}%`;
}

export function formatGrading(lot: { condition: string | null; grader: string | null; grade: string | null }, category: string) {
  if (lot.grader && lot.grade) return `${lot.grader} ${Number(lot.grade)}`;
  if (category === "sealed") return "Sealed";
  return lot.condition ?? "NM";
}

export function toneFor(value: number | null | undefined) {
  if (value == null || value === 0) return "text-zinc-500 dark:text-zinc-400";
  return value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}
