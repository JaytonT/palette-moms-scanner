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
  // SLOC value; written to GHL's native price.sku field.
  slocCode: string;
  isFeatured: boolean;
  collectionId?: string;
  // Photos already in the GHL media library (staff uploads), matched to images[]
  // by url so they are attached directly without a second import.
  imageMedia?: { id: string; url: string }[];
}

// List every product for the location, paging past GHL's 100-per-page cap. The
// store has hundreds of products (dollar-grid POS tiles + scanned stock); a
// single limit=100 call silently hides the rest, which breaks duplicate
// detection (re-scans become duplicates) and the Inventory list.
async function listAllProducts(): Promise<
  Array<{
    _id: string;
    name?: string;
    statementDescriptor?: string;
    availableInStore?: boolean;
    isFeatured?: boolean;
    collectionIds?: string[];
    medias?: unknown[];
    productType?: string;
  }>
> {
  const limit = 100;
  const all: Array<Record<string, any>> = [];
  // Safety cap so a malformed `total` can never spin forever.
  for (let offset = 0; offset < 5000; offset += limit) {
    const res = await fetch(
      `${GHL_BASE}/products/?locationId=${locationId()}&limit=${limit}&offset=${offset}`,
      { headers: jsonHeaders() }
    );
    if (!res.ok) throw new Error(`GHL products list failed: ${res.status}`);
    const data = await res.json();
    const batch: Array<Record<string, any>> = data.products ?? [];
    all.push(...batch);
    if (batch.length < limit) break;
  }
  return all as any;
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
  // Staff photos were already uploaded to the GHL media library (we have their
  // id+url). Attach those directly. Only external lookup-sourced URLs (no id)
  // need importing. Iterating images[] in order preserves hero (index 0).
  const preUploaded = new Map(
    (data.imageMedia || []).map((m) => [m.url, m] as const)
  );
  const uploaded = (
    await Promise.all(
      (data.images || [])
        .slice(0, 4)
        .map((url, i) => {
          const pre = preUploaded.get(url);
          if (pre) return Promise.resolve(pre);
          return importImage(url, `${data.title} image ${i + 1}`);
        })
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
    // GHL stores SEO under a nested `seo` object (verified against live products:
    // imported items have `seo:{title,description}`, while app-created items that
    // sent top-level seoTitle/seoDescription had them silently dropped).
    seo: { title: data.seoTitle, description: data.seoDescription },
  };
  if (data.collectionId) {
    productPayload.collectionIds = [data.collectionId];
  }
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
    sku: data.slocCode || data.barcode, // GHL field is "sku"; holds the SLOC value

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
  // Page the full catalog — a 100-cap match here would miss existing products and
  // turn re-scans into duplicate creates.
  const products = await listAllProducts();
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

// ─── Editable update operations (Inventory tab Sync) ───────────────────────────

export interface ProductUpdateFields {
  name?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  isFeatured?: boolean;
  availableInStore?: boolean;
  collectionIds?: string[];
  medias?: Array<{ id: string; url: string; type: string; isFeatured: boolean }>;
}

// PUT only the provided fields. GHL product PUT is a partial merge (verified:
// setFeatured / setActive update one field without nulling the rest).
export async function updateProduct(
  productId: string,
  fields: ProductUpdateFields
): Promise<void> {
  const payload: Record<string, unknown> = {
    locationId: locationId(),
    productType: "PHYSICAL",
  };
  if (fields.name !== undefined) payload.name = fields.name;
  if (fields.description !== undefined) payload.description = fields.description;
  if (fields.seoTitle !== undefined || fields.seoDescription !== undefined) {
    payload.seo = { title: fields.seoTitle ?? "", description: fields.seoDescription ?? "" };
  }
  if (fields.isFeatured !== undefined) payload.isFeatured = fields.isFeatured;
  if (fields.availableInStore !== undefined) payload.availableInStore = fields.availableInStore;
  if (fields.collectionIds !== undefined) payload.collectionIds = fields.collectionIds;
  if (fields.medias !== undefined) payload.medias = fields.medias;
  const res = await fetch(`${GHL_BASE}/products/${productId}`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`GHL update product failed: ${res.status} ${await res.text()}`);
}

interface FirstPrice {
  priceId: string | null;
  price: Record<string, unknown> | null;
}

async function getFirstPrice(productId: string): Promise<FirstPrice> {
  const res = await fetch(
    `${GHL_BASE}/products/${productId}/price?locationId=${locationId()}`,
    { headers: jsonHeaders() }
  );
  if (!res.ok) return { priceId: null, price: null };
  const d = await res.json();
  const prices: Array<Record<string, unknown>> = d.prices ?? [];
  if (prices.length === 0) return { priceId: null, price: null };
  return { priceId: (prices[0]._id as string) ?? null, price: prices[0] };
}

export interface PriceUpdateFields {
  amount?: number; // absolute price in dollars
  sloc?: string; // SLOC code, written to GHL's price.sku field
  quantity?: number; // absolute available quantity
  weight?: string;
  dimensions?: string;
  name?: string; // product title, used as the price name default
}

// Update the product's first price, echoing existing fields so a partial PUT does
// not null them. Creates a price if none exists.
export async function setPrice(
  productId: string,
  fields: PriceUpdateFields
): Promise<void> {
  const { priceId, price } = await getFirstPrice(productId);
  const body: Record<string, unknown> = {
    name: (price?.name as string) ?? fields.name ?? "Default",
    type: (price?.type as string) ?? "one_time",
    currency: (price?.currency as string) ?? "USD",
    amount: fields.amount !== undefined ? fields.amount : price?.amount ?? 0,
    sku: fields.sloc !== undefined ? fields.sloc : (price?.sku as string) ?? "",
    availableQuantity:
      fields.quantity !== undefined ? fields.quantity : price?.availableQuantity ?? 0,
    trackInventory: true,
    allowOutOfStockPurchases: (price?.allowOutOfStockPurchases as boolean) ?? false,
    locationId: locationId(),
  };
  if (fields.weight !== undefined || fields.dimensions !== undefined) {
    const so = buildShippingOptions(fields.weight ?? "", fields.dimensions ?? "");
    if (so) body.shippingOptions = so;
  } else if (price?.shippingOptions) {
    body.shippingOptions = price.shippingOptions;
  }
  const url = priceId
    ? `${GHL_BASE}/products/${productId}/price/${priceId}`
    : `${GHL_BASE}/products/${productId}/price`;
  const res = await fetch(url, {
    method: priceId ? "PUT" : "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GHL set price failed: ${res.status} ${await res.text()}`);
}

// ─── Collections (categories) ──────────────────────────────────────────────────

export interface Collection {
  id: string;
  name: string;
}

export async function listCollections(): Promise<Collection[]> {
  const res = await fetch(
    `${GHL_BASE}/products/collections?altId=${locationId()}&altType=location&limit=100`,
    { headers: jsonHeaders() }
  );
  if (!res.ok) throw new Error(`GHL list collections failed: ${res.status}`);
  const d = await res.json();
  const items: Array<{ _id: string; name: string }> = d.data ?? [];
  return items.map((c) => ({ id: c._id, name: c.name }));
}

export async function createCollection(name: string): Promise<Collection> {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const res = await fetch(`${GHL_BASE}/products/collections`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ altId: locationId(), altType: "location", name, slug }),
  });
  if (!res.ok) throw new Error(`GHL create collection failed: ${res.status} ${await res.text()}`);
  const d = await res.json();
  const c = (d.data ?? d) as { _id?: string; id?: string; name?: string };
  return { id: (c._id ?? c.id) as string, name: c.name ?? name };
}

// ─── Full editable detail for one product (Inventory edit panel prefill) ───────

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
  images: Array<{ id?: string; url: string }>;
  amount: string;
  sloc: string; // from GHL's price.sku field
  quantity: number;
  weight: string;
  dimensions: string;
}

