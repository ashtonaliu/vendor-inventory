import type { Metadata } from "next";
import Link from "next/link";
import { CardThumb } from "@/components/card-thumb";
import { CertEditor } from "@/components/cert-editor";
import { FilterPills } from "@/components/filter-pills";
import { CATEGORY_OPTIONS, parseCategory } from "@/lib/filters";
import { formatCents, formatGrading, formatPercent, toneFor } from "@/lib/format";
import { searchInventory, type InventorySort } from "@/lib/queries";

export const metadata: Metadata = { title: "Inventory" };

const SORT_OPTIONS = [
  { value: "value", label: "Value" },
  { value: "gain", label: "Gain" },
  { value: "recent", label: "Newest" },
  { value: "name", label: "Name" },
] as const;

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const category = parseCategory(params);
  const sort: InventorySort = SORT_OPTIONS.some((o) => o.value === params.sort) ? (params.sort as InventorySort) : "value";

  const lots = await searchInventory({ query, category, sort });
  const totalValue = lots.reduce((sum, lot) => sum + (lot.marketValueCents ?? 0), 0);
  const totalUnits = lots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {totalUnits} items · {formatCents(totalValue)} at market
        </p>
      </div>

      <form role="search" action="/inventory" className="flex gap-2">
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="sort" value={sort} />
        <label htmlFor="q" className="sr-only">
          Search inventory
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Umbreon, Evolving Skies, 215/203"
          autoComplete="off"
          className="h-11 flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300 dark:focus:ring-white/10"
        />
        <button
          type="submit"
          className="h-11 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterPills label="Category" pathname="/inventory" params={params} paramKey="category" options={CATEGORY_OPTIONS} current={category} />
        <FilterPills label="Sort by" pathname="/inventory" params={params} paramKey="sort" options={SORT_OPTIONS} current={sort} />
      </div>

      {lots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="font-medium">{query ? `Nothing matches “${query}”` : "No items in this category"}</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Try a card name, set, or number.{" "}
            {(query || category !== "all") && (
              <Link href="/inventory" className="underline underline-offset-2">
                Clear filters
              </Link>
            )}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {lots.map((lot) => {
            const gain = lot.unitMarketCents == null ? null : lot.unitMarketCents / lot.unitCostCents - 1;
            return (
              <li
                key={lot.lotId}
                className="flex flex-col rounded-xl border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <CardThumb name={lot.name} setName={lot.setName} imageUrl={lot.imageUrl} category={lot.category} />
                <div className="mt-2.5 flex flex-1 flex-col px-0.5">
                  <p className="text-sm font-medium leading-snug">
                    {lot.name}
                    {lot.qtyRemaining > 1 && <span className="text-zinc-500 dark:text-zinc-400"> ×{lot.qtyRemaining}</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {lot.setName}
                    {lot.cardNumber && ` · ${lot.cardNumber}`}
                  </p>
                  {lot.category === "graded" && (
                    <div className="mt-1">
                      <CertEditor lotId={lot.lotId} certNumber={lot.certNumber} />
                    </div>
                  )}
                  <div className="mt-auto flex items-baseline justify-between gap-2 pt-2.5">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {formatGrading(lot, lot.category)}
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold tabular-nums">
                        {formatCents(lot.unitMarketCents)}
                        {lot.qtyRemaining > 1 && <span className="text-xs font-normal text-zinc-500"> ea</span>}
                      </span>
                      <span className={`block text-xs tabular-nums ${toneFor(gain)}`}>
                        {formatPercent(gain, { signed: true })} · cost {formatCents(lot.unitCostCents)}
                      </span>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
