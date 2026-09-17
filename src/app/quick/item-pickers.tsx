"use client";

import { useState, useTransition } from "react";
import { formatCents, formatGrading } from "@/lib/format";
import type { CatalogResult, StockResult } from "@/lib/queries";
import { createItemAction } from "./actions";
import { useSearch } from "./use-search";

const inputClass =
  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300 dark:focus:ring-white/10";

const resultClass =
  "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800/60";

function ResultList({ children, status }: { children: React.ReactNode; status?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {status && <p className="px-3 py-3 text-sm text-zinc-500 dark:text-zinc-400">{status}</p>}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</ul>
    </div>
  );
}

export function StockPicker({ onPick }: { onPick: (lot: StockResult) => void }) {
  const [query, setQuery] = useState("");
  const { results, loading, failed } = useSearch<StockResult>("/api/stock", query);

  const status = failed
    ? "Search isn't working right now. Check your connection."
    : !loading && results.length === 0
      ? query.trim()
        ? `Nothing in stock matches “${query.trim()}”`
        : "Your inventory is empty"
      : null;

  return (
    <div className="space-y-2">
      <label htmlFor="stock-search" className="sr-only">
        Search your inventory
      </label>
      <input
        id="stock-search"
        type="search"
        autoFocus
        autoComplete="off"
        placeholder="Search your inventory"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={inputClass}
      />
      <ResultList status={status}>
        {results.map((lot) => (
          <li key={lot.lotId}>
            <button type="button" onClick={() => onPick(lot)} className={resultClass}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{lot.name}</span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {lot.setName}
                  {lot.cardNumber && ` · ${lot.cardNumber}`} · {formatGrading(lot, lot.category)}
                  {lot.qtyRemaining > 1 && ` · ${lot.qtyRemaining} left`}
                </span>
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">{formatCents(lot.unitMarketCents)}</span>
            </button>
          </li>
        ))}
      </ResultList>
    </div>
  );
}

export function CatalogPicker({ onPick }: { onPick: (item: CatalogResult) => void }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const { results, loading, failed } = useSearch<CatalogResult>("/api/catalog", query, { enabled: query.trim() !== "" });
  const trimmed = query.trim();

  if (creating) {
    return <NewItemForm initialName={trimmed} onCancel={() => setCreating(false)} onCreated={onPick} />;
  }

  const status = failed
    ? "Search isn't working right now. Check your connection."
    : !trimmed
      ? "Type a card or product name"
      : !loading && results.length === 0
        ? `No catalog match for “${trimmed}”`
        : null;

  return (
    <div className="space-y-2">
      <label htmlFor="catalog-search" className="sr-only">
        Search the catalog
      </label>
      <input
        id="catalog-search"
        type="search"
        autoFocus
        autoComplete="off"
        placeholder="What are you buying?"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={inputClass}
      />
      <ResultList status={status}>
        {results.map((item) => (
          <li key={item.itemId}>
            <button type="button" onClick={() => onPick(item)} className={resultClass}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {item.setName}
                  {item.cardNumber ? ` · ${item.cardNumber}` : item.kind === "sealed" ? " · Sealed" : ""}
                </span>
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">
                {formatCents(item.prices[item.kind === "sealed" ? "SEALED" : "NM"])}
              </span>
            </button>
          </li>
        ))}
        {trimmed && (
          <li>
            <button type="button" onClick={() => setCreating(true)} className={`${resultClass} text-sm`}>
              <span>
                Add <span className="font-medium">“{trimmed}”</span> as a new item
              </span>
              <span aria-hidden>+</span>
            </button>
          </li>
        )}
      </ResultList>
    </div>
  );
}

function NewItemForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (item: CatalogResult) => void;
}) {
  const [kind, setKind] = useState<"single" | "sealed">("single");
  const [name, setName] = useState(initialName);
  const [setTitle, setSetTitle] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a name.");
    if (!setTitle.trim()) return setError("Enter a set.");
    startTransition(async () => {
      const result = await createItemAction({ kind, name, setName: setTitle, cardNumber });
      if (result.ok) onCreated(result.item);
      else setError(result.error);
    });
  }

  const field = "h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium">New item</p>
      <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {(["single", "sealed"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`h-9 rounded-md text-sm ${kind === k ? "bg-white font-medium shadow-sm dark:bg-zinc-600" : "text-zinc-600 dark:text-zinc-300"}`}
          >
            {k === "single" ? "Single card" : "Sealed product"}
          </button>
        ))}
      </div>
      <input aria-label="Name" placeholder="Umbreon VMAX" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} className={field} />
      <input aria-label="Set" placeholder="Evolving Skies" value={setTitle} onChange={(e) => { setSetTitle(e.target.value); setError(null); }} className={field} />
      {kind === "single" && (
        <input aria-label="Card number" placeholder="Card number, like 215/203" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} className={field} />
      )}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
          Back to search
        </button>
        <button
          type="submit"
          disabled={pending}
          className="h-11 flex-1 rounded-lg bg-zinc-900 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Adding…" : "Add item"}
        </button>
      </div>
    </form>
  );
}
