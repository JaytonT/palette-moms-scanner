// Vercel serverless function. Runs on the server, so ANTHROPIC_API_KEY stays
// out of the browser bundle. Receives a product photo (base64) and returns
// catalog fields read off the packaging by Claude vision.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";

const ProductSchema = z.object({
  identified: z.boolean(),
  title: z.string(),
  brand: z.string(),
  category: z.string(),
  description: z.string(),
  weight: z.string(),
  dimensions: z.string(),
  averagePrice: z.string(),
  barcode: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  weightFromPackage: z.boolean(),
  priceFromLabel: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
});

const SYSTEM = `You catalog physical retail products for a store's online shop from a photo of the packaging.

Rules:
- Read text directly off the package. Use the exact product name and brand as printed. Do not invent a product you cannot see.
- weight: if a net weight or volume is printed (e.g. "2.3 fl oz (68 mL)", "NET WT 0.10 oz (2.7 g)"), copy it verbatim and set weightFromPackage true. If it is not visible, give a reasonable estimate and set weightFromPackage false.
- averagePrice: if a price sticker or printed price is visible, read it and set priceFromLabel true. Otherwise estimate a typical US retail price for this type of item, formatted like "$5.99", and set priceFromLabel false. You do NOT have live market data, so a non-label price is a rough guess.
- barcode: if a barcode's digits are clearly legible in the photo, return just the digits, else "".
- category: a short retail category path, e.g. "Seasonal > Easter", "Toys > Outdoor Play", "Bath & Body". If a list of allowed categories is provided in the user message, choose the closest one from that list.
- description, seoTitle, seoDescription: concise, accurate copy based only on what is visible.
- If you cannot tell what the product is, set identified false, confidence low, and leave uncertain fields empty.
- confidence: "high" only when the product name and brand are clearly legible.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};
  const { imageBase64, mediaType, barcode, allowedCategories } = body as {
    imageBase64?: string;
    mediaType?: string;
    barcode?: string;
    allowedCategories?: string[];
  };
  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  const client = new Anthropic({ apiKey });
  const hints: string[] = ["Identify this retail product and return catalog fields."];
  if (barcode) hints.push(`Its scanned barcode is ${barcode}.`);
  if (allowedCategories?.length) {
    hints.push(`Choose category from this list only: ${allowedCategories.join(", ")}.`);
  }

  try {
    const response = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "disabled" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: (mediaType as "image/jpeg" | "image/png") ?? "image/jpeg",
                data: imageBase64,
              },
            },
            { type: "text", text: hints.join(" ") },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ProductSchema) },
    });

    if (!response.parsed_output) {
      res.status(502).json({ error: "Vision response did not match schema" });
      return;
    }
    res.status(200).json(response.parsed_output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
