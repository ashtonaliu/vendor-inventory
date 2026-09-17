import { CARD_LADDER_GRADERS } from "@/lib/domain";

// Card Ladder values via Parse's third-party wrapper (not an official Card Ladder API).
// Free tier: 200 credits a month, 5 requests a minute. get_cert_values_bulk costs 3 credits
// and values up to 200 certs, so one call a day covers a typical slab inventory.

const BASE_URL = "https://api.parse.bot/scraper/97d5f4bc-6c65-4546-8f71-76149a5533cb";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
export const MAX_CERTS_PER_CALL = 200;
export const CREDITS_PER_BULK_CALL = 3;

// Checked against a real response on 2026-09-17: { status, data: { results: [...], errors: [], total } },
// with cl_value and last_sale_price in whole dollars (a PSA 10 valued at 5650 alongside eBay sales of
// $5,300 to $5,900). If Parse changes the format, set this back to false and re-run the probe.
export const RESPONSE_FORMAT_VERIFIED = true;
const VALUE_UNIT: "dollars" | "cents" = "dollars";

export type CertRequest = { certNumber: string; gradingCompany: string };
export type CertValue = CertRequest & { valueCents: number; source: "cl_value" | "last_sale_price" };

export function getApiKey(): string | null {
  const key = process.env.PARSE_API_KEY?.trim();
  return key ? key : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchCertValuesRaw(certs: CertRequest[], apiKey: string): Promise<unknown> {
  if (certs.length === 0 || certs.length > MAX_CERTS_PER_CALL) throw new Error(`Send 1 to ${MAX_CERTS_PER_CALL} certs per call`);

  const body = JSON.stringify({ certs: certs.map((c) => ({ cert_number: c.certNumber, grading_company: c.gradingCompany })) });
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/get_cert_values_bulk`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      lastError = new Error(`get_cert_values_bulk returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
      if (res.status === 401 || res.status === 403) break;
      if (res.status === 429) {
        await sleep(15_000);
        continue;
      }
      if (res.status < 500) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(2000 * attempt);
  }
  throw lastError;
}

function toCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(VALUE_UNIT === "dollars" ? value * 100 : value);
}

const asRecord = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const certKey = (cert: string, grader: string) => `${grader.toUpperCase()}:${cert.trim().toUpperCase()}`;

// Real responses look like { status: "success", data: { results: [...], errors: [...] } }. Older
// or alternate shapes (a bare array, or an object keyed by cert) are still accepted. Records are
// matched to requested certs by their own fields, falling back to the object key. Anything it
// can't match is left out rather than guessed.
export function parseCertValues(body: unknown, requested: CertRequest[]) {
  const outer = asRecord(body);
  if (typeof outer?.status === "string" && outer.status !== "success") {
    return { values: [] as CertValue[], errors: { response: `status ${outer.status}` } as Record<string, string>, recordsSeen: 0 };
  }
  const root = asRecord(outer?.data) ?? outer;
  const container = root?.results ?? (outer?.data !== undefined && !asRecord(outer.data) ? outer.data : null) ?? root ?? body;

  const entries: [string | null, Record<string, unknown>][] = Array.isArray(container)
    ? container.flatMap((r) => (asRecord(r) ? [[null, asRecord(r)!] as [null, Record<string, unknown>]] : []))
    : Object.entries(asRecord(container) ?? {}).flatMap(([k, v]) =>
        k !== "errors" && asRecord(v) ? [[k, asRecord(v)!] as [string, Record<string, unknown>]] : [],
      );

  const wanted = new Map(requested.map((c) => [certKey(c.certNumber, c.gradingCompany), c]));
  const values: CertValue[] = [];

  for (const [key, record] of entries) {
    const cert = typeof record.cert_number === "string" || typeof record.cert_number === "number" ? String(record.cert_number) : null;
    const grader = typeof record.grading_company === "string" ? record.grading_company : null;

    let match: CertRequest | undefined;
    if (cert && grader) match = wanted.get(certKey(cert, grader));
    if (!match && key) {
      const tokens = key.toUpperCase().split(/[^A-Z0-9]+/);
      const keyGrader = tokens.find((t) => (CARD_LADDER_GRADERS as readonly string[]).includes(t)) ?? grader?.toUpperCase();
      match = requested.find(
        (c) => tokens.includes(c.certNumber.toUpperCase()) && (!keyGrader || keyGrader === c.gradingCompany.toUpperCase()),
      );
    }
    if (!match) continue;

    const clValue = toCents(record.cl_value);
    const lastSale = toCents(record.last_sale_price);
    if (clValue != null) values.push({ ...match, valueCents: clValue, source: "cl_value" });
    else if (lastSale != null) values.push({ ...match, valueCents: lastSale, source: "last_sale_price" });
  }

  const describe = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 300);
  const errorsRaw = root?.errors;
  const errors: Record<string, string> = Array.isArray(errorsRaw)
    ? Object.fromEntries(
        errorsRaw.map((e, i) => {
          const r = asRecord(e);
          const id = r?.cert_number != null ? `${r.grading_company ?? "?"}:${r.cert_number}` : `error ${i + 1}`;
          return [id, describe(r?.error ?? r?.message ?? e)];
        }),
      )
    : Object.fromEntries(Object.entries(asRecord(errorsRaw) ?? {}).map(([k, v]) => [k, describe(v)]));

  return { values, errors, recordsSeen: entries.length };
}
