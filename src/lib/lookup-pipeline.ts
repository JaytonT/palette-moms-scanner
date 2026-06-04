// The barcode enrichment pipeline. This runs SERVER-SIDE (Vercel function
// api/lookup.ts) on purpose: UPCitemdb and the n8n Claude-judge webhook do not
// send CORS headers for the app's origin, so calling them from the browser
// silently fails (every fetch lands in a catch -> empty form). On the server
// there is no CORS, and the same calls return full product data.
//
// Relative imports only (no "@/" alias) so the @vercel/node build can resolve
// this from api/lookup.ts. Env is injected by the caller rather than read from
// import.meta so this module works in the function runtime and in tests.
import type { ProductData } from "../types/product";

export interface LookupEnv {
  webhookUrl: string;
  googleApiKey: string;
  googleCseId: string;
}

interface APIResult {
  source: string;
  data: {
    title: string;
    description: string;
    brand: string;
    category: string;
    weight: string;
    dimensions?: string;
    images: string[];
    averagePrice?: string;
  };
}

interface ClaudeJudgeResponse {
  title: string;
  description: string;
  brand: string;
  category: string;
  weight: string;
  dimensions: string;
  averagePrice: string;
  seoTitle: string;
  seoDescription: string;
  confidence: "high" | "medium" | "low";
  judgedSource?: string;
}

// ─── API fetchers ─────────────────────────────────────────────────────────────

async function tryOpenFoodFacts(barcode: string): Promise<APIResult | null> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    return {
      source: "OpenFoodFacts",
      data: {
        title: p.product_name || "",
        description: p.generic_name || p.product_name || "",
        brand: p.brands || "",
        category: p.categories || "",
        weight: p.quantity || "",
        images: [p.image_url, p.image_front_url].filter(Boolean) as string[],
      },
    };
  } catch {
    return null;
  }
}

async function tryUPCitemdb(barcode: string): Promise<APIResult | null> {
  try {
    const res = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    const dimensions =
      (item.dimension || "").toLowerCase().includes("x") ? item.dimension : "";

    return {
      source: "UPCitemdb",
      data: {
        title: item.title || "",
        description: item.description || item.title || "",
        brand: item.brand || "",
        category: item.category || "",
        weight: item.weight || "",
        dimensions,
        images: item.images || [],
        averagePrice: item.lowest_recorded_price
          ? `$${item.lowest_recorded_price}`
          : "",
      },
    };
  } catch {
    return null;
  }
}

async function tryGoUPC(barcode: string): Promise<APIResult | null> {
  try {
    const res = await fetch(`https://api.go-upc.com/v1/code/${barcode}`);
    // Silently handle 429 rate-limit and other non-ok responses
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.product) return null;

    const p = data.product;
    return {
      source: "GoUPC",
      data: {
        title: p.name || "",
        description: p.description || p.name || "",
        brand: p.brand || "",
        category: p.category || "",
        weight: p.weight || p.size || "",
        images: p.image ? [p.image] : [],
      },
    };
  } catch {
    return null;
  }
}

/**
 * Send all API results to Claude (via n8n webhook) for judging.
 * Claude picks the most accurate source, fills gaps, and returns confidence.
 * An empty {} response (the webhook's no-op for an unknown barcode) is treated
 * as "no verdict" so it cannot blank out otherwise-good API data.
 */
async function askClaudeToJudge(
  barcode: string,
  apiResults: APIResult[],
  webhookUrl: string
): Promise<ClaudeJudgeResponse | null> {
  if (!webhookUrl) return null;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcode, apiResults }),
    });
    if (!res.ok) return null;
    const verdict = (await res.json()) as Partial<ClaudeJudgeResponse> | null;
    // Drop empty / contentless verdicts (e.g. {}) — they have no usable fields
    // and would otherwise set confidence to undefined.
    if (
      !verdict ||
      (!verdict.confidence && !verdict.title && !verdict.brand && !verdict.description)
    ) {
      return null;
    }
    return verdict as ClaudeJudgeResponse;
  } catch {
    return null;
  }
}

/**
 * Fetch hi-res product images from Google Custom Search.
 * Filters to images >= 500px wide. Degrades silently on failure.
 */
