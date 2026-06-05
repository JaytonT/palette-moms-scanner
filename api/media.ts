// Vercel serverless function: upload an image (sent as base64 by the browser)
// into the GHL media library server-side, so the GHL token stays off the client.
// The browser downscales before sending, keeping the JSON body small.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { uploadBase64 } from "./_lib/ghl-server.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const body =
    (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};
  const { imageBase64, mediaType, name } = body as {
    imageBase64?: string;
    mediaType?: string;
    name?: string;
  };
  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  try {
    const result = await uploadBase64(
      imageBase64,
      mediaType ?? "image/jpeg",
      name ?? "photo.jpg"
    );
    if (!result) {
      res.status(502).json({ error: "GHL media upload failed" });
      return;
    }
    res.status(200).json(result); // { id, url }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
