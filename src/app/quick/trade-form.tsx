"use client";

import { useState, useTransition } from "react";
import {
  computeTrade,
  CONDITIONS,
  GRADE_OPTIONS,
  GRADERS,
  parseDollarsToCents,
  suggestMarketCents,
  type Condition,
  type Grading,
} from "@/lib/domain";
import { formatCents, formatGrading, formatSignedCents, toneFor } from "@/lib/format";
import type { CatalogResult, StockResult } from "@/lib/queries";
import { recordTradeAction } from "./actions";
import { CatalogPicker, StockPicker } from "./item-pickers";
import type { Where } from "./where-picker";

type GiveLine = { lot: StockResult; qty: number; marketOverride: string | null };
type GetLine = { key: number; item: CatalogResult; grading: Grading; qty: number; marketOverride: string | null };
type CashDirection = "none" | "in" | "out";

const smallInput =
  "h-9 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-950";

function marketOf(override: string | null, suggested: number | null) {
  return override != null ? parseDollarsToCents(override) : suggested;
}

export function TradeForm({
  where,
  multipliers,
  onRecorded,
}: {
  where: Where;
  multipliers: Record<Condition, number>;
  onRecorded: (receipt: { text: string; detail: string; tone: number }) => void;
}) {
  const [give, setGive] = useState<GiveLine[]>([]);
  const [get, setGet] = useState<GetLine[]>([]);
  const [adding, setAdding] = useState<"give" | "get" | null>("give");
  const [cashDirection, setCashDirection] = useState<CashDirection>("none");
  const [cash, setCash] = useState("");
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const giveMarkets = give.map((l) => marketOf(l.marketOverride, l.lot.unitMarketCents));
  const getSuggested = get.map((l) => suggestMarketCents(l.item.kind, l.item.prices, l.grading, multipliers));
  const getMarkets = get.map((l, i) => marketOf(l.marketOverride, getSuggested[i]));
  const cashCents = cashDirection === "none" ? 0 : cash.trim() === "" ? 0 : parseDollarsToCents(cash);

  const allPriced =
    give.length > 0 && get.length > 0 && cashCents != null && [...giveMarkets, ...getMarkets].every((m) => m != null && m > 0);

  const preview = allPriced
    ? computeTrade(
        give.map((l, i) => ({ qty: l.qty, unitMarketCents: giveMarkets[i]!, unitCostCents: l.lot.unitCostCents })),
        get.map((l, i) => ({ qty: l.qty, unitMarketCents: getMarkets[i]! })),
        cashDirection === "in" ? cashCents! : 0,
        cashDirection === "out" ? cashCents! : 0,
      )
    : null;

  function update<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number, patch: Partial<T>) {
    setter((lines) => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    setError(null);
  }

  function addGive(lot: StockResult) {
    setGive((lines) => {
      const existing = lines.findIndex((l) => l.lot.lotId === lot.lotId);
      if (existing === -1) return [...lines, { lot, qty: 1, marketOverride: null }];
      return lines.map((l, i) => (i === existing ? { ...l, qty: Math.min(l.lot.qtyRemaining, l.qty + 1) } : l));
    });
    setAdding(null);
    setError(null);
  }

  function addGet(item: CatalogResult) {
    const grading: Grading = item.kind === "sealed" ? { condition: null, grader: null, grade: null } : { condition: "NM", grader: null, grade: null };
    setGet((lines) => [...lines, { key: nextKey, item, grading, qty: 1, marketOverride: null }]);
    setNextKey((k) => k + 1);
    setAdding(null);
    setError(null);
  }

  function submit() {
    if (give.length === 0) return setError("Add at least one card you're giving.");
    if (get.length === 0) return setError("Add at least one card you're getting. For cash only, use Sell.");
    if (cashCents == null) return setError("Enter cash as a dollar amount.");
    if (![...giveMarkets, ...getMarkets].every((m) => m != null && m > 0)) return setError("Every card needs a market price above $0.");

    startTransition(async () => {
      const result = await recordTradeAction({
        give: give.map((l, i) => ({ lotId: l.lot.lotId, qty: l.qty, unitMarketCents: giveMarkets[i]! })),
        get: get.map((l, i) => ({ itemId: l.item.itemId, ...l.grading, qty: l.qty, unitMarketCents: getMarkets[i]! })),
        cashInCents: cashDirection === "in" ? cashCents : 0,
        cashOutCents: cashDirection === "out" ? cashCents : 0,
        ...where,
      });
      if (!result.ok) return setError(result.error);

      const count = (lines: { qty: number }[]) => lines.reduce((s, l) => s + l.qty, 0);
      const cards = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
      const cashText =
        cashDirection === "in" && cashCents > 0
          ? ` + ${formatCents(cashCents)} cash`
          : cashDirection === "out" && cashCents > 0
            ? `, paying ${formatCents(cashCents)}`
            : "";
      onRecorded({
        text: `Traded ${cards(count(give))} for ${cards(count(get))}${cashText}`,
        detail: `${formatSignedCents(result.profitCents)} profit on what you traded away`,
        tone: result.profitCents,
      });
      setGive([]);
      setGet([]);
      setCash("");
      setCashDirection("none");
      setAdding("give");
    });
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SideHeader title="You give" totalCents={sum(give.map((l, i) => (giveMarkets[i] ?? 0) * l.qty))} />
        {give.map((line, i) => (
          <LineCard
            key={line.lot.lotId}
            title={line.lot.name}
            subtitle={`${line.lot.setName}${line.lot.cardNumber ? ` · ${line.lot.cardNumber}` : ""} · ${formatGrading(line.lot, line.lot.category)} · paid ${formatCents(line.lot.unitCostCents)}`}
            qty={line.qty}
            maxQty={line.lot.qtyRemaining}
            onQty={(qty) => update(setGive, i, { qty })}
            market={line.marketOverride ?? centsToInput(line.lot.unitMarketCents)}
            onMarket={(v) => update(setGive, i, { marketOverride: v })}
            onRemove={() => setGive((lines) => lines.filter((_, j) => j !== i))}
          />
        ))}
        {adding === "give" ? (
          <PickerShell onClose={() => setAdding(null)}>
            <StockPicker onPick={addGive} />
          </PickerShell>
        ) : (
          <AddButton onClick={() => setAdding("give")}>Add from your inventory</AddButton>
        )}
      </section>

      <section className="space-y-2">
        <SideHeader title="You get" totalCents={sum(get.map((l, i) => (getMarkets[i] ?? 0) * l.qty))} />
        {get.map((line, i) => (
          <LineCard
            key={line.key}
            title={line.item.name}
            subtitle={`${line.item.setName}${line.item.cardNumber ? ` · ${line.item.cardNumber}` : line.item.kind === "sealed" ? " · Sealed" : ""}`}
            qty={line.qty}
            maxQty={10_000}
            onQty={(qty) => update(setGet, i, { qty })}
            market={line.marketOverride ?? centsToInput(getSuggested[i])}
            marketMissing={getSuggested[i] == null && line.marketOverride == null}
            onMarket={(v) => update(setGet, i, { marketOverride: v })}
            onRemove={() => setGet((lines) => lines.filter((_, j) => j !== i))}
          >
            {line.item.kind === "single" && (
              <GradingSelect value={line.grading} onChange={(grading) => update(setGet, i, { grading, marketOverride: null })} />
            )}
          </LineCard>
        ))}
        {adding === "get" ? (
          <PickerShell onClose={() => setAdding(null)}>
            <CatalogPicker onPick={addGet} />
          </PickerShell>
        ) : (
          <AddButton onClick={() => setAdding("get")}>Add a card or product</AddButton>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Cash</h2>
        <div role="radiogroup" aria-label="Cash" className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          {(
            [
              ["none", "No cash"],
              ["out", "I pay"],
              ["in", "They pay"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={cashDirection === value}
              onClick={() => {
                setCashDirection(value);
                setError(null);
              }}
              className={`h-9 rounded-md text-sm ${
                cashDirection === value ? "bg-white font-medium shadow-sm dark:bg-zinc-700" : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {cashDirection !== "none" && (
          <div className="flex h-11 items-center rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900">
            <span className="text-zinc-400">$</span>
            <input
              aria-label={cashDirection === "in" ? "Cash they pay you" : "Cash you pay them"}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="0"
              value={cash}
              onChange={(e) => {
                setCash(e.target.value);
                setError(null);
              }}
              className="w-full min-w-0 bg-transparent pl-1 text-base tabular-nums outline-none"
            />
          </div>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 text-sm dark:border-zinc-800 dark:bg-zinc-800">
        <div className="bg-white px-4 py-3 dark:bg-zinc-900">
          <dt className="text-zinc-500 dark:text-zinc-400">Value edge</dt>
          <dd className={`text-xl font-semibold tabular-nums ${toneFor(preview?.valueEdgeCents)}`}>
            {formatSignedCents(preview?.valueEdgeCents)}
          </dd>
        </div>
        <div className="bg-white px-4 py-3 dark:bg-zinc-900">
          <dt className="text-zinc-500 dark:text-zinc-400">Profit</dt>
          <dd className={`text-xl font-semibold tabular-nums ${toneFor(preview?.profitCents)}`}>{formatSignedCents(preview?.profitCents)}</dd>
        </div>
        <p className="col-span-2 bg-white px-4 pb-3 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          Value edge compares market value on both sides, including cash. Profit is against what you paid for the cards you trade away.
        </p>
      </dl>

      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="h-14 w-full rounded-xl bg-zinc-900 text-base font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Saving…" : "Record trade"}
      </button>
    </div>
  );
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

function centsToInput(cents: number | null) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function SideHeader({ title, totalCents }: { title: string; totalCents: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-sm font-medium">{title}</h2>
      <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">{formatCents(totalCents)} market</span>
    </div>
  );
}

function AddButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      <span aria-hidden>+</span> {children}
    </button>
  );
}

function PickerShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="space-y-2 rounded-xl bg-zinc-100 p-2 dark:bg-zinc-900/60">
      {children}
      <button type="button" onClick={onClose} className="h-9 w-full text-sm text-zinc-600 dark:text-zinc-300">
        Cancel
      </button>
    </div>
  );
}

function LineCard({
  title,
  subtitle,
  qty,
  maxQty,
  onQty,
  market,
  marketMissing = false,
  onMarket,
  onRemove,
  children,
}: {
  title: string;
  subtitle: string;
  qty: number;
  maxQty: number;
  onQty: (qty: number) => void;
  market: string;
  marketMissing?: boolean;
  onMarket: (value: string) => void;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{title}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          className="-m-1 shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          ✕
        </button>
      </div>
      {children}
      <div className="grid grid-cols-[auto_1fr] items-end gap-2">
        <div>
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Qty</span>
          <div className="flex h-9 items-center rounded-lg border border-zinc-300 dark:border-zinc-700">
            <button type="button" aria-label={`Fewer ${title}`} onClick={() => onQty(Math.max(1, qty - 1))} className="h-full w-9 text-zinc-600 dark:text-zinc-300">
              −
            </button>
            <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
            <button
              type="button"
              aria-label={`More ${title}`}
              onClick={() => onQty(Math.min(maxQty, qty + 1))}
              className="h-full w-9 text-zinc-600 dark:text-zinc-300"
            >
              +
            </button>
          </div>
        </div>
        <label className="block">
          <span className={`mb-1 block text-xs ${marketMissing ? "text-amber-700 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}>
            {marketMissing ? "Market price each (needed)" : "Market price each"}
          </span>
          <input inputMode="decimal" autoComplete="off" value={market} onChange={(e) => onMarket(e.target.value)} className={smallInput} />
        </label>
      </div>
    </div>
  );
}

function GradingSelect({ value, onChange }: { value: Grading; onChange: (grading: Grading) => void }) {
  return (
    <div className="flex gap-2">
      <select
        aria-label="Condition"
        value={value.grader ? "slab" : (value.condition ?? "NM")}
        onChange={(e) =>
          onChange(
            e.target.value === "slab"
              ? { condition: null, grader: "PSA", grade: "10" }
              : { condition: e.target.value as Condition, grader: null, grade: null },
          )
        }
        className={smallInput}
      >
        {CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value="slab">Graded slab</option>
      </select>
      {value.grader && (
        <>
          <select aria-label="Grading company" value={value.grader} onChange={(e) => onChange({ ...value, grader: e.target.value })} className={smallInput}>
            {GRADERS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select aria-label="Grade" value={value.grade ?? "10"} onChange={(e) => onChange({ ...value, grade: e.target.value })} className={smallInput}>
            {GRADE_OPTIONS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
