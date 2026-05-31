// @vitest-environment node
//
// Real decode proof. This is the test that every prior iteration skipped:
// it generates an actual retail barcode image and asserts the decode engine
// reads the number back. html5-qrcode (the old engine) fails this for 1D codes;
// ZXing passes it. If this test ever goes red, the scanner cannot read products.
import { describe, it, expect } from "vitest";
import bwipjs from "bwip-js/node";
import { PNG } from "pngjs";
import {
  MultiFormatReader,
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  DecodeHintType,
  BarcodeFormat,
} from "@zxing/library";

async function makeBarcodePng(bcid: string, text: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid,
    text,
    scale: 4,
    height: 14,
    includetext: false,
    paddingwidth: 12,
    paddingheight: 12,
    backgroundcolor: "FFFFFF",
  });
}

function decodeBarcode(png: Buffer): string {
  const img = PNG.sync.read(png);
  const { width, height, data } = img; // RGBA
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    lum[i] = (r * 0.299 + g * 0.587 + b * 0.114) & 0xff;
  }
  const source = new RGBLuminanceSource(lum, width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
  ]);
  return reader.decode(bitmap, hints).getText();
}

// Normalize for comparison: UPC-A round-trips as a 13-char EAN-13 (leading 0).
const norm = (s: string) => s.replace(/^0+/, "");

describe("barcode decode engine (1D retail codes)", () => {
  it("reads an EAN-13 barcode", async () => {
    const png = await makeBarcodePng("ean13", "4006381333931");
    expect(norm(decodeBarcode(png))).toBe(norm("4006381333931"));
  });

  it("reads a UPC-A barcode", async () => {
    const png = await makeBarcodePng("upca", "036000291452");
    expect(norm(decodeBarcode(png))).toBe(norm("036000291452"));
  });

  it("reads an EAN-8 barcode", async () => {
    const png = await makeBarcodePng("ean8", "96385074");
    expect(norm(decodeBarcode(png))).toBe(norm("96385074"));
  });

  it("reads a CODE-128 barcode", async () => {
    const png = await makeBarcodePng("code128", "ABC-12345");
    expect(decodeBarcode(png)).toBe("ABC-12345");
  });
});
