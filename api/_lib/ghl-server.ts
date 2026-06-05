// Server-side GHL operations. Runs only in Vercel functions, so the GHL token
// (process.env.VITE_GHL_API_KEY) never reaches the browser bundle. All product
// writes go through here. Request shapes verified against the live GHL V2 API.
//
// Lives under api/_lib (the "_" prefix keeps it from being a route) so the
// @vercel/node bundler traces it into each function. Importers must use the
// ".js" extension (package.json is type:module → ESM at runtime).

const GHL_BASE = "https://services.leadconnectorhq.com";

function token(): string {
  return process.env.VITE_GHL_API_KEY ?? "";
}
function locationId(): string {
  return process.env.VITE_GHL_LOCATION_ID ?? "";
}
function jsonHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}
function authHeaders(): Record<string, string> {
  // For multipart — do NOT set Content-Type (the runtime sets the boundary).
  return { Authorization: `Bearer ${token()}`, Version: "2021-07-28" };
}

export interface ProductInput {
  barcode: string;
  title: string;
  description: string;
  weight: string;
  dimensions: string;
  images: string[];
  averagePrice: string;
  seoTitle: string;
  seoDescription: string;
  quantity: number;
  skuCode: string;
  isFeatured: boolean;
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

function buildShippingOptions(weight: string, dimensions: string) {
  const out: {
    weight?: { value: number; unit: string };
    dimensions?: { length: number; width: number; height: number; unit: string };
  } = {};
  const w = (weight || "").match(/([\d.]+)\s*(lb|lbs|kg|oz|g)?/i);
  if (w && parseFloat(w[1]) > 0) {
    out.weight = {
      value: parseFloat(w[1]),
      unit: (w[2] || "lb").toLowerCase().replace(/^lbs$/, "lb"),
    };
  }
  const d = (dimensions || "").match(
    /([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)\s*(in|cm)?/i
  );
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

// Import an external image URL into the GHL media library (GHL fetches it — no
// browser CORS) and return its file id. Product medias require a string id.
async function importImage(
  imageUrl: string,
  name: string
): Promise<{ id: string; url: string } | null> {
  try {
    const form = new FormData();
    form.append("fileUrl", imageUrl);
    form.append("hosted", "true");
    form.append("name", name);
    form.append("altType", "location");
    form.append("altId", locationId());
    const res = await fetch(`${GHL_BASE}/medias/upload-file`, {
      method: "POST",
      headers: authHeaders(),
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

// Upload raw image bytes (base64 from the browser) into the GHL media library.
export async function uploadBase64(
  imageBase64: string,
  mediaType: string,
  name: string
): Promise<{ id: string; url: string } | null> {
  try {
    const bytes = Buffer.from(imageBase64, "base64");
    const blob = new Blob([bytes], { type: mediaType || "image/jpeg" });
    const form = new FormData();
    form.append("file", blob, name);
    form.append("name", name);
    form.append("altType", "location");
    form.append("altId", locationId());
    const res = await fetch(`${GHL_BASE}/medias/upload-file`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) return null;
    const d = await res.json();
    const id = (d.fileId ?? d._id ?? d.id ?? d.mediaId) as string | undefined;
    const url = (d.url ?? d.fileUrl ?? d.publicUrl) as string | undefined;
    return id && url ? { id, url } : null;
  } catch {
    return null;
  }
}

export async function createProductWithPrice(
  data: ProductInput,
  availableInStore = true
): Promise<string> {
  const uploaded = (
    await Promise.all(
      (data.images || [])
        .slice(0, 4)
        .map((url, i) => importImage(url, `${data.title} image ${i + 1}`))
    )
  ).filter((m): m is { id: string; url: string } => m !== null);

  const productPayload: Record<string, unknown> = {
    name: data.title,
    description: data.description,
    statementDescriptor: data.barcode,
    isFeatured: data.isFeatured,
    locationId: locationId(),
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
    headers: jsonHeaders(),
    body: JSON.stringify(productPayload),
  });
  if (!res.ok) {
    throw new Error(`GHL create product failed: ${res.status} ${await res.text()}`);
  }
  const created = await res.json();
  const productId = (created._id ?? created.product?._id) as string | undefined;
  if (!productId) throw new Error("GHL create product: no id in response");

  const amount = parseFloat((data.averagePrice || "").replace(/[^0-9.]/g, ""));
  const pricePayload: Record<string, unknown> = {
    name: data.title || "Default",
    type: "one_time",
    currency: "USD",
    amount: isNaN(amount) ? 0 : amount,
    sku: data.skuCode || data.barcode,
    availableQuantity: data.quantity,
    trackInventory: true,
    allowOutOfStockPurchases: false,
    locationId: locationId(),
  };
  const shippingOptions = buildShippingOptions(data.weight, data.dimensions);
  if (shippingOptions) pricePayload.shippingOptions = shippingOptions;

  const priceRes = await fetch(`${GHL_BASE}/products/${productId}/price`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(pricePayload),
  });
  if (!priceRes.ok) {
    throw new Error(`GHL create price failed: ${priceRes.status} ${await priceRes.text()}`);
  }
  return productId;
}

interface FoundProduct {
  productId: string;
  name: string;
  priceId: string | null;
  price: Record<string, unknown> | null;
  currentQuantity: number;
}

export async function findByBarcode(barcode: string): Promise<FoundProduct | null> {
  const res = await fetch(
    `${GHL_BASE}/products/?locationId=${locationId()}&limit=100`,
    { headers: jsonHeaders() }
  );
  if (!res.ok) throw new Error(`GHL products list failed: ${res.status}`);
  const data = await res.json();
  const products: Array<{ _id: string; name?: string; statementDescriptor?: string }> =
    data.products ?? [];
  const match = products.find((p) => p.statementDescriptor === barcode);
  if (!match) return null;

  const prRes = await fetch(
    `${GHL_BASE}/products/${match._id}/price?locationId=${locationId()}`,
    { headers: jsonHeaders() }
  );
  let priceId: string | null = null;
  let price: Record<string, unknown> | null = null;
  let currentQuantity = 0;
  if (prRes.ok) {
    const pd = await prRes.json();
    const prices: Array<Record<string, unknown>> = pd.prices ?? [];
    currentQuantity = prices.reduce(
      (s, p) => s + (Number(p.availableQuantity) || 0),
      0
    );
    if (prices.length > 0) {
      price = prices[0];
      priceId = (prices[0]._id as string) ?? null;
    }
  }
  return { productId: match._id, name: match.name ?? "", priceId, price, currentQuantity };
}

// Add stock to an existing product (matched by barcode). Quantity lives on the
// price, so we update the price's availableQuantity to current + addQuantity.
export async function restock(
  barcode: string,
  addQuantity: number
): Promise<{ productId: string; newQuantity: number } | null> {
  const found = await findByBarcode(barcode);
  if (!found || !found.priceId || !found.price) return null;
  const newQuantity = found.currentQuantity + addQuantity;

  // Echo back the price's existing fields — a PUT that omits them nulls them
  // (e.g. trackInventory), which would silently disable stock tracking.
  const body: Record<string, unknown> = {
    name: found.price.name ?? "Default",
    type: found.price.type ?? "one_time",
    currency: found.price.currency ?? "USD",
    amount: found.price.amount ?? 0,
    sku: found.price.sku,
    availableQuantity: newQuantity,
    trackInventory: true,
    allowOutOfStockPurchases: found.price.allowOutOfStockPurchases ?? false,
    locationId: locationId(),
  };
  const res = await fetch(
    `${GHL_BASE}/products/${found.productId}/price/${found.priceId}`,
    { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(body) }
  );
  if (!res.ok) {
    throw new Error(`GHL restock failed: ${res.status} ${await res.text()}`);
  }
  return { productId: found.productId, newQuantity };
}

export async function setFeatured(productId: string, isFeatured: boolean): Promise<void> {
  const res = await fetch(`${GHL_BASE}/products/${productId}`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ isFeatured, locationId: locationId() }),
  });
  if (!res.ok) throw new Error(`GHL set featured failed: ${res.status} ${await res.text()}`);
}

export async function setActive(productId: string): Promise<void> {
  const res = await fetch(`${GHL_BASE}/products/${productId}`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ availableInStore: true, locationId: locationId() }),
  });
  if (!res.ok) throw new Error(`GHL activate failed: ${res.status} ${await res.text()}`);
}

