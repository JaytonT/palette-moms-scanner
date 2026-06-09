// Session auth for the write endpoints (api/ghl, api/media). A staff passphrase
// is exchanged at /api/login for a signed, HttpOnly cookie; write handlers call
// requireSession(). The passphrase + signing secret live only in function env,
// never in the browser bundle.
//
// Enforced when SCANNER_PASSPHRASE + SCANNER_SECRET are set. If they are unset,
// auth is open ONLY for local dev (no VERCEL_ENV); any real Vercel deploy fails
// CLOSED (503) so a production/preview push that forgot the secrets cannot
// silently expose the write endpoints.
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

/** Validate the signed HttpOnly session cookie (`exp.sig`, HMAC over exp). */
function validCookie(req: VercelRequest): boolean {
  const header = req.headers.cookie ?? "";
  const entry = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!entry) return false;
  const value = entry.slice(COOKIE.length + 1);
  const dot = value.lastIndexOf(".");
  if (dot < 0) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!safeEqualHex(sig, sign(exp))) return false;
  const expMs = Number(exp);
  return Number.isFinite(expMs) && expMs > Date.now();
}

/**
 * Gate the write endpoints (api/ghl, api/media).
 *
 * - Secrets set  -> require a valid signed session cookie; 401 otherwise (the
 *   client then prompts for the passphrase, hits /api/login, and retries).
 * - Secrets unset on a real Vercel deploy -> fail CLOSED (503): a push that
 *   forgot SCANNER_PASSPHRASE/SCANNER_SECRET must not silently expose writes.
 * - Secrets unset with no VERCEL_ENV (local dev) -> open.
 *
 * The 2026-06-07 owner-authorized open test window is over (beta clients incoming);
 * Admin/Manager/User role gating is still tracked separately, but writes are no
 * longer unauthenticated.
 */
export function requireSession(req: VercelRequest, res: VercelResponse): boolean {
  if (!authEnabled()) {
    if (process.env.VERCEL_ENV) {
      res.status(503).json({ error: "Auth not configured" });
      return false;
    }
    return true; // local dev only
  }
  if (validCookie(req)) return true;
  res.status(401).json({ error: "Authentication required" });
  return false;
}
