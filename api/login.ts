// Exchange a staff passphrase for a signed session cookie. No-op (200) when auth
// is unconfigured so the client login prompt never hard-fails on an open deploy.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authEnabled, checkPassphrase, issueSession } from "./_lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  if (!authEnabled()) {
    res.status(200).json({ ok: true, authDisabled: true });
    return;
  }
  const body =
    (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};
  const passphrase = (body as { passphrase?: string }).passphrase ?? "";
  if (!checkPassphrase(passphrase)) {
    res.status(401).json({ error: "invalid passphrase" });
    return;
  }
  issueSession(res);
  res.status(200).json({ ok: true });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
