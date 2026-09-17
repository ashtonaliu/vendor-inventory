import Link from "next/link";
import { FilterPills } from "@/components/filter-pills";
import { ProfitChart } from "@/components/profit-chart";
import { StatCard } from "@/components/stat-card";
import { CATEGORY_OPTIONS, parseCategory, parseRange, RANGE_OPTIONS } from "@/lib/filters";
import { formatCents, formatPercent, formatSignedCents, toneFor } from "@/lib/format";
import { getDashboard } from "@/lib/queries";

const categoryLabel = { single: "Singles", sealed: "Sealed", graded: "Graded" } as const;
const channelLabel = { show: "Card show", ebay: "eBay", tcgplayer: "TCGplayer", local: "Local", other: "Other" } as const;
const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const range = parseRange(params);
  const category = parseCategory(params);
  const data = await getDashboard(range, category);

  const { inventory, realized } = data;
  const netAfterFees = realized.tableFeesCents == null ? null : realized.profitCents - realized.tableFeesCents;
  const unrealizedPct = inventory.costCents > 0 ? inventory.unrealizedCents / inventory.costCents : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">How the business is doing</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterPills label="Date range" pathname="/" params={params} paramKey="range" options={RANGE_OPTIONS} current={range} />
          <FilterPills label="Category" pathname="/" params={params} paramKey="category" options={CATEGORY_OPTIONS} current={category} />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Inventory value"
          value={formatCents(inventory.marketValueCents)}
          detail={`${inventory.units} items · cost ${formatCents(inventory.costCents)}`}
        />
        <StatCard
          label="Unrealized profit"
          value={formatSignedCents(inventory.unrealizedCents)}
          valueClassName={toneFor(inventory.unrealizedCents)}
          detail={`${formatPercent(unrealizedPct, { signed: true })} on what's still in stock`}
        />
        <StatCard
          label="Realized profit"
          value={formatSignedCents(realized.profitCents)}
          valueClassName={toneFor(realized.profitCents)}
          detail={
            netAfterFees == null
              ? `${realized.units} sold · ${formatCents(realized.revenueCents)} revenue`
              : `${formatSignedCents(netAfterFees)} after ${formatCents(realized.tableFeesCents)} table fees`
          }
        />
        <StatCard
          label="Buy / sell vs market"
          value={`${formatPercent(data.buyPctOfMarket)} / ${formatPercent(data.sellPctOfMarket)}`}
          detail="Avg price paid and received as % of market"
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-medium">Realized profit by month</h2>
          <ProfitChart months={data.byMonth} />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-medium">Profit by category</h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {(["single", "sealed", "graded"] as const).map((key) => {
              const row = data.byCategory.find((r) => r.category === key);
              const profit = row?.profitCents ?? 0;
              return (
                <li key={key}>
                  <Link
                    href={`/?range=${range}&category=${key}`}
                    className={`flex items-center justify-between rounded-md px-2 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${
                      category === key ? "bg-zinc-50 dark:bg-zinc-800/60" : ""
                    }`}
                  >
                    <span>{categoryLabel[key]}</span>
                    <span className="text-right">
                      <span className={`font-medium tabular-nums ${toneFor(profit)}`}>{formatSignedCents(profit)}</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {formatCents(row?.revenueCents ?? 0)} revenue
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-medium dark:border-zinc-800">Recent sales</h2>
        {data.recentSales.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No sales in this range yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Where</th>
                  <th className="px-4 py-2 text-right font-medium">Sold for</th>
                  <th className="px-4 py-2 text-right font-medium">% of market</th>
                  <th className="px-4 py-2 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.recentSales.map((sale) => (
                  <tr key={sale.lineId}>
                    <td className="px-4 py-2.5">
                      {sale.name}
                      {sale.qty > 1 && <span className="text-zinc-500 dark:text-zinc-400"> ×{sale.qty}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{dateLabel.format(sale.occurredAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{channelLabel[sale.channel]}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(sale.revenueCents)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(sale.unitPriceCents / sale.unitMarketCents)}</td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${toneFor(sale.profitCents)}`}>
                      {formatSignedCents(sale.profitCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
