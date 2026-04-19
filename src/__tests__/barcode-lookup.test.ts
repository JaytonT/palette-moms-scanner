import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupBarcode } from "@/lib/barcode-lookup";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OFF_RESPONSE = {
  status: 1,
  product: {
    product_name: "Organic Apple Sauce",
    generic_name: "Apple sauce",
    brands: "Happy Family",
    categories: "Food",
    quantity: "4oz",
    image_url: "https://off.example.com/img1.jpg",
    image_front_url: "https://off.example.com/img2.jpg",
  },
};

const UPC_RESPONSE = {
  items: [
    {
      title: "Organic Apple Sauce Pouch",
      description: "Delicious organic apple sauce",
      brand: "Happy Family",
      category: "Baby Food",
      weight: "4 oz",
      dimension: "3 x 2 x 1 in",
      images: ["https://upc.example.com/img.jpg"],
      lowest_recorded_price: 2.99,
    },
  ],
};

const GOUPC_RESPONSE = {
  product: {
    name: "Happy Family Organic Apple Sauce 4oz",
    description: "Certified organic apple sauce",
    brand: "Happy Family",
    category: "Baby & Toddler Food",
    image: "https://goupc.example.com/img.jpg",
    size: "4oz",
    weight: "113g",
    region: "US",
  },
};

const CLAUDE_JUDGE_RESPONSE = {
  title: "Happy Family Organic Apple Sauce 4oz",
  description: "Certified organic apple sauce for babies and toddlers",
  brand: "Happy Family",
  category: "Baby & Toddler Food",
  weight: "4oz",
  dimensions: "3 x 2 x 1 in",
  averagePrice: "$2.99",
  seoTitle: "Happy Family Organic Apple Sauce 4oz - Baby Food",
  seoDescription: "Certified organic apple sauce for babies and toddlers",
  confidence: "high",
  judgedSource: "GoUPC",
};

const GOOGLE_IMAGES_RESPONSE = {
  items: [
    {
      link: "https://images.google.com/product1.jpg",
      image: { width: 800, height: 800 },
    },
    {
      link: "https://images.google.com/product2.jpg",
      image: { width: 600, height: 600 },
    },
    {
      link: "https://images.google.com/small.jpg",
      image: { width: 300, height: 300 },
    },
  ],
};

