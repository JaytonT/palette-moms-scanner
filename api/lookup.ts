// Vercel serverless function. Runs the barcode enrichment pipeline on the
// server so the third-party APIs (UPCitemdb) and the n8n Claude-judge webhook
// are reached without browser CORS blocking them. The browser was calling these
// directly and every request was silently rejected, leaving the form empty.
//
// Vercel exposes the project's env vars (including VITE_-prefixed ones) to the
// function runtime via process.env, so no new variables are needed.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// .js extension is required: package.json is "type": "module", so the compiled
// function runs as ESM and Node's loader needs the explicit extension. Without
// it the deploy 500s with ERR_MODULE_NOT_FOUND even though the file is present.
import { runBarcodePipeline } from "./_lib/lookup-pipeline.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const barcode =
    (typeof req.query.barcode === "string" && req.query.barcode) ||
    (req.body && typeof req.body === "object" && typeof req.body.barcode === "string"
      ? req.body.barcode
      : "");

  if (!barcode || !/^\d{6,14}$/.test(barcode.trim())) {
    res.status(400).json({ error: "A numeric barcode (6-14 digits) is required" });
    return;
  }

  try {
    const product = await runBarcodePipeline(barcode.trim(), {
      webhookUrl: process.env.VITE_N8N_BARCODE_WEBHOOK ?? "",
      googleApiKey: process.env.VITE_GOOGLE_SEARCH_API_KEY ?? "",
      googleCseId: process.env.VITE_GOOGLE_CSE_ID ?? "",
    });
    res.status(200).json(product);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
}
