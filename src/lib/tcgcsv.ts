// Client for tcgcsv.com, a free daily mirror of TCGplayer's catalog and prices.
// Data refreshes once a day around 20:00 UTC, so there's no reason to call it more often.

const BASE_URL = "https://tcgcsv.com";
export const POKEMON_CATEGORY_ID = 3;

const USER_AGENT = "Binder/0.1 (personal inventory tracker)";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

export type TcgGroup = { groupId: number; name: string; abbreviation: string | null };

export type TcgProduct = {
  productId: number;
  name: string;
  imageUrl: string | null;
  number: string | null;
  rarity: string | null;
};

export type TcgPrice = { productId: number; subTypeName: string; marketPrice: number | null };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return res;
      lastError = new Error(`GET ${path} returned ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
  }
  throw lastError;
}

async function getResults(path: string): Promise<unknown[]> {
  const body: unknown = await (await request(path)).json();
  if (!body || typeof body !== "object" || !Array.isArray((body as { results?: unknown }).results)) {
    throw new Error(`GET ${path} returned an unexpected shape`);
  }
  return (body as { results: unknown[] }).results;
}

const asRecord = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
const asPositiveInt = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
const asText = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export async function getLastUpdated(): Promise<Date> {
  const text = (await (await request("/last-updated.txt")).text()).trim();
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`Unexpected last-updated value: ${text.slice(0, 40)}`);
  return date;
}

export async function getGroups(): Promise<TcgGroup[]> {
  return (await getResults(`/tcgplayer/${POKEMON_CATEGORY_ID}/groups`)).flatMap((raw) => {
    const r = asRecord(raw);
    const groupId = asPositiveInt(r?.groupId);
    const name = asText(r?.name);
    return groupId && name ? [{ groupId, name, abbreviation: asText(r?.abbreviation) }] : [];
  });
}

export async function getProducts(groupId: number): Promise<TcgProduct[]> {
  return (await getResults(`/tcgplayer/${POKEMON_CATEGORY_ID}/${groupId}/products`)).flatMap((raw) => {
    const r = asRecord(raw);
    const productId = asPositiveInt(r?.productId);
    const name = asText(r?.name);
    if (!productId || !name) return [];

    const extended = Array.isArray(r?.extendedData) ? r.extendedData.map(asRecord) : [];
    const field = (key: string) => asText(extended.find((e) => e?.name === key)?.value);
    const image = asText(r?.imageUrl);

    return [
      {
        productId,
        name,
        // The default thumbnail is 200px wide; the CDN also serves a sharper 400px version.
        imageUrl: image?.startsWith("https://") ? image.replace(/_200w\.jpg$/, "_400w.jpg") : null,
        number: field("Number"),
        rarity: field("Rarity"),
      },
    ];
  });
}

export async function getPrices(groupId: number): Promise<TcgPrice[]> {
  return (await getResults(`/tcgplayer/${POKEMON_CATEGORY_ID}/${groupId}/prices`)).flatMap((raw) => {
    const r = asRecord(raw);
    const productId = asPositiveInt(r?.productId);
    const subTypeName = asText(r?.subTypeName);
    if (!productId || !subTypeName) return [];
    const market = r?.marketPrice;
    const marketPrice = typeof market === "number" && Number.isFinite(market) && market > 0 ? market : null;
    return [{ productId, subTypeName, marketPrice }];
  });
}
