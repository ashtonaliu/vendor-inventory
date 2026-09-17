export function StatCard({
  label,
  value,
  detail,
  valueClassName = "",
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${valueClassName}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>}
    </div>
  );
}