async function tryGoogleImages(query: string, env: LookupEnv): Promise<string[]> {
  if (!env.googleApiKey || !env.googleCseId) return [];

  try {
    const url =
      `https://www.googleapis.com/customsearch/v1` +
      `?key=${encodeURIComponent(env.googleApiKey)}` +
      `&cx=${encodeURIComponent(env.googleCseId)}` +
      `&q=${encodeURIComponent(query)}` +
      `&searchType=image&imgSize=large&num=5`;

    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const items: Array<{ link: string; image: { width: number } }> =
      data.items ?? [];

    return [
      ...new Set(
        items.filter((i) => i.image?.width >= 500).map((i) => i.link)
      ),
    ];
  } catch {
    return [];
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Look up a barcode with the full pipeline:
 * 1. Parallel: OpenFoodFacts + UPCitemdb + GoUPC
 * 2. Always: Claude-as-judge (passes all API results; Claude picks best + fills gaps)
 * 3. If images empty or all from Open Food Facts (low-res): Google Image Search
 * 4. Determine confidence from Claude's verdict
 *
 * Falls back gracefully: if Claude webhook is down, uses raw API merge.
 */
export async function runBarcodePipeline(
  barcode: string,
  env: LookupEnv
): Promise<ProductData> {
  // Step 1: Run all 3 APIs in parallel
  const [offResult, upcResult, goupResult] = await Promise.allSettled([
    tryOpenFoodFacts(barcode),
    tryUPCitemdb(barcode),
    tryGoUPC(barcode),
  ]);

  const apiResults: APIResult[] = [];
  if (offResult.status === "fulfilled" && offResult.value)
    apiResults.push(offResult.value);
  if (upcResult.status === "fulfilled" && upcResult.value)
    apiResults.push(upcResult.value);
  if (goupResult.status === "fulfilled" && goupResult.value)
    apiResults.push(goupResult.value);

  // Step 2: Claude judges all results (even if 0 — tries cold identification)
  const verdict = await askClaudeToJudge(barcode, apiResults, env.webhookUrl);

  // Step 3: Build merged product — Claude's fields ALWAYS take priority
  type StringFields = Omit<
    ProductData,
    | "quantity"
    | "skuCode"
    | "isFeatured"
    | "estimatedFields"
    | "dataSource"
    | "confidence"
    | "images"
    | "barcode"
  >;
  const merged: Partial<StringFields> = {};
  const estimatedFields: string[] = [];

  if (verdict) {
    if (verdict.title) merged.title = verdict.title;
    if (verdict.description) merged.description = verdict.description;
    if (verdict.brand) merged.brand = verdict.brand;
    if (verdict.category) merged.category = verdict.category;
    if (verdict.weight) merged.weight = verdict.weight;
    if (verdict.dimensions) merged.dimensions = verdict.dimensions;
    if (verdict.averagePrice) merged.averagePrice = verdict.averagePrice;
    if (verdict.seoTitle) merged.seoTitle = verdict.seoTitle;
    if (verdict.seoDescription) merged.seoDescription = verdict.seoDescription;

    if (apiResults.length === 0) {
      const judgeFields = [
        "title",
        "description",
        "brand",
        "category",
        "weight",
        "dimensions",
        "averagePrice",
        "seoTitle",
        "seoDescription",
      ] as const;
      for (const f of judgeFields) {
        const val = verdict[f as keyof ClaudeJudgeResponse];
        if (typeof val === "string" && val.length > 0) {
          estimatedFields.push(f);
        }
      }
    }
  }

  // Fill gaps from raw API data (when Claude didn't cover a field)
  if (apiResults.length > 0) {
    const pickLongest = (field: keyof APIResult["data"]): string => {
      const vals = apiResults
        .flatMap((r) => {
          const v = r.data[field];
          return Array.isArray(v) ? [] : [v as string];
        })
        .filter((v) => typeof v === "string" && v.length > 0);
      return vals.length > 0
        ? vals.sort((a, b) => b.length - a.length)[0]
        : "";
    };
    const pickFirst = (field: keyof APIResult["data"]): string => {
      for (const r of apiResults) {
        const v = r.data[field];
        if (!Array.isArray(v) && typeof v === "string" && v.length > 0) return v;
      }
      return "";
    };

    if (!merged.title) merged.title = pickLongest("title");
    if (!merged.description) merged.description = pickLongest("description");
    if (!merged.brand) merged.brand = pickFirst("brand");
    if (!merged.category) merged.category = pickLongest("category");
    if (!merged.weight) merged.weight = pickFirst("weight");
    if (!merged.dimensions) merged.dimensions = pickFirst("dimensions");
    if (!merged.averagePrice) merged.averagePrice = pickFirst("averagePrice");
  }

  // Step 4: Collect images from APIs
  const rawImages = apiResults.flatMap((r) => r.data.images ?? []);
  const deduped = [...new Set(rawImages)];

  // Step 5: Decide if Google Images needed (no API images, or only low-res OFF)
  const allImagesFromOFFOnly =
    deduped.length > 0 &&
    apiResults
      .filter((r) => r.source !== "OpenFoodFacts")
      .every((r) => (r.data.images ?? []).length === 0);

  const needsGoogleImages = deduped.length === 0 || allImagesFromOFFOnly;

  let finalImages = deduped.slice(0, 4);
  if (needsGoogleImages) {
    const title = merged.title || "";
    const brand = merged.brand || "";
    const googleQuery = `${title} ${brand} product`.trim();
    if (googleQuery.length > 1) {
      const googleImages = await tryGoogleImages(googleQuery, env);
      const combined = [...new Set([...deduped, ...googleImages])];
      finalImages = combined.slice(0, 4);
    }
  }

  // Step 6: Confidence
  let confidence: "high" | "medium" | "low";
  if (verdict) {
    confidence = verdict.confidence;
  } else if (apiResults.length >= 1) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // Step 7: dataSource
  let dataSource: "api" | "ai" | "manual";
  if (apiResults.length > 0) {
    dataSource = "api";
  } else if (verdict !== null) {
    dataSource = "ai";
  } else {
    dataSource = "manual";
  }

  return {
    barcode,
    title: merged.title ?? "",
    description: merged.description ?? "",
    brand: merged.brand ?? "",
    category: merged.category ?? "",
    weight: merged.weight ?? "",
    dimensions: merged.dimensions ?? "",
    images: finalImages,
    averagePrice: merged.averagePrice ?? "",
    seoTitle: merged.seoTitle ?? "",
    seoDescription: merged.seoDescription ?? "",
    quantity: 0,
    skuCode: "",
    isFeatured: false,
    estimatedFields,
    dataSource,
    confidence,
  };
}
