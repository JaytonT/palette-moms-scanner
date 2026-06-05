import type { ProductData } from "@/types/product";
import { fileToDownscaledBase64 } from "@/lib/identify-product";

// Thin client. ALL GHL writes run server-side (api/ghl.ts, api/media.ts) so the
// GHL token lives only in the function runtime and never ships in the browser
// bundle. This module just calls those endpoints.

// Prompt for the staff passphrase and exchange it for a session cookie. Returns
// true if a session was established. The passphrase never persists in the bundle
// or storage; the HttpOnly cookie set by /api/login carries the session.
async function login(): Promise<boolean> {
  const passphrase = window.prompt("Enter the staff passphrase to continue:");
  if (passphrase == null) return false;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });
  return res.ok;
}

// POST JSON; on a 401 (auth enforced, no session), prompt for the passphrase and
// retry once. Server endpoints are no-ops on auth when unconfigured, so this path
// only triggers once the env vars are set.
async function apiPost(url: string, body: unknown): Promise<Response> {
  const opts: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  let res = await fetch(url, opts);
  if (res.status === 401 && (await login())) {
    res = await fetch(url, opts);
  }
  return res;
}

async function ghlAction<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await apiPost("/api/ghl", { action, ...payload });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `GHL ${action} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export interface FindProductResult {
  found: true;
  productId: string;
  name: string;
  currentQuantity: number;
}

export async function findProductByBarcode(
  barcode: string
): Promise<FindProductResult | null> {
  const r = await ghlAction<
    { productId: string; name: string; currentQuantity: number } | null
  >("find", { barcode });
  if (!r) return null;
  return {
    found: true,
    productId: r.productId,
    name: r.name,
    currentQuantity: r.currentQuantity,
  };
}

export async function createProduct(
  data: ProductData,
  availableInStore = true
): Promise<string> {
  const r = await ghlAction<{ productId: string }>("create", {
    product: data,
    availableInStore,
  });
  return r.productId;
}

/** Add stock to an existing product (matched by barcode). Returns the new total. */
export async function restockProduct(
  barcode: string,
  addQuantity: number
): Promise<number> {
  const r = await ghlAction<{ productId: string; newQuantity: number } | null>(
    "restock",
    { barcode, addQuantity }
  );
  if (!r) throw new Error("Product not found to restock");
  return r.newQuantity;
}

export async function setProductFeatured(
  productId: string,
  isFeatured: boolean
): Promise<void> {
  await ghlAction("feature", { productId, isFeatured });
}

export async function activateProduct(productId: string): Promise<void> {
  await ghlAction("activate", { productId });
}

/**
 * Downscale a photo and upload it into the GHL media library via /api/media.
 * Returns the hosted file id + url. The id is what product medias require.
 */
export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const { data, mediaType } = await fileToDownscaledBase64(file);
  const res = await apiPost("/api/media", {
    imageBase64: data,
    mediaType,
    name: file.name || "photo.jpg",
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Image upload failed (${res.status})`);
  }
  return (await res.json()) as { id: string; url: string };
}
