import Link from "next/link";
import { withParam } from "@/lib/filters";

export function FilterPills({
  label,
  pathname,
  params,
  paramKey,
  options,
  current,
}: {
  label: string;
  pathname: string;
  params: Record<string, string | string[] | undefined>;
  paramKey: string;
  options: readonly { value: string; label: string }[];
  current: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
      {options.map((option) => {
        const active = option.value === current;
        return (
          <Link
            key={option.value}
            href={withParam(pathname, params, paramKey, option.value)}
            aria-current={active ? "true" : undefined}
            scroll={false}
            className={`rounded-md px-3 py-1 text-sm transition-colors ${
              active
                ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
