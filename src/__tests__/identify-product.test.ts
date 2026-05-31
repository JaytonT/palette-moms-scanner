// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapVisionToProduct, type VisionResult } from "@/lib/identify-product";

const base: VisionResult = {
  identified: true,
  title: "Bluey Easter Egg Decorating Kit",
  brand: "Bluey",
  category: "Seasonal > Easter",
  description: "Easter egg decorating kit with stickers and stands.",
  weight: "NET WT 0.10 oz (2.7 g)",
  dimensions: "",
  averagePrice: "$5.99",
  barcode: "071653116622",
  seoTitle: "Bluey Easter Egg Decorating Kit",
  seoDescription: "Decorate eggs with Bluey.",
  weightFromPackage: true,
  priceFromLabel: true,
  confidence: "high",
};

describe("mapVisionToProduct", () => {
  it("keeps a scanned barcode over the vision-read one", () => {
    const p = mapVisionToProduct(base, "999999999999");
    expect(p.barcode).toBe("999999999999");
  });

  it("falls back to the vision-read barcode when none was scanned", () => {
    const p = mapVisionToProduct(base);
    expect(p.barcode).toBe("071653116622");
  });

  it("does not tag package-read weight or label-read price as estimates", () => {
    const p = mapVisionToProduct(base);
    expect(p.estimatedFields).not.toContain("weight");
    expect(p.estimatedFields).not.toContain("averagePrice");
  });

  it("tags weight and price as estimates when not read off the package", () => {
    const p = mapVisionToProduct({
      ...base,
      weightFromPackage: false,
      priceFromLabel: false,
    });
    expect(p.estimatedFields).toContain("weight");
    expect(p.estimatedFields).toContain("averagePrice");
  });

  it("forces low confidence when the product was not identified", () => {
    const p = mapVisionToProduct({ ...base, identified: false, confidence: "high" });
    expect(p.confidence).toBe("low");
  });

  it("marks AI-written copy fields as estimates", () => {
    const p = mapVisionToProduct(base);
    expect(p.estimatedFields).toEqual(
      expect.arrayContaining(["description", "category", "seoTitle", "seoDescription"])
    );
    expect(p.dataSource).toBe("ai");
  });
});
