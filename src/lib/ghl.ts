import type { ProductData } from "@/types/product";
import { fileToDownscaledBase64 } from "@/lib/identify-product";
import { accessToken } from "@/lib/supabase";

// Thin client. ALL GHL writes run server-side (api/ghl.ts, api/media.ts) so the
// GHL token lives only in the function runtime and never ships in the browser
// bundle. This module just calls those endpoints, authenticated with the staff
// user's Supabase access token (verified server-side).

// POST JSON with the signed-in user's Supabase access token as a Bearer header.
// A 401 means the session is missing or expired; AuthGate handles re-login, so
// callers just surface the error.
async function apiPost(url: string, body: unknown): Promise<Response> {
  const token = await accessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
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

// ─── Collections (categories) ──────────────────────────────────────────────────

export interface Collection {
  id: string;
  name: string;
}

export async function listCollections(): Promise<Collection[]> {
  const r = await ghlAction<{ collections: Collection[] }>("collections", {});
  return r.collections ?? [];
}

export async function createCollection(name: string): Promise<Collection> {
  return ghlAction<Collection>("createCollection", { name });
}

// ─── Editable product detail + updates (Inventory tab) ─────────────────────────

export interface ProductDetail {
  _id: string;
  name: string;
  description: string;
  statementDescriptor: string;
  seoTitle: string;
  seoDescription: string;
  isFeatured: boolean;
  availableInStore: boolean;
  collectionIds: string[];
  images: { id?: string; url: string }[];
  amount: string;
  sloc: string; // GHL price.sku field, labeled SLOC in the UI
  quantity: number;
  weight: string;
  dimensions: string;
}

export async function getProductDetail(productId: string): Promise<ProductDetail> {
  return ghlAction<ProductDetail>("detail", { productId });
}

export interface ProductUpdateFields {
  name?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  isFeatured?: boolean;
  availableInStore?: boolean;
  collectionIds?: string[];
  medias?: { id: string; url: string; type: string; isFeatured: boolean }[];
}

export async function updateProductFields(
  productId: string,
  fields: ProductUpdateFields
): Promise<void> {
  await ghlAction("update", { productId, fields });
}

export interface PriceUpdateFields {
  amount?: number;
  sloc?: string;
  quantity?: number;
  weight?: string;
  dimensions?: string;
  name?: string;
}

export async function setProductPrice(
  productId: string,
  fields: PriceUpdateFields
): Promise<void> {
  await ghlAction("setPrice", { productId, fields });
}
