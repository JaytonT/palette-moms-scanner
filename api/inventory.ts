// Vercel serverless function. Returns every product with its real quantity in
// one response (server-side price fetches, concurrency-capped) so the browser
// never bursts GHL with per-product calls. Result is briefly cached.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getInventory } from "./_lib/ghl-server.js";

let cache: { at: number; data: unknown } | null = null;
const TTL_MS = 30_000;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (cache && Date.now() - cache.at < TTL_MS) {
    res.status(200).json(cache.data);
    return;
  }
  try {
    const products = await getInventory();
    const payload = { products };
    cache = { at: Date.now(), data: payload };
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