export interface InventoryItem {
  _id: string;
  name?: string;
  statementDescriptor?: string;
  availableInStore?: boolean;
  isFeatured?: boolean;
  medias?: unknown[];
  quantity: number;
}

export async function getInventory(): Promise<InventoryItem[]> {
  const listRes = await fetch(
    `${GHL_BASE}/products/?locationId=${locationId()}&limit=100`,
    { headers: jsonHeaders() }
  );
  if (!listRes.ok) throw new Error(`GHL products list failed: ${listRes.status}`);
  const list = await listRes.json();
  const products: Array<{
    _id: string;
    name?: string;
    statementDescriptor?: string;
    availableInStore?: boolean;
    isFeatured?: boolean;
    medias?: unknown[];
  }> = list.products ?? [];

  return mapWithConcurrency(products, 4, async (p) => {
    let quantity = 0;
    try {
      const pr = await fetch(
        `${GHL_BASE}/products/${p._id}/price?locationId=${locationId()}`,
        { headers: jsonHeaders() }
      );
      if (pr.ok) {
        const pd = await pr.json();
        const prices: Array<{ availableQuantity?: number }> = pd.prices ?? [];
        quantity = prices.reduce((s, x) => s + (x.availableQuantity ?? 0), 0);
      }
    } catch {
      /* leave 0 */
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
}
