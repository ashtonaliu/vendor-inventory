"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { events, items, realizedSales } from "@/db/schema";
import { CHANNELS, CONDITIONS, GRADERS, ITEM_KINDS, isValidGrade, type Channel, type Condition } from "@/lib/domain";
import { InsufficientStockError, recordBuy, recordSale } from "@/lib/ledger";
import type { CatalogResult, EventOption } from "@/lib/queries";

// Server Functions are reachable by direct POST, so every input is re-validated here.
// Add an auth check to each of these before deploying anywhere public.

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_CENTS = 100_000_000;

const isCents = (v: unknown, { min = 0 } = {}): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= MAX_CENTS;
const isQty = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10_000;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

type Where = { eventId: number | null; channel: Channel };

async function resolveWhere(eventId: unknown, channel: unknown): Promise<Where | string> {
  if (eventId != null) {
    if (!isId(eventId)) return "That show doesn't exist.";
    const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId));
    if (!event) return "That show doesn't exist.";
    return { eventId, channel: "show" };
  }
  if (!CHANNELS.includes(channel as Channel)) return "Pick where this happened.";
  return { eventId: null, channel: channel as Channel };
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

export type SaleRequest = {
  lotId: number;
  qty: number;
  unitPriceCents: number;
  unitMarketCents: number;
  feesCents: number;
  eventId: number | null;
  channel: Channel;
};

export async function recordSaleAction(input: SaleRequest): Promise<Result<{ transactionId: number; profitCents: number }>> {
  if (!isId(input?.lotId)) return { ok: false, error: "Pick an item to sell." };
  if (!isQty(input.qty)) return { ok: false, error: "Enter a quantity of at least 1." };
  if (!isCents(input.unitPriceCents)) return { ok: false, error: "Enter a sale price." };
  if (!isCents(input.unitMarketCents, { min: 1 })) return { ok: false, error: "Enter a market price above $0." };
  if (!isCents(input.feesCents)) return { ok: false, error: "Fees can't be negative." };

  const where = await resolveWhere(input.eventId, input.channel);
  if (typeof where === "string") return { ok: false, error: where };

  try {
    const { transactionId } = await recordSale({
      lotId: input.lotId,
      qty: input.qty,
      unitPriceCents: input.unitPriceCents,
      unitMarketCents: input.unitMarketCents,
      feesCents: input.feesCents,
      occurredAt: new Date(),
      ...where,
    });

    const [row] = await db
      .select({ profitCents: sql<number>`sum(${realizedSales.profitCents})`.mapWith(Number) })
      .from(realizedSales)
      .where(eq(realizedSales.transactionId, transactionId));

    revalidateAll();
    return { ok: true, transactionId, profitCents: row.profitCents };
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return { ok: false, error: "Not enough left in stock. It may have just sold." };
    }
    console.error("recordSaleAction failed", err);
    return { ok: false, error: "Couldn't save the sale. Try again." };
  }
}

export type BuyRequest = {
  itemId: number;
  condition: Condition | null;
  grader: string | null;
  grade: string | null;
  qty: number;
  unitPriceCents: number;
  unitMarketCents: number;
  feesCents: number;
  eventId: number | null;
  channel: Channel;
};

export async function recordBuyAction(input: BuyRequest): Promise<Result<{ transactionId: number; lotId: number }>> {
  if (!isId(input?.itemId)) return { ok: false, error: "Pick an item to buy." };
  if (!isQty(input.qty)) return { ok: false, error: "Enter a quantity of at least 1." };
  if (!isCents(input.unitPriceCents)) return { ok: false, error: "Enter what you paid." };
  if (!isCents(input.unitMarketCents, { min: 1 })) return { ok: false, error: "Enter a market price above $0." };
  if (!isCents(input.feesCents)) return { ok: false, error: "Fees can't be negative." };

  const [item] = await db.select({ kind: items.kind }).from(items).where(eq(items.id, input.itemId));
  if (!item) return { ok: false, error: "That item doesn't exist." };

  let grading: { condition: Condition | null; grader: string | null; grade: string | null };
  if (item.kind === "sealed") {
    grading = { condition: null, grader: null, grade: null };
  } else if (input.grader != null) {
    const grade = Number(input.grade);
    if (!GRADERS.includes(input.grader as (typeof GRADERS)[number])) return { ok: false, error: "Pick a grading company." };
    if (!isValidGrade(grade)) return { ok: false, error: "Grades go from 1 to 10 in half steps." };
    grading = { condition: null, grader: input.grader, grade: String(grade) };
  } else {
    if (!CONDITIONS.includes(input.condition as Condition)) return { ok: false, error: "Pick a condition." };
    grading = { condition: input.condition, grader: null, grade: null };
  }

  const where = await resolveWhere(input.eventId, input.channel);
  if (typeof where === "string") return { ok: false, error: where };

  try {
    const result = await recordBuy({
      itemId: input.itemId,
      ...grading,
      qty: input.qty,
      unitPriceCents: input.unitPriceCents,
      unitMarketCents: input.unitMarketCents,
      feesCents: input.feesCents,
      occurredAt: new Date(),
      ...where,
    });
    revalidateAll();
    return { ok: true, ...result };
  } catch (err) {
    console.error("recordBuyAction failed", err);
    return { ok: false, error: "Couldn't save the purchase. Try again." };
  }
}

export type NewItemRequest = { kind: string; name: string; setName: string; cardNumber: string };

export async function createItemAction(input: NewItemRequest): Promise<Result<{ item: CatalogResult }>> {
  if (!ITEM_KINDS.includes(input?.kind as (typeof ITEM_KINDS)[number])) return { ok: false, error: "Pick single or sealed." };
  if (!isText(input.name, 120)) return { ok: false, error: "Enter a name." };
  if (!isText(input.setName, 120)) return { ok: false, error: "Enter a set." };
  const cardNumber = typeof input.cardNumber === "string" ? input.cardNumber.trim().slice(0, 20) : "";

  const [item] = await db
    .insert(items)
    .values({
      kind: input.kind as (typeof ITEM_KINDS)[number],
      name: input.name.trim(),
      setName: input.setName.trim(),
      cardNumber: input.kind === "single" && cardNumber ? cardNumber : null,
    })
    .returning({ itemId: items.id, kind: items.kind, name: items.name, setName: items.setName, cardNumber: items.cardNumber });

  return { ok: true, item: { ...item, prices: {} } };
}

export type NewEventRequest = { name: string; startsOn: string; tableFeeCents: number };

export async function createEventAction(input: NewEventRequest): Promise<Result<{ event: EventOption }>> {
  if (!isText(input?.name, 120)) return { ok: false, error: "Enter the show's name." };
  if (typeof input.startsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || Number.isNaN(Date.parse(input.startsOn))) {
    return { ok: false, error: "Enter the show's date." };
  }
  if (!isCents(input.tableFeeCents)) return { ok: false, error: "Enter a table fee of $0 or more." };

  const [event] = await db
    .insert(events)
    .values({ name: input.name.trim(), startsOn: input.startsOn, tableFeeCents: input.tableFeeCents })
    .returning({ id: events.id, name: events.name, startsOn: events.startsOn });

  revalidateAll();
  return { ok: true, event };
}
