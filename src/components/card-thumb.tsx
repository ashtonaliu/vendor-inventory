import type { Category } from "@/db/schema";

const placeholderTint: Record<Category, string> = {
  single: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  sealed: "bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  graded: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

export function CardThumb({
  name,
  setName,
  imageUrl,
  category,
}: {
  name: string;
  setName: string;
  imageUrl: string | null;
  category: Category;
}) {
  if (imageUrl) {
    return (
      // Card art comes from arbitrary external hosts once price sync fills it in.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt={name} loading="lazy" className="aspect-[63/88] w-full rounded-lg object-cover" />
    );
  }

  return (
    <div
      aria-hidden
      className={`flex aspect-[63/88] w-full flex-col justify-between rounded-lg p-3 ${placeholderTint[category]}`}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider opacity-70">{setName}</span>
      <span className="text-sm font-semibold leading-tight">{name}</span>
    </div>
  );
}