export async function getProductDetail(productId: string): Promise<ProductDetail> {
  const pr = await fetch(`${GHL_BASE}/products/${productId}?locationId=${locationId()}`, {
    headers: jsonHeaders(),
  });
  if (!pr.ok) throw new Error(`GHL get product failed: ${pr.status}`);
  const pbody = await pr.json();
  const p = (pbody.product ?? pbody) as Record<string, any>;
  const { price } = await getFirstPrice(productId);
  const so = (price?.shippingOptions ?? {}) as {
    weight?: { value?: number; unit?: string };
    dimensions?: { length?: number; width?: number; height?: number; unit?: string };
  };
  const weight = so.weight?.value ? `${so.weight.value} ${so.weight.unit ?? "lb"}` : "";
  const dimensions =
    so.dimensions && so.dimensions.length
      ? `${so.dimensions.length} x ${so.dimensions.width} x ${so.dimensions.height} ${so.dimensions.unit ?? "in"}`
      : "";
  const medias = (p.medias ?? []) as Array<{ _id?: string; id?: string; url: string }>;
  return {
    _id: p._id,
    name: p.name ?? "",
    description: p.description ?? "",
    statementDescriptor: p.statementDescriptor ?? "",
    seoTitle: p.seo?.title ?? "",
    seoDescription: p.seo?.description ?? "",
    isFeatured: !!p.isFeatured,
    availableInStore: p.availableInStore !== false,
    collectionIds: (p.collectionIds ?? []) as string[],
    images: medias.map((m) => ({ id: m.id ?? m._id, url: m.url })),
    amount: price?.amount !== undefined && price?.amount !== null ? String(price.amount) : "",
    sloc: (price?.sku as string) ?? "",
    quantity: Number(price?.availableQuantity ?? 0),
    weight,
    dimensions,
  };
}

export interface InventoryItem {
  _id: string;
  name?: string;
  statementDescriptor?: string;
  availableInStore?: boolean;
  isFeatured?: boolean;
  collectionIds?: string[];
  medias?: unknown[];
  quantity: number;
}

export async function getInventory(): Promise<InventoryItem[]> {
  // Page the full catalog, then keep only PHYSICAL stock. The scanner creates
  // PHYSICAL products; the hundreds of SERVICE dollar-grid POS tiles are not
  // inventory and must not flood this list (the limit=100 page was almost
  // entirely those tiles).
  const all = await listAllProducts();
  const products = all.filter((p) => p.productType === "PHYSICAL");

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
      collectionIds: p.collectionIds ?? [],
      medias: p.medias ?? [],
      quantity,
    };
  });
}
