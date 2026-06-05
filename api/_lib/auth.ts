// Session auth for the write endpoints (api/ghl, api/media). A staff passphrase
// is exchanged at /api/login for a signed, HttpOnly cookie; write handlers call
// requireSession(). The passphrase + signing secret live only in function env,
// never in the browser bundle.
//
// Fail-open when UNCONFIGURED: if SCANNER_PASSPHRASE or SCANNER_SECRET is unset,
// auth is a no-op so a deploy can't lock staff out of the live scanner. Set both
// env vars in Vercel to enforce it.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "pm_session";

function secret(): string { return process.env.SCANNER_SECRET ?? ""; }
function passphrase(): string { return process.env.SCANNER_PASSPHRASE ?? ""; }

/** Auth is enforced only when BOTH env vars are present. */
export function authEnabled(): boolean {
  return passphrase().length > 0 && secret().length > 0;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

export function issueSession(res: VercelResponse, days = 30): void {
  const exp = Date.now() + days * 86_400_000;
  const value = `${exp}.${sign(String(exp))}`;
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${days * 86_400}`
  );
}

/** Constant-time passphrase check (compares HMACs, so no length leak). */
export function checkPassphrase(input: string): boolean {
  if (!passphrase()) return false;
  return safeEqualHex(sign(input), sign(passphrase()));
}

function validCookie(req: VercelRequest): boolean {
  const raw = req.headers.cookie ?? "";
  const part = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!part) return false;
  const value = part.slice(COOKIE.length + 1);
  const dot = value.lastIndexOf(".");
  if (dot < 0) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!safeEqualHex(sig, sign(exp))) return false;
  const expNum = Number(exp);
  return Number.isFinite(expNum) && expNum > Date.now();
}

/** Returns true if the request may proceed; otherwise writes 401 and returns false. */
export function requireSession(req: VercelRequest, res: VercelResponse): boolean {
  if (!authEnabled()) return true; // unconfigured = open, never lock out staff
  if (validCookie(req)) return true;
  res.status(401).json({ error: "unauthorized" });
  return false;
}
