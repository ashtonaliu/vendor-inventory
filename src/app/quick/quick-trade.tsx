"use client";

import { useState, useTransition } from "react";
import {
  CONDITIONS,
  GRADERS,
  parseDollarsToCents,
  priceKeyFor,
  type Condition,
  type Grading,
} from "@/lib/domain";
import { formatCents, formatGrading, formatPercent, formatSignedCents, toneFor } from "@/lib/format";
import type { CatalogResult, EventOption, StockResult } from "@/lib/queries";
import { recordBuyAction, recordSaleAction } from "./actions";
import { CatalogPicker, StockPicker } from "./item-pickers";
import { WherePicker, type Where } from "./where-picker";

type Mode = "sell" | "buy";
type Receipt = { mode: Mode; text: string; detail: string; tone: number };

const GRADES = ["10", "9.5", "9", "8.5", "8", "7", "6", "5", "4", "3", "2", "1"];

export function QuickTrade({
  initialEvents,
  defaultWhere,
  today,
  multipliers,
}: {
  initialEvents: EventOption[];
  defaultWhere: Where;
  today: string;
  multipliers: Record<Condition, number>;
}) {
  const [mode, setMode] = useState<Mode>("sell");
  const [events, setEvents] = useState(initialEvents);
  const [where, setWhere] = useState<Where>(defaultWhere);

  const [lot, setLot] = useState<StockResult | null>(null);
  const [item, setItem] = useState<CatalogResult | null>(null);
  const [grading, setGrading] = useState<Grading>({ condition: "NM", grader: null, grade: null });

  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [fees, setFees] = useState("");
  const [marketOverride, setMarketOverride] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = mode === "sell" ? lot : item;

  let suggestedMarketCents: number | null = null;
  if (mode === "sell" && lot) {
    suggestedMarketCents = lot.unitMarketCents;
  } else if (mode === "buy" && item) {
    const base = item.prices[priceKeyFor(item.kind, grading)];
    if (base != null) {
      const multiplier = item.kind === "single" && !grading.grader && grading.condition ? multipliers[grading.condition] : 1;
      suggestedMarketCents = Math.round(base * multiplier);
    }
  }

  const priceCents = parseDollarsToCents(price);
  const feesCents = fees.trim() === "" ? 0 : parseDollarsToCents(fees);
  const marketCents = marketOverride != null ? parseDollarsToCents(marketOverride) : suggestedMarketCents;
  const maxQty = mode === "sell" && lot ? lot.qtyRemaining : 10_000;

  const pctOfMarket = priceCents != null && marketCents ? priceCents / marketCents : null;
  const outcomeCents =
    priceCents == null || feesCents == null
      ? null
      : mode === "sell"
        ? lot && (priceCents - lot.unitCostCents) * qty - feesCents
        : marketCents != null
          ? (marketCents - priceCents) * qty - feesCents
          : null;

  function clearDeal() {
    setLot(null);
    setItem(null);
    setGrading({ condition: "NM", grader: null, grade: null });
    setPrice("");
    setQty(1);
    setFees("");
    setMarketOverride(null);
    setError(null);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    clearDeal();
    setReceipt(null);
    setMode(next);
  }

  function changeGrading(next: Grading) {
    setGrading(next);
    setMarketOverride(null);
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return setError(mode === "sell" ? "Pick an item to sell." : "Pick an item to buy.");
    if (priceCents == null) return setError(mode === "sell" ? "Enter the sale price." : "Enter what you paid.");
    if (feesCents == null) return setError("Enter fees as a dollar amount, or leave them blank.");
    if (marketCents == null || marketCents <= 0) return setError("Enter a market price above $0.");
    if (qty < 1 || qty > maxQty) return setError(`Quantity must be between 1 and ${maxQty}.`);

    setError(null);
    startTransition(async () => {
      if (mode === "sell" && lot) {
        const result = await recordSaleAction({
          lotId: lot.lotId,
          qty,
          unitPriceCents: priceCents,
          unitMarketCents: marketCents,
          feesCents,
          ...where,
        });
        if (!result.ok) return setError(result.error);
        setReceipt({
          mode,
          text: `Sold ${lot.name}${qty > 1 ? ` ×${qty}` : ""} for ${formatCents(priceCents * qty)}`,
          detail: `${formatSignedCents(result.profitCents)} profit`,
          tone: result.profitCents,
        });
      } else if (mode === "buy" && item) {
        const result = await recordBuyAction({
          itemId: item.itemId,
          ...grading,
          qty,
          unitPriceCents: priceCents,
          unitMarketCents: marketCents,
          feesCents,
          ...where,
        });
        if (!result.ok) return setError(result.error);
        const equity = (marketCents - priceCents) * qty - feesCents;
        setReceipt({
          mode,
          text: `Bought ${item.name}${qty > 1 ? ` ×${qty}` : ""} for ${formatCents(priceCents * qty + feesCents)}`,
          detail: `${formatSignedCents(equity)} vs market`,
          tone: equity,
        });
      }
      clearDeal();
    });
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div role="tablist" aria-label="Transaction type" className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
        {(["sell", "buy"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={`h-11 rounded-lg text-base font-medium transition-colors ${
              mode === m
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            }`}
          >
            {m === "sell" ? "Sell" : "Buy"}
          </button>
        ))}
      </div>

      <WherePicker
        events={events}
        value={where}
        today={today}
        onChange={setWhere}
        onEventCreated={(event) => setEvents((prev) => [event, ...prev])}
      />

      {receipt && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/50"
        >
          <div>
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">{receipt.text}</p>
            <p className={`text-sm font-semibold tabular-nums ${toneFor(receipt.tone)}`}>{receipt.detail}</p>
          </div>
          <button
            type="button"
            onClick={() => setReceipt(null)}
            aria-label="Dismiss"
            className="-m-1 rounded p-1 text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900"
          >
            ✕
          </button>
        </div>
      )}

      {!selected ? (
        mode === "sell" ? (
          <StockPicker
            onPick={(picked) => {
              setLot(picked);
              setReceipt(null);
            }}
          />
        ) : (
          <CatalogPicker
            onPick={(picked) => {
              setItem(picked);
              setReceipt(null);
            }}
          />
        )
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{selected.name}</p>
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                {selected.setName}
                {selected.cardNumber && ` · ${selected.cardNumber}`}
                {lot && ` · ${formatGrading(lot, lot.category)}`}
              </p>
              {lot && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  You paid {formatCents(lot.unitCostCents, { exact: true })}
                  {lot.qtyRemaining > 1 && ` each · ${lot.qtyRemaining} in stock`}
                </p>
              )}
            </div>
            <button type="button" onClick={clearDeal} className="shrink-0 text-sm text-zinc-600 underline underline-offset-2 dark:text-zinc-300">
              Change
            </button>
          </div>

          {mode === "buy" && item?.kind === "single" && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Condition</legend>
              <div className="grid grid-cols-6 gap-1">
                {CONDITIONS.map((c) => {
                  const active = !grading.grader && grading.condition === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={active}
                      onClick={() => changeGrading({ condition: c, grader: null, grade: null })}
                      className={chipClass(active)}
                    >
                      {c}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={!!grading.grader}
                  onClick={() => changeGrading({ condition: null, grader: "PSA", grade: "10" })}
                  className={chipClass(!!grading.grader)}
                >
                  Slab
                </button>
              </div>
              {grading.grader && (
                <div className="flex gap-2">
                  <select
                    aria-label="Grading company"
                    value={grading.grader}
                    onChange={(e) => changeGrading({ ...grading, grader: e.target.value })}
                    className="h-11 flex-1 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {GRADERS.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Grade"
                    value={grading.grade ?? "10"}
                    onChange={(e) => changeGrading({ ...grading, grade: e.target.value })}
                    className="h-11 flex-1 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {GRADES.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </div>
              )}
            </fieldset>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <label htmlFor="price" className="mb-1 block text-sm text-zinc-500 dark:text-zinc-400">
                {mode === "sell" ? "Sale price" : "Price paid"} {qty > 1 && "each"}
              </label>
              <div className="flex h-14 items-center rounded-xl border border-zinc-300 bg-white px-4 focus-within:border-zinc-900 focus-within:ring-2 focus-within:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-zinc-300">
                <span className="text-2xl text-zinc-400">$</span>
                <input
                  id="price"
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                  placeholder="0"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setError(null);
                  }}
                  className="w-full min-w-0 bg-transparent pl-1 text-2xl font-semibold tabular-nums outline-none"
                />
              </div>
            </div>
            <div>
              <span id="qty-label" className="mb-1 block text-sm text-zinc-500 dark:text-zinc-400">
                Qty
              </span>
              <div role="group" aria-labelledby="qty-label" className="flex h-14 items-center rounded-xl border border-zinc-300 dark:border-zinc-700">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="h-full w-11 text-xl text-zinc-600 dark:text-zinc-300"
                >
                  −
                </button>
                <span aria-live="polite" className="w-8 text-center text-lg font-semibold tabular-nums">
                  {qty}
                </span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  className="h-full w-11 text-xl text-zinc-600 dark:text-zinc-300"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SmallMoneyField
              id="market"
              label={suggestedMarketCents == null ? "Market price (needed)" : "Market price each"}
              value={marketOverride ?? (suggestedMarketCents == null ? "" : (suggestedMarketCents / 100).toFixed(2))}
              onChange={(v) => {
                setMarketOverride(v);
                setError(null);
              }}
            />
            <SmallMoneyField
              id="fees"
              label={mode === "sell" ? "Fees (optional)" : "Shipping / fees"}
              value={fees}
              placeholder="0"
              onChange={(v) => {
                setFees(v);
                setError(null);
              }}
            />
          </div>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 text-sm dark:border-zinc-800 dark:bg-zinc-800">
            <div className="bg-white px-4 py-3 dark:bg-zinc-900">
              <dt className="text-zinc-500 dark:text-zinc-400">% of market</dt>
              <dd className="text-xl font-semibold tabular-nums">{formatPercent(pctOfMarket)}</dd>
            </div>
            <div className="bg-white px-4 py-3 dark:bg-zinc-900">
              <dt className="text-zinc-500 dark:text-zinc-400">{mode === "sell" ? "Profit" : "Under market"}</dt>
              <dd className={`text-xl font-semibold tabular-nums ${toneFor(outcomeCents)}`}>{formatSignedCents(outcomeCents)}</dd>
            </div>
          </dl>

          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="h-14 w-full rounded-xl bg-zinc-900 text-base font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending
              ? "Saving…"
              : mode === "sell"
                ? `Record sale${priceCents != null ? ` · ${formatCents(priceCents * qty)}` : ""}`
                : `Record purchase${priceCents != null ? ` · ${formatCents(priceCents * qty + (feesCents ?? 0))}` : ""}`}
          </button>
        </form>
      )}
    </div>
  );
}

function chipClass(active: boolean) {
  return `h-10 rounded-lg border text-sm font-medium transition-colors ${
    active
      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
      : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
  }`;
}

function SmallMoneyField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-zinc-500 dark:text-zinc-400">
        {label}
      </label>
      <div className="flex h-11 items-center rounded-lg border border-zinc-300 bg-white px-3 focus-within:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-zinc-300">
        <span className="text-zinc-400">$</span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent pl-1 tabular-nums outline-none"
        />
      </div>
    </div>
  );
}
