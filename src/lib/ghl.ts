import type { ProductData, GHLProduct, GHLVariant } from "@/types/product";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_KEY = import.meta.env.VITE_GHL_API_KEY as string;
const GHL_LOCATION_ID = import.meta.env.VITE_GHL_LOCATION_ID as string;

function ghlHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

export interface FindProductResult {
  found: true;
  product: GHLProduct;
  currentQuantity: number;
}

export async function findProductByBarcode(
  barcode: string
): Promise<FindProductResult | null> {
  const res = await fetch(
    `${GHL_BASE}/products/?locationId=${GHL_LOCATION_ID}&limit=100`,
    { headers: ghlHeaders() }
  );
  if (!res.ok) throw new Error(`GHL fetch products failed: ${res.status}`);

  const data = await res.json();
  const products: GHLProduct[] = data.products ?? [];

  const match = products.find(
    (p) =>
      p.statementDescriptor === barcode ||
      p.variants?.some((v: GHLVariant) => v.sku === barcode)
  );
  if (!match) return null;

  const currentQuantity =
    match.variants?.reduce(
      (sum: number, v: GHLVariant) => sum + (v.availableQuantity ?? 0),
      0
    ) ?? 0;

  return { found: true, product: match, currentQuantity };
}

/**
 * Create a new product in GHL.
 * @param data - ProductData to create
 * @param availableInStore - Whether the product is visible on storefront (default true).
 *   Pass false for low-confidence products that need mom review before going live.
 */
export async function createProduct(
  data: ProductData,
  availableInStore = true
): Promise<string> {
  const priceInCents = Math.round(
    parseFloat(data.averagePrice.replace(/[^0-9.]/g, "")) * 100
  );

  const payload = {
    name: data.title,
    description: data.description,
    statementDescriptor: data.barcode,
    isFeatured: data.isFeatured,
    locationIds: [GHL_LOCATION_ID],
    availableInStore,
    medias: data.images.slice(0, 4).map((url, i) => ({
      url,
      title: `${data.title} image ${i + 1}`,
      type: "image",
      isFeatured: i === 0,
    })),
    variants: [
      {
        name: "Default",
        sku: data.skuCode || data.barcode,
        price: isNaN(priceInCents) ? 0 : priceInCents,
        availableQuantity: data.quantity,
      },
    ],
    seoTitle: data.seoTitle,
    seoDescription: data.seoDescription,
  };

  const res = await fetch(`${GHL_BASE}/products/`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL create product failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  return json.product._id as string;
}

export async function updateProductQuantity(
  productId: string,
  variantId: string,
  newQuantity: number
): Promise<void> {
  const payload = {
    variants: [{ id: variantId, availableQuantity: newQuantity }],
  };

  const res = await fetch(`${GHL_BASE}/products/${productId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL update product failed: ${res.status} ${text}`);
  }
}

export async function setProductFeatured(
  productId: string,
  isFeatured: boolean
): Promise<void> {
  const payload = { isFeatured };

  const res = await fetch(`${GHL_BASE}/products/${productId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL set featured failed: ${res.status} ${text}`);
  }
}

const MEDIAS_ENDPOINT = `${GHL_BASE}/medias/upload-file`;

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("name", file.name || `palettmoms-${Date.now()}.jpg`);
  form.append("altType", "location");
  form.append("altId", GHL_LOCATION_ID);

  const res = await fetch(MEDIAS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GHL_API_KEY}`,
      Version: "2021-07-28",
      // Do NOT set Content-Type manually — browser sets the correct multipart boundary
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GHL image upload failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const url = data.url || data.fileUrl || data.publicUrl || data.secureUrl;
  if (!url) throw new Error("GHL upload response missing URL field");
  return url;
}
