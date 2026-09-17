import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { lots, transactionLines, transactions } from "@/db/schema";
import { computeTrade, type Channel, type Condition } from "@/lib/domain";

export class InsufficientStockError extends Error {
  constructor(lotId: number, qty: number) {
    super(`Lot ${lotId} doesn't have ${qty} left to sell`);
    this.name = "InsufficientStockError";
  }
}

export type BuyInput = {
  itemId: number;
  condition?: Condition | null;
  grader?: string | null;
  grade?: string | null;
  qty: number;
  unitPriceCents: number;
  unitMarketCents: number;
  feesCents?: number;
  occurredAt: Date;
  eventId?: number | null;
  channel: Channel;
  notes?: string;
};

export type SaleInput = {
  lotId: number;
  qty: number;
  unitPriceCents: number;
  unitMarketCents: number;
  feesCents?: number;
  occurredAt: Date;
  eventId?: number | null;
  channel: Channel;
  notes?: string;
};

// Buy-side fees (shipping, buyer's premium) are folded into the lot's cost
// basis so later profit numbers already account for them.
export async function recordBuy(input: BuyInput) {
  const fees = input.feesCents ?? 0;
  const unitCostCents = input.unitPriceCents + Math.round(fees / input.qty);

  return db.transaction(async (tx) => {
    const [lot] = await tx
      .insert(lots)
      .values({
        itemId: input.itemId,
        condition: input.condition ?? null,
        grader: input.grader ?? null,
        grade: input.grade ?? null,
        qtyAcquired: input.qty,
        qtyRemaining: input.qty,
        unitCostCents,
        acquiredAt: input.occurredAt,
        notes: input.notes,
      })
      .returning({ id: lots.id });

    const [txn] = await tx
      .insert(transactions)
      .values({
        type: "buy",
        occurredAt: input.occurredAt,
        eventId: input.eventId ?? null,
        channel: input.channel,
        cashOutCents: input.unitPriceCents * input.qty + fees,
        feesCents: fees,
      })
      .returning({ id: transactions.id });

    await tx.insert(transactionLines).values({
      transactionId: txn.id,
      lotId: lot.id,
      direction: "in",
      qty: input.qty,
      unitPriceCents: input.unitPriceCents,
      unitMarketCents: input.unitMarketCents,
    });

    return { lotId: lot.id, transactionId: txn.id };
  });
}

export async function recordSale(input: SaleInput) {
  return db.transaction(async (tx) => {
    // Conditional decrement: fails instead of going negative if two sales race.
    const updated = await tx
      .update(lots)
      .set({ qtyRemaining: sql`${lots.qtyRemaining} - ${input.qty}` })
      .where(and(eq(lots.id, input.lotId), gte(lots.qtyRemaining, input.qty)))
      .returning({ id: lots.id });

    if (updated.length === 0) {
      throw new InsufficientStockError(input.lotId, input.qty);
    }

    const [txn] = await tx
      .insert(transactions)
      .values({
        type: "sell",
        occurredAt: input.occurredAt,
        eventId: input.eventId ?? null,
        channel: input.channel,
        cashInCents: input.unitPriceCents * input.qty,
        feesCents: input.feesCents ?? 0,
        notes: input.notes,
      })
      .returning({ id: transactions.id });

    await tx.insert(transactionLines).values({
      transactionId: txn.id,
      lotId: input.lotId,
      direction: "out",
      qty: input.qty,
      unitPriceCents: input.unitPriceCents,
      unitMarketCents: input.unitMarketCents,
    });

    return { transactionId: txn.id };
  });
}

export type TradeInput = {
  give: { lotId: number; qty: number; unitMarketCents: number }[];
  get: {
    itemId: number;
    condition: Condition | null;
    grader: string | null;
    grade: string | null;
    qty: number;
    unitMarketCents: number;
  }[];
  cashInCents: number;
  cashOutCents: number;
  occurredAt: Date;
  eventId?: number | null;
  channel: Channel;
  notes?: string;
};

export async function recordTrade(input: TradeInput) {
  return db.transaction(async (tx) => {
    const costs: number[] = [];
    for (const line of input.give) {
      const [updated] = await tx
        .update(lots)
        .set({ qtyRemaining: sql`${lots.qtyRemaining} - ${line.qty}` })
        .where(and(eq(lots.id, line.lotId), gte(lots.qtyRemaining, line.qty)))
        .returning({ unitCostCents: lots.unitCostCents });
      if (!updated) throw new InsufficientStockError(line.lotId, line.qty);
      costs.push(updated.unitCostCents);
    }

    const trade = computeTrade(
      input.give.map((l, i) => ({ ...l, unitCostCents: costs[i] })),
      input.get,
      input.cashInCents,
      input.cashOutCents,
    );

    const [txn] = await tx
      .insert(transactions)
      .values({
        type: "trade",
        occurredAt: input.occurredAt,
        eventId: input.eventId ?? null,
        channel: input.channel,
        cashInCents: input.cashInCents,
        cashOutCents: input.cashOutCents,
        notes: input.notes,
      })
      .returning({ id: transactions.id });

    await tx.insert(transactionLines).values(
      input.give.map((line, i) => ({
        transactionId: txn.id,
        lotId: line.lotId,
        direction: "out" as const,
        qty: line.qty,
        unitPriceCents: Math.round(trade.lineProceedsCents[i] / line.qty),
        unitMarketCents: line.unitMarketCents,
      })),
    );

    for (const line of input.get) {
      const [lot] = await tx
        .insert(lots)
        .values({
          itemId: line.itemId,
          condition: line.condition,
          grader: line.grader,
          grade: line.grade,
          qtyAcquired: line.qty,
          qtyRemaining: line.qty,
          unitCostCents: line.unitMarketCents,
          acquiredAt: input.occurredAt,
        })
        .returning({ id: lots.id });

      await tx.insert(transactionLines).values({
        transactionId: txn.id,
        lotId: lot.id,
        direction: "in",
        qty: line.qty,
        unitPriceCents: line.unitMarketCents,
        unitMarketCents: line.unitMarketCents,
      });
    }

    return { transactionId: txn.id };
  });
}
