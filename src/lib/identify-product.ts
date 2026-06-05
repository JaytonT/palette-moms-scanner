import type { ProductData } from "@/types/product";

// Shape returned by /api/identify (Claude vision, validated server-side).
export interface VisionResult {
  identified: boolean;
  title: string;
  brand: string;
  category: string;
  description: string;
  weightLbs: number;
  weightFromPackage: boolean;
  heightInches: number;
  lengthInches: number;
  depthInches: number;
  averagePrice: string;
  priceFromLabel: boolean;
  barcode: string;
  seoTitle: string;
  seoDescription: string;
  confidence: "high" | "medium" | "low";
}

// Pure: turn a vision result into a ProductData for the form.
// estimatedFields drives the "estimate" tags so staff know what to verify.
export function mapVisionToProduct(v: VisionResult, scannedBarcode?: string): ProductData {
  const dims = [v.heightInches, v.lengthInches, v.depthInches];
  const hasDims = dims.every((n) => typeof n === "number" && n > 0);

  // Dimensions are never printed, so always an estimate. Weight is an estimate
  // unless a printed net weight drove it.
  const estimatedFields: string[] = ["description", "category", "seoTitle", "seoDescription"];
  if (hasDims) estimatedFields.push("dimensions");
  if (v.weightLbs > 0 && !v.weightFromPackage) estimatedFields.push("weight");
  if (v.averagePrice && !v.priceFromLabel) estimatedFields.push("averagePrice");

  return {
    barcode: scannedBarcode || v.barcode || "",
    title: v.title ?? "",
    description: v.description ?? "",
    brand: v.brand ?? "",
    category: v.category ?? "",
    weight: v.weightLbs > 0 ? `${v.weightLbs.toFixed(2)} lb` : "",
    dimensions: hasDims
      ? `${v.heightInches} x ${v.lengthInches} x ${v.depthInches} in`
      : "",
    images: [],
    averagePrice: v.averagePrice ?? "",
    seoTitle: v.seoTitle ?? "",
    seoDescription: v.seoDescription ?? "",
    quantity: 0,
    skuCode: "",
    isFeatured: false,
    estimatedFields,
    dataSource: "ai",
    // A vision read with no legible identity is not safe to auto-list.
    confidence: v.identified ? v.confidence : "low",
  };
}

// Downscale before upload: a phone photo is multi-MB; Vercel caps the request
// body at ~4.5MB, and ~1280px is plenty for reading a label.
export async function fileToDownscaledBase64(
  file: File,
  maxEdge = 1280
): Promise<{ data: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");
  ctx.drawImage(bitmap, 0, 0, w, h);
  (bitmap as ImageBitmap).close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { data: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg" };
}

export async function identifyProductFromImage(
  file: File,
  scannedBarcode?: string
): Promise<ProductData> {
  const { data, mediaType } = await fileToDownscaledBase64(file);
  const res = await fetch("/api/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: data, mediaType, barcode: scannedBarcode ?? "" }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Identify failed (${res.status})`);
  }
  const v = (await res.json()) as VisionResult;
  return mapVisionToProduct(v, scannedBarcode);
}
