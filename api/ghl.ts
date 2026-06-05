// Vercel serverless function: all GHL product WRITES (and the duplicate lookup)
// run here so the GHL token stays in process.env and never ships to the browser
// bundle. JSON action router. Image bytes go through /api/media instead.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createProductWithPrice,
  findByBarcode,
  restock,
  setFeatured,
  setActive,
} from "./_lib/ghl-server.js";
import { requireSession } from "./_lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  if (!requireSession(req, res)) return;
  const body =
    (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};
  const action = (body as { action?: string }).action;

  try {
    switch (action) {
      case "create": {
        const id = await createProductWithPrice(
          (body as { product: Parameters<typeof createProductWithPrice>[0] }).product,
          (body as { availableInStore?: boolean }).availableInStore ?? true
        );
        res.status(200).json({ productId: id });
        return;
      }
      case "find": {
        const found = await findByBarcode((body as { barcode: string }).barcode);
        res.status(200).json(found);
        return;
      }
      case "restock": {
        const b = body as { barcode: string; addQuantity: number };
        const r = await restock(b.barcode, b.addQuantity);
        res.status(200).json(r);
        return;
      }
      case "feature": {
        const b = body as { productId: string; isFeatured: boolean };
        await setFeatured(b.productId, b.isFeatured);
        res.status(200).json({ ok: true });
        return;
      }
      case "activate": {
        await setActive((body as { productId: string }).productId);
        res.status(200).json({ ok: true });
        return;
      }
      default:
        res.status(400).json({ error: "Unknown action: " + String(action) });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
