import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The client attaches the signed-in user's Supabase access token as a Bearer
// header. Mock the supabase wrapper so tests run without a real session.
vi.mock("@/lib/supabase", () => ({
  accessToken: vi.fn(async () => "test-token"),
  authConfigured: false,
  supabase: {},
}));

import {
  findProductByBarcode,
  createProduct,
  restockProduct,
  setProductFeatured,
  activateProduct,
} from "@/lib/ghl";
import type { ProductData } from "@/types/product";

// The client is now thin: every call POSTs to /api/ghl with an `action`. The
// real GHL logic lives in api/_lib/ghl-server.ts and is verified against the
// live API. These tests lock the request shaping + response mapping.

const SAMPLE_PRODUCT: ProductData = {
  barcode: "012345678901",
  title: "Test Product",
  description: "A test product",
  brand: "TestBrand",
  category: "Food",
  weight: "100g",
  dimensions: "",
  images: ["https://example.com/img.jpg"],
  averagePrice: "$9.99",
  seoTitle: "Test Product SEO",
  seoDescription: "Test product SEO description",
  quantity: 5,
  slocCode: "TST-001",
  isFeatured: false,
  estimatedFields: [],
  dataSource: "api",
  confidence: "high",
};

function mockFetch(response: unknown, ok = true, status = 200) {
  return vi.fn(() =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    })
  ) as unknown as typeof fetch;
}

function lastBody(f: typeof fetch) {
  const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return JSON.parse(calls[0][1].body as string);
}

describe("ghl client (server-routed)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("createProduct posts action=create and returns productId", async () => {
    const f = mockFetch({ productId: "p1" });
    globalThis.fetch = f;
    const id = await createProduct(SAMPLE_PRODUCT, false);
    expect(id).toBe("p1");
    const [url] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/ghl");
    const body = lastBody(f);
    expect(body.action).toBe("create");
    expect(body.availableInStore).toBe(false);
    expect(body.product.title).toBe("Test Product");
  });

  it("findProductByBarcode returns null when server returns null", async () => {
    globalThis.fetch = mockFetch(null);
    expect(await findProductByBarcode("999")).toBeNull();
  });

  it("findProductByBarcode maps a found product", async () => {
    globalThis.fetch = mockFetch({ productId: "p1", name: "N", currentQuantity: 5 });
    const r = await findProductByBarcode("012345678901");
    expect(r?.productId).toBe("p1");
    expect(r?.currentQuantity).toBe(5);
  });

  it("restockProduct posts action=restock and returns newQuantity", async () => {
    const f = mockFetch({ productId: "p1", newQuantity: 9 });
    globalThis.fetch = f;
    const total = await restockProduct("012345678901", 4);
    expect(total).toBe(9);
    const body = lastBody(f);
    expect(body.action).toBe("restock");
    expect(body.addQuantity).toBe(4);
  });

  it("restockProduct throws when product not found", async () => {
    globalThis.fetch = mockFetch(null);
    await expect(restockProduct("012345678901", 1)).rejects.toThrow();
  });

  it("setProductFeatured posts action=feature", async () => {
    const f = mockFetch({ ok: true });
    globalThis.fetch = f;
    await setProductFeatured("p1", true);
    const body = lastBody(f);
    expect(body.action).toBe("feature");
    expect(body.productId).toBe("p1");
    expect(body.isFeatured).toBe(true);
  });

  it("activateProduct posts action=activate", async () => {
    const f = mockFetch({ ok: true });
    globalThis.fetch = f;
    await activateProduct("p1");
    const body = lastBody(f);
    expect(body.action).toBe("activate");
    expect(body.productId).toBe("p1");
  });

  it("throws on a non-ok response", async () => {
    globalThis.fetch = mockFetch({ error: "boom" }, false, 502);
    await expect(createProduct(SAMPLE_PRODUCT)).rejects.toThrow("boom");
  });

  it("attaches the Supabase access token as a Bearer header", async () => {
    const f = mockFetch({ productId: "p1" });
    globalThis.fetch = f;
    await createProduct(SAMPLE_PRODUCT);
    const headers = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });
});
