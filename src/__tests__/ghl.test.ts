import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findProductByBarcode,
  createProduct,
  updateProductQuantity,
  setProductFeatured,
  uploadImage,
} from "@/lib/ghl";
import type { ProductData } from "@/types/product";

const BASE = "https://services.leadconnectorhq.com";

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
  skuCode: "TST-001",
  isFeatured: false,
  estimatedFields: [],
  dataSource: "api",
  confidence: "high",
};

function makeFetch(response: unknown, ok = true, status = 200) {
  return vi.fn(() =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    })
  ) as unknown as typeof fetch;
}

describe("findProductByBarcode", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns null when barcode is not found", async () => {
    globalThis.fetch = makeFetch({ products: [] });
    const result = await findProductByBarcode("999999999999");
    expect(result).toBeNull();
  });

  it("returns product with currentQuantity when barcode matches statementDescriptor", async () => {
    globalThis.fetch = makeFetch({
      products: [
        {
          _id: "prod_abc",
          name: "Test Product",
          statementDescriptor: "012345678901",
          variants: [{ id: "var_1", availableQuantity: 10 }],
        },
      ],
    });

    const result = await findProductByBarcode("012345678901");
    expect(result).not.toBeNull();
    expect(result?.product._id).toBe("prod_abc");
    expect(result?.currentQuantity).toBe(10);
  });

  it("returns product when barcode matches variant SKU", async () => {
    globalThis.fetch = makeFetch({
      products: [
        {
          _id: "prod_xyz",
          name: "Another Product",
          statementDescriptor: "DIFFERENT",
          variants: [
            { id: "var_2", sku: "012345678901", availableQuantity: 3 },
          ],
        },
      ],
    });

    const result = await findProductByBarcode("012345678901");
    expect(result).not.toBeNull();
    expect(result?.product._id).toBe("prod_xyz");
    expect(result?.currentQuantity).toBe(3);
  });

  it("throws on non-ok GHL response", async () => {
    globalThis.fetch = makeFetch({}, false, 500);
    await expect(findProductByBarcode("123")).rejects.toThrow(
      "GHL fetch products failed"
    );
  });
});

describe("createProduct", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts product and returns _id", async () => {
    const fetchMock = makeFetch({ product: { _id: "new_prod_id" } });
    globalThis.fetch = fetchMock;

    const id = await createProduct(SAMPLE_PRODUCT);
    expect(id).toBe("new_prod_id");

    const [url, options] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/products/`);
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string);
    expect(body.name).toBe("Test Product");
    expect(body.availableInStore).toBe(true);
  });

  it("sets availableInStore=false when passed false", async () => {
    const fetchMock = makeFetch({ product: { _id: "review_prod_id" } });
    globalThis.fetch = fetchMock;

    await createProduct(SAMPLE_PRODUCT, false);

    const [, options] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.availableInStore).toBe(false);
  });

  it("throws on failed GHL create", async () => {
    globalThis.fetch = makeFetch({ error: "bad" }, false, 400);
    await expect(createProduct(SAMPLE_PRODUCT)).rejects.toThrow(
      "GHL create product failed"
    );
  });
});

describe("updateProductQuantity", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends PUT with correct variant quantity", async () => {
    const fetchMock = makeFetch({});
    globalThis.fetch = fetchMock;

    await updateProductQuantity("prod_abc", "var_1", 15);

    const [url, options] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("prod_abc");
    expect(options.method).toBe("PUT");

    const body = JSON.parse(options.body as string);
    expect(body.variants[0].id).toBe("var_1");
    expect(body.variants[0].availableQuantity).toBe(15);
  });
});

describe("setProductFeatured", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends PUT with isFeatured flag", async () => {
    const fetchMock = makeFetch({});
    globalThis.fetch = fetchMock;

    await setProductFeatured("prod_abc", true);

    const [url, options] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("prod_abc");
    expect(options.method).toBe("PUT");

    const body = JSON.parse(options.body as string);
    expect(body.isFeatured).toBe(true);
  });
});

describe("uploadImage", () => {
  it("POSTs file to /medias/upload-file and returns the hosted URL", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://ghl-cdn.example/abc.jpg" }),
    } as any);

    const fakeFile = new File(["fake-image-data"], "test.jpg", { type: "image/jpeg" });
    const url = await uploadImage(fakeFile);
    expect(url).toBe("https://ghl-cdn.example/abc.jpg");

    const [endpoint, options] = (global.fetch as any).mock.calls[0];
    expect(endpoint).toContain("/medias/upload-file");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
  });

  it("throws on non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      text: async () => "File too large",
    } as any);

    const fakeFile = new File(["x"], "big.jpg", { type: "image/jpeg" });
    await expect(uploadImage(fakeFile)).rejects.toThrow(/413/);
  });
});
