import { and, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { lots, priceSnapshots, syncRuns } from "@/db/schema";
import {
  CREDITS_PER_BULK_CALL,
  fetchCertValuesRaw,
  getApiKey,
  MAX_CERTS_PER_CALL,
  parseCertValues,
  RESPONSE_FORMAT_VERIFIED,
  type CertRequest,
} from "@/lib/cardladder";
import { CARD_LADDER_GRADERS, priceKeyFor } from "@/lib/domain";

const SOURCE = "cardladder";
const STALE_RUN_MS = 2 * 60 * 60 * 1000;
// Free tier allows 5 requests a minute.
const GAP_BETWEEN_CALLS_MS = 13_000;

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function heldSlabCerts() {
  return db
    .select({ lotId: lots.id, itemId: lots.itemId, grader: lots.grader, grade: lots.grade, certNumber: lots.certNumber })
    .from(lots)
    .where(
      and(
        isNotNull(lots.certNumber),
        inArray(lots.grader, [...CARD_LADDER_GRADERS]),
        gt(lots.qtyRemaining, 0),
      ),
    );
}

export async function syncGradedPrices({ log = console.log }: { log?: (message: string) => void } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Set PARSE_API_KEY in .env.local to sync Card Ladder values.");
  if (!RESPONSE_FORMAT_VERIFIED) {
    throw new Error("Card Ladder's response format hasn't been verified yet. Run `npm run cardladder:probe` first.");
  }

  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "Abandoned: never finished" })
    .where(and(eq(syncRuns.source, SOURCE), eq(syncRuns.status, "running"), lt(syncRuns.startedAt, new Date(Date.now() - STALE_RUN_MS))));

  let runId: number;
  try {
    [{ id: runId }] = await db.insert(syncRuns).values({ source: SOURCE, status: "running" }).returning({ id: syncRuns.id });
  } catch {
    throw new Error("A Card Ladder sync is already running.");
  }

  const asOf = localDate();
  const failures: string[] = [];
  let valued = 0;
  let snapshotsWritten = 0;
  let batches = 0;

  try {
    const slabs = await heldSlabCerts();
    const requests: CertRequest[] = [
      ...new Map(slabs.map((s) => [`${s.grader}:${s.certNumber}`, { certNumber: s.certNumber!, gradingCompany: s.grader! }])).values(),
    ];
    batches = Math.ceil(requests.length / MAX_CERTS_PER_CALL);
    log(`Valuing ${requests.length} slab certs in ${batches} call(s), about ${batches * CREDITS_PER_BULK_CALL} credits`);

    // Several slabs of the same card and grade share one price key, so their values are averaged.
    const totals = new Map<string, { itemId: number; priceKey: string; sum: number; count: number }>();

    for (let b = 0; b < batches; b++) {
      if (b > 0) await new Promise((resolve) => setTimeout(resolve, GAP_BETWEEN_CALLS_MS));
      const batch = requests.slice(b * MAX_CERTS_PER_CALL, (b + 1) * MAX_CERTS_PER_CALL);
      try {
        const parsed = parseCertValues(await fetchCertValuesRaw(batch, apiKey), batch);
        for (const [cert, message] of Object.entries(parsed.errors)) failures.push(`${cert}: ${message}`);

        for (const value of parsed.values) {
          for (const slab of slabs.filter((s) => s.certNumber === value.certNumber && s.grader === value.gradingCompany)) {
            const priceKey = priceKeyFor("single", { condition: null, grader: slab.grader, grade: slab.grade });
            const key = `${slab.itemId}:${priceKey}`;
            const entry = totals.get(key) ?? { itemId: slab.itemId, priceKey, sum: 0, count: 0 };
            entry.sum += value.valueCents;
            entry.count += 1;
            totals.set(key, entry);
          }
        }
        valued += parsed.values.length;
        const unmatched = batch.length - parsed.values.length - Object.keys(parsed.errors).length;
        if (unmatched > 0) failures.push(`${unmatched} cert(s) came back without a usable value`);
        log(`Call ${b + 1}/${batches}: ${parsed.values.length} of ${batch.length} certs valued`);
      } catch (err) {
        failures.push(`Call ${b + 1}: ${err instanceof Error ? err.message : String(err)}`);
        log(`Call ${b + 1}/${batches}: FAILED (${err instanceof Error ? err.message : err})`);
      }
    }

    const rows = [...totals.values()].map((t) => ({
      itemId: t.itemId,
      priceKey: t.priceKey,
      asOf,
      marketCents: Math.round(t.sum / t.count),
      source: SOURCE,
    }));
    if (rows.length > 0) {
      await db
        .insert(priceSnapshots)
        .values(rows)
        .onConflictDoUpdate({
          target: [priceSnapshots.itemId, priceSnapshots.priceKey, priceSnapshots.asOf],
          set: { marketCents: sql`excluded.market_cents`, source: sql`excluded.source` },
        });
    }
    snapshotsWritten = rows.length;

    const status = failures.length === 0 ? "succeeded" : valued > 0 ? "partial" : "failed";
    await db
      .update(syncRuns)
      .set({
        status,
        finishedAt: new Date(),
        dataAsOf: asOf,
        groupsTotal: batches,
        productsSeen: valued,
        snapshotsWritten,
        groupsFailed: failures.length,
        error: failures.length ? failures.join("\n").slice(0, 4000) : null,
      })
      .where(eq(syncRuns.id, runId));

    return { status, certs: requests.length, valued, snapshotsWritten, creditsUsed: batches * CREDITS_PER_BULK_CALL, failures };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: (err instanceof Error ? err.message : String(err)).slice(0, 4000) })
      .where(eq(syncRuns.id, runId));
    throw err;
  }
}
