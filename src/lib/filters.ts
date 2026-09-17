import type { Category } from "@/db/schema";

export const RANGE_OPTIONS = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
] as const;

export const CATEGORY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "single", label: "Singles" },
  { value: "sealed", label: "Sealed" },
  { value: "graded", label: "Graded" },
] as const;

export type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];
export type CategoryFilter = Category | "all";

type RawParams = Record<string, string | string[] | undefined>;

function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly { value: T }[], fallback: T): T {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return allowed.some((o) => o.value === value) ? (value as T) : fallback;
}

export function parseRange(params: RawParams): RangeValue {
  return pick(params.range, RANGE_OPTIONS, "90d");
}

export function parseCategory(params: RawParams): CategoryFilter {
  return pick(params.category, CATEGORY_OPTIONS, "all");
}

export function rangeStart(range: RangeValue, now = new Date()): Date | null {
  switch (range) {
    case "30d":
      return new Date(now.getTime() - 30 * 86_400_000);
    case "90d":
      return new Date(now.getTime() - 90 * 86_400_000);
    case "ytd":
      return new Date(now.getFullYear(), 0, 1);
    case "all":
      return null;
  }
}

// Builds a URL that changes one query param and keeps the rest.
export function withParam(pathname: string, params: RawParams, key: string, value: string): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && k !== key) next.set(k, v);
  }
  next.set(key, value);
  return `${pathname}?${next.toString()}`;
}
