// Vercel serverless function. Returns every product with its real quantity
// (summed from the product's prices) in ONE response. Doing this server-side
// avoids the browser firing one /price request per product in parallel, which
// tripped GHL's rate limit (429) and starved the edit actions. Calls are
// concurrency-capped and the result is briefly cached.
import type { VercelRequest, VercelResponse } from "@vercel/node";

const GHL_BASE = "https://services.leadconnectorhq.com";

function ghlHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.VITE_GHL_API_KEY ?? ""}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length || 1) },
    async () => {
      while (idx < items.length) {
        const cur = idx++;
        results[cur] = await fn(items[cur]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

interface ProductLite {
  _id: string;
  name?: string;
  statementDescriptor?: string;
  availableInStore?: boolean;
  isFeatured?: boolean;
  medias?: unknown[];
}

let cache: { at: number; data: unknown } | null = null;
const TTL_MS = 30_000;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const loc = process.env.VITE_GHL_LOCATION_ID ?? "";
  if (!loc) {
    res.status(500).json({ error: "Server missing VITE_GHL_LOCATION_ID" });
    return;
  }

  if (cache && Date.now() - cache.at < TTL_MS) {
    res.status(200).json(cache.data);
    return;
  }

  try {
    const listRes = await fetch(
      `${GHL_BASE}/products/?locationId=${loc}&limit=100`,
      { headers: ghlHeaders() }
    );
    if (!listRes.ok) {
      throw new Error(`GHL products list failed: ${listRes.status}`);
    }
    const list = await listRes.json();
    const products: ProductLite[] = list.products ?? [];

    // Cap concurrency so we never burst GHL (which 429s).
    const withQty = await mapWithConcurrency(products, 4, async (p) => {
      let quantity = 0;
      try {
        const pr = await fetch(
          `${GHL_BASE}/products/${p._id}/price?locationId=${loc}`,
          { headers: ghlHeaders() }
        );
        if (pr.ok) {
          const pd = await pr.json();
          const prices: Array<{ availableQuantity?: number }> = pd.prices ?? [];
          quantity = prices.reduce((s, x) => s + (x.availableQuantity ?? 0), 0);
        }
      } catch {
        /* leave quantity 0 on a single failed price fetch */
      }
      return {
        _id: p._id,
        name: p.name,
        statementDescriptor: p.statementDescriptor,
        availableInStore: p.availableInStore,
        isFeatured: p.isFeatured,
        medias: p.medias ?? [],
        quantity,
      };
    });

    const payload = { products: withQty };
    cache = { at: Date.now(), data: payload };
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
