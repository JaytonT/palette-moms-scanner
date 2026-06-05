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
 * Sum availableQuantity across a product's prices. Quantity lives on the PRICE
 * object in GHL, not the product, and the list endpoint does not expand prices,
 * so each product must be queried individually.
 */
export async function getProductQuantity(productId: string): Promise<number> {
  const res = await fetch(
    `${GHL_BASE}/products/${productId}/price?locationId=${GHL_LOCATION_ID}`,
    { headers: ghlHeaders() }
  );
  if (!res.ok) return 0;
  const data = await res.json();
  const prices: Array<{ availableQuantity?: number }> = data.prices ?? [];
  return prices.reduce((sum, p) => sum + (p.availableQuantity ?? 0), 0);
}

// Turn the human "0.23 lb" / "8.5 x 2 x 2 in" strings into GHL price
// shippingOptions. Returns undefined when nothing is parseable so we never send
// an empty/invalid block (verified shapes: weight unit "lb", dims unit "in").
function buildShippingOptions(data: ProductData):
  | {
      weight?: { value: number; unit: string };
      dimensions?: { length: number; width: number; height: number; unit: string };
    }
  | undefined {
  const out: {
    weight?: { value: number; unit: string };
    dimensions?: { length: number; width: number; height: number; unit: string };
  } = {};

  const w = data.weight.match(/([\d.]+)\s*(lb|lbs|kg|oz|g)?/i);
  if (w && parseFloat(w[1]) > 0) {
    out.weight = {
      value: parseFloat(w[1]),
      unit: (w[2] || "lb").toLowerCase().replace(/^lbs$/, "lb"),
    };
  }

  const d = data.dimensions.match(/([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)\s*(in|cm)?/i);
  if (d) {
    out.dimensions = {
      length: parseFloat(d[1]),
      width: parseFloat(d[2]),
      height: parseFloat(d[3]),
      unit: (d[4] || "in").toLowerCase(),
    };
  }

  return out.weight || out.dimensions ? out : undefined;
}

/**
 * Upload an image into the GHL media library by URL (GHL fetches it, no browser
 * CORS) and return its file id + hosted url. GHL's product `medias` require a
 * non-empty string `id` (a media-library file id), so external URLs must be
 * imported here first. Returns null on failure so the caller can skip it.
 */
async function uploadImageFromUrl(
  imageUrl: string,
  name: string
): Promise<{ id: string; url: string } | null> {
  try {
    const form = new FormData();
    form.append("fileUrl", imageUrl);
    form.append("hosted", "true");
    form.append("name", name);
    form.append("altType", "location");
    form.append("altId", GHL_LOCATION_ID);

    const res = await fetch(MEDIAS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: "2021-07-28" },
      body: form,
    });
    if (!res.ok) return null;
    const d = await res.json();
    const id = (d.fileId ?? d._id ?? d.id ?? d.mediaId) as string | undefined;
    const url = (d.url ?? d.fileUrl ?? d.publicUrl ?? imageUrl) as string;
    return id ? { id, url } : null;
  } catch {
    return null;
  }
}

/**
 * Create a new product in GHL, then attach its price.
 *
 * GHL models a simple item as a product (NO variants — variants are attribute
 * groups like Size/Color and require id + options) plus a separate one-time
 * price that carries SKU, quantity and shipping. `amount` is in DOLLARS, not
 * cents ($3.99 = 3.99). Verified against the live API.
 *
 * @param availableInStore - storefront visibility (default true). Pass false for
 *   low-confidence items that need review before going live.
 */
export async function createProduct(
  data: ProductData,
  availableInStore = true
): Promise<string> {
  // 1) Import images into the GHL media library to get file ids. GHL rejects
  // product medias without a non-empty string `id` (422), so we cannot send raw
  // external image URLs. Failed imports are skipped; medias is omitted if none.
  const uploaded = (
    await Promise.all(
      data.images
        .slice(0, 4)
        .map((url, i) => uploadImageFromUrl(url, `${data.title} image ${i + 1}`))
    )
  ).filter((m): m is { id: string; url: string } => m !== null);

  // 2) Create the product shell.
  const productPayload: Record<string, unknown> = {
    name: data.title,
    description: data.description,
    statementDescriptor: data.barcode,
    isFeatured: data.isFeatured,
    locationId: GHL_LOCATION_ID,
    productType: "PHYSICAL",
    availableInStore,
    seoTitle: data.seoTitle,
    seoDescription: data.seoDescription,
  };
  if (uploaded.length > 0) {
    productPayload.medias = uploaded.map((m, i) => ({
      id: m.id,
      url: m.url,
      type: "image",
      isFeatured: i === 0,
    }));
  }

  const res = await fetch(`${GHL_BASE}/products/`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(productPayload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL create product failed: ${res.status} ${text}`);
  }
  const created = await res.json();
  // GHL returns the product object at the top level (no { product } wrapper).
  const productId = (created._id ?? created.product?._id) as string | undefined;
  if (!productId) throw new Error("GHL create product: no id in response");

  // 2) Attach the price (SKU, quantity, shipping live here; amount in dollars).
  const amount = parseFloat(data.averagePrice.replace(/[^0-9.]/g, ""));
  const pricePayload: Record<string, unknown> = {
    name: data.title || "Default",
    type: "one_time",
    currency: "USD",
    amount: isNaN(amount) ? 0 : amount,
    sku: data.skuCode || data.barcode,
    availableQuantity: data.quantity,
    trackInventory: true,
    allowOutOfStockPurchases: false,
    locationId: GHL_LOCATION_ID,
  };
  const shippingOptions = buildShippingOptions(data);
  if (shippingOptions) pricePayload.shippingOptions = shippingOptions;

  const priceRes = await fetch(`${GHL_BASE}/products/${productId}/price`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(pricePayload),
  });
  if (!priceRes.ok) {
    const text = await priceRes.text();
    throw new Error(`GHL create price failed: ${priceRes.status} ${text}`);
  }

  return productId;
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
