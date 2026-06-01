// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapVisionToProduct, type VisionResult } from "@/lib/identify-product";

const base: VisionResult = {
  identified: true,
  title: "Bluey Easter Egg Decorating Kit",
  brand: "Bluey",
  category: "Seasonal > Easter",
  description: "Easter egg decorating kit with stickers and stands.",
  weightLbs: 0.35,
  weightFromPackage: true,
  heightInches: 9,
  lengthInches: 7,
  depthInches: 1,
  averagePrice: "$5.99",
  priceFromLabel: true,
  barcode: "071653116622",
  seoTitle: "Bluey Easter Egg Decorating Kit",
  seoDescription: "Decorate eggs with Bluey.",
  confidence: "high",
};

describe("mapVisionToProduct", () => {
  it("keeps a scanned barcode over the vision-read one", () => {
    expect(mapVisionToProduct(base, "999999999999").barcode).toBe("999999999999");
  });

  it("falls back to the vision-read barcode when none was scanned", () => {
    expect(mapVisionToProduct(base).barcode).toBe("071653116622");
  });

  it("formats weight in pounds and dimensions in inches", () => {
    const p = mapVisionToProduct(base);
    expect(p.weight).toBe("0.35 lb");
    expect(p.dimensions).toBe("9 x 7 x 1 in");
  });

  it("does not tag package-read weight or label-read price as estimates", () => {
    const p = mapVisionToProduct(base);
    expect(p.estimatedFields).not.toContain("weight");
    expect(p.estimatedFields).not.toContain("averagePrice");
  });

  it("tags weight and price as estimates when not read off the package/label", () => {
    const p = mapVisionToProduct({ ...base, weightFromPackage: false, priceFromLabel: false });
    expect(p.estimatedFields).toContain("weight");
    expect(p.estimatedFields).toContain("averagePrice");
  });

  it("always tags dimensions as an estimate (never printed)", () => {
    expect(mapVisionToProduct(base).estimatedFields).toContain("dimensions");
  });

  it("leaves weight/dimensions blank when vision returns zeros", () => {
    const p = mapVisionToProduct({
      ...base,
      weightLbs: 0,
      heightInches: 0,
      lengthInches: 0,
      depthInches: 0,
    });
    expect(p.weight).toBe("");
    expect(p.dimensions).toBe("");
  });

  it("forces low confidence when the product was not identified", () => {
    expect(mapVisionToProduct({ ...base, identified: false, confidence: "high" }).confidence).toBe("low");
  });
});
