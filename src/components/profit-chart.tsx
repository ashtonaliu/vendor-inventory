import { formatSignedCents } from "@/lib/format";

const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short" });

export function ProfitChart({ months }: { months: { month: string; profitCents: number }[] }) {
  const maxGain = Math.max(0, ...months.map((m) => m.profitCents));
  const maxLoss = Math.max(0, ...months.map((m) => -m.profitCents));
  const span = maxGain + maxLoss || 1;
  const gainShare = (maxGain / span) * 100;

  if (months.every((m) => m.profitCents === 0)) {
    return (
      <div className="grid h-44 place-items-center text-sm text-zinc-500 dark:text-zinc-400">
        No sales in this range yet
      </div>
    );
  }

  return (
    <div className="flex h-44 items-stretch gap-2" role="img" aria-label="Realized profit by month">
      {months.map(({ month, profitCents }) => {
        const barHeight = (Math.abs(profitCents) / span) * 100;
        const label = monthLabel.format(new Date(`${month}-01T12:00:00`));
        return (
          <div key={month} className="flex min-w-0 flex-1 flex-col" title={`${label}: ${formatSignedCents(profitCents)}`}>
            <div className="relative flex-1">
              <div className="absolute inset-x-0 flex flex-col justify-end" style={{ top: 0, height: `${gainShare}%` }}>
                {profitCents > 0 && (
                  <div className="rounded-t bg-emerald-500/85 dark:bg-emerald-400/80" style={{ height: `${(barHeight / gainShare) * 100}%` }} />
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 flex flex-col" style={{ height: `${100 - gainShare}%` }}>
                {profitCents < 0 && (
                  <div className="rounded-b bg-rose-500/85 dark:bg-rose-400/80" style={{ height: `${(barHeight / (100 - gainShare)) * 100}%` }} />
                )}
              </div>
            </div>
            <span className="mt-2 truncate text-center text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
