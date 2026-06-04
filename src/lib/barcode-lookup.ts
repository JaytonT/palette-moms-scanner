import type { ProductData } from "@/types/product";

// Thin client. The actual enrichment pipeline (3 product APIs + n8n Claude
// judge + Google Images) runs server-side at /api/lookup, because those
// endpoints do not allow the browser origin via CORS. Calling them directly
// from the page silently failed and left every field blank. See
// src/lib/lookup-pipeline.ts (the shared logic) and api/lookup.ts (the handler).
export async function lookupBarcode(barcode: string): Promise<ProductData> {
  const res = await fetch(`/api/lookup?barcode=${encodeURIComponent(barcode)}`);
  if (!res.ok) {
    throw new Error(`Lookup failed: ${res.status}`);
  }
  return (await res.json()) as ProductData;
}