function mockFetch(
  handlers: Array<{
    match: (url: string) => boolean;
    response: unknown;
    ok?: boolean;
    status?: number;
  }>
) {
  return vi.fn((url: string) => {
    for (const h of handlers) {
      if (h.match(url)) {
        const ok = h.ok !== false;
        return Promise.resolve({
          ok,
          status: h.status ?? (ok ? 200 : 400),
          json: () => Promise.resolve(h.response),
          text: () => Promise.resolve(JSON.stringify(h.response)),
        });
      }
    }
    // Default: not found
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("Not found"),
    });
  }) as unknown as typeof fetch;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("lookupBarcode", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubEnv("VITE_N8N_BARCODE_WEBHOOK", "https://n8n.test/webhook/barcode");
    vi.stubEnv("VITE_GOOGLE_SEARCH_API_KEY", "test-google-key");
    vi.stubEnv("VITE_GOOGLE_CSE_ID", "test-cse-id");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ── Existing tests (adapted) ──────────────────────────────────────────────

  it("returns product data when all three APIs succeed", async () => {
    globalThis.fetch = mockFetch([
      {
        match: (u) => u.includes("openfoodfacts.org"),
        response: OFF_RESPONSE,
      },
      {
        match: (u) => u.includes("upcitemdb.com"),
        response: UPC_RESPONSE,
      },
      {
        match: (u) => u.includes("api.go-upc.com"),
        response: GOUPC_RESPONSE,
      },
      {
        match: (u) => u.includes("n8n.test"),
        response: CLAUDE_JUDGE_RESPONSE,
      },
      {
        // Google images — no images from APIs so this will be called
        match: (u) => u.includes("googleapis.com/customsearch"),
        response: GOOGLE_IMAGES_RESPONSE,
      },
    ]);

    const result = await lookupBarcode("012345678901");

    expect(result.barcode).toBe("012345678901");
    expect(result.title).toBeTruthy();
    expect(result.brand).toBeTruthy();
    expect(typeof result.confidence).toBe("string");
    expect(["high", "medium", "low"]).toContain(result.confidence);
    expect(result.dataSource).toBe("api");
  });

  it("uses AI as fallback when all three APIs fail and sets confidence=low", async () => {
    const lowConfidenceJudge = {
      title: "",
      description: "",
      brand: "",
      category: "",
      weight: "",
      dimensions: "",
      averagePrice: "",
      seoTitle: "",
      seoDescription: "",
      confidence: "low",
    };

    globalThis.fetch = mockFetch([
      {
        match: (u) => u.includes("openfoodfacts.org"),
        response: {},
        ok: false,
      },
      { match: (u) => u.includes("upcitemdb.com"), response: {}, ok: false },
      { match: (u) => u.includes("api.go-upc.com"), response: {}, ok: false },
      {
        match: (u) => u.includes("n8n.test"),
        response: lowConfidenceJudge,
      },
    ]);

    const result = await lookupBarcode("000000000000");

    expect(result.dataSource).toBe("ai");
    expect(result.confidence).toBe("low");
  });

  it("returns manual source when webhook also fails", async () => {
    globalThis.fetch = mockFetch([
      {
        match: (u) => u.includes("openfoodfacts.org"),
        response: {},
        ok: false,
      },
      { match: (u) => u.includes("upcitemdb.com"), response: {}, ok: false },
      { match: (u) => u.includes("api.go-upc.com"), response: {}, ok: false },
      { match: (u) => u.includes("n8n.test"), response: {}, ok: false },
    ]);

    const result = await lookupBarcode("000000000000");

    expect(result.dataSource).toBe("manual");
    expect(result.confidence).toBe("low");
    expect(result.title).toBe("");
  });

  // ── New tests (TDD) ───────────────────────────────────────────────────────

  it("returns high confidence when Claude agrees with 2+ sources", async () => {
    const highConfidenceJudge = { ...CLAUDE_JUDGE_RESPONSE, confidence: "high" };

    globalThis.fetch = mockFetch([
      { match: (u) => u.includes("openfoodfacts.org"), response: OFF_RESPONSE },
      { match: (u) => u.includes("upcitemdb.com"), response: UPC_RESPONSE },
      { match: (u) => u.includes("api.go-upc.com"), response: GOUPC_RESPONSE },
      { match: (u) => u.includes("n8n.test"), response: highConfidenceJudge },
      {
        match: (u) => u.includes("googleapis.com/customsearch"),
        response: GOOGLE_IMAGES_RESPONSE,
      },
    ]);

    const result = await lookupBarcode("012345678901");
    expect(result.confidence).toBe("high");
  });

  it("returns low confidence when all APIs fail AND Claude can not identify", async () => {
    const cannotIdentify = {
      title: "",
      description: "",
      brand: "",
      category: "",
      weight: "",
      dimensions: "",
      averagePrice: "",
      seoTitle: "",
      seoDescription: "",
      confidence: "low",
    };

    globalThis.fetch = mockFetch([
      {
        match: (u) => u.includes("openfoodfacts.org"),
        response: {},
        ok: false,
      },
      { match: (u) => u.includes("upcitemdb.com"), response: {}, ok: false },
      { match: (u) => u.includes("api.go-upc.com"), response: {}, ok: false },
      { match: (u) => u.includes("n8n.test"), response: cannotIdentify },
    ]);

    const result = await lookupBarcode("999999999999");
    expect(result.confidence).toBe("low");
    expect(result.title).toBe("");
  });

  it("calls Google Images when API images are empty", async () => {
    // OFF returns no images, UPC returns no images, GoUPC returns no image
    const offNoImages = {
      status: 1,
      product: {
        product_name: "Test Product",
        brands: "TestBrand",
        categories: "Food",
        quantity: "100g",
        // No image_url / image_front_url
      },
    };
    const upcNoImages = {
      items: [
        {
          title: "Test Product",
          brand: "TestBrand",
          category: "Food",
          images: [], // empty
        },
      ],
    };
    const goupNoImage = {
      product: {
        name: "Test Product",
        brand: "TestBrand",
        // No image field
      },
    };
    const judgeResponse = {
      ...CLAUDE_JUDGE_RESPONSE,
      confidence: "medium",
      title: "Test Product",
    };

    const fetchMock = mockFetch([
      { match: (u) => u.includes("openfoodfacts.org"), response: offNoImages },
      { match: (u) => u.includes("upcitemdb.com"), response: upcNoImages },
      { match: (u) => u.includes("api.go-upc.com"), response: goupNoImage },
      { match: (u) => u.includes("n8n.test"), response: judgeResponse },
      {
        match: (u) => u.includes("googleapis.com/customsearch"),
        response: GOOGLE_IMAGES_RESPONSE,
      },
    ]);
    globalThis.fetch = fetchMock;

    const result = await lookupBarcode("111111111111");

    // Google images should have been called
    const googleCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => (args[0] as string).includes("googleapis.com/customsearch")
    );
    expect(googleCall).toBeDefined();

    // Only images >= 500px wide should be included
    const includedImages = result.images.filter((img) =>
      GOOGLE_IMAGES_RESPONSE.items
        .filter((i) => i.image.width >= 500)
        .map((i) => i.link)
        .includes(img)
    );
    expect(includedImages.length).toBeGreaterThan(0);
  });

  it("uses Claude judged fields over raw API fields", async () => {
    const judgeWithOverride = {
      title: "CLAUDE OVERRIDE TITLE",
      description: "Claude override description",
      brand: "Claude Brand",
      category: "Claude Category",
      weight: "100g",
      dimensions: "",
      averagePrice: "$5.00",
      seoTitle: "SEO title by Claude",
      seoDescription: "SEO description by Claude",
      confidence: "high",
      judgedSource: "OpenFoodFacts",
    };

    globalThis.fetch = mockFetch([
      { match: (u) => u.includes("openfoodfacts.org"), response: OFF_RESPONSE },
      { match: (u) => u.includes("upcitemdb.com"), response: UPC_RESPONSE },
      { match: (u) => u.includes("api.go-upc.com"), response: GOUPC_RESPONSE },
      { match: (u) => u.includes("n8n.test"), response: judgeWithOverride },
      {
        match: (u) => u.includes("googleapis.com/customsearch"),
        response: GOOGLE_IMAGES_RESPONSE,
      },
    ]);

    const result = await lookupBarcode("012345678901");

    expect(result.title).toBe("CLAUDE OVERRIDE TITLE");
    expect(result.brand).toBe("Claude Brand");
    expect(result.category).toBe("Claude Category");
    expect(result.seoTitle).toBe("SEO title by Claude");
  });
});
