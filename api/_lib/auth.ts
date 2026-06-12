// User-level auth for the write endpoints (api/ghl, api/media). The browser sends
// the signed-in staff user's Supabase access token as `Authorization: Bearer`.
// We verify it against Supabase's auth server (alg-agnostic, no JWT secret to
// manage). A valid Supabase user = allowed.
//
// Enforced when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set. If they are
// unset, auth is open ONLY for local dev (no VERCEL_ENV); any real Vercel deploy
// fails CLOSED (503) so a push that forgot the Supabase config cannot silently
// expose the write endpoints.
import type { VercelRequest, VercelResponse } from "@vercel/node";

function supabaseUrl(): string {
  return (process.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
}
function supabaseAnonKey(): string {
  return process.env.VITE_SUPABASE_ANON_KEY ?? "";
}

/** Auth is enforced only when the Supabase project is configured. */
export function authEnabled(): boolean {
  return supabaseUrl().length > 0 && supabaseAnonKey().length > 0;
}

function bearer(req: VercelRequest): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

// Optional staff allowlist. Public signup is on for the project, so this is the
// hard gate: when set, only these emails may write. Unset = any authenticated
// Supabase user is allowed.
function allowedEmails(): string[] {
  return (process.env.SCANNER_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Resolve the access token to its Supabase user. Returns the user (with email)
// or null. Works for HS256 (legacy) and asymmetric (new) signing keys.
async function getUser(token: string): Promise<{ email?: string } | null> {
  if (!token) return null;
  try {
    const res = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey() },
    });
    if (!res.ok) return null;
    return (await res.json()) as { email?: string };
  } catch {
    return null;
  }
}

/**
 * Gate the write endpoints (api/ghl, api/media).
 *
 * - Configured  -> require a valid Supabase user access token; 401 otherwise
 *   (AuthGate in the app handles sign-in / refresh).
 * - Unconfigured on a real Vercel deploy -> fail CLOSED (503).
 * - Unconfigured with no VERCEL_ENV (local dev) -> open.
 */
export async function requireSession(
  req: VercelRequest,
  res: VercelResponse
): Promise<boolean> {
  if (!authEnabled()) {
    if (process.env.VERCEL_ENV) {
      res.status(503).json({ error: "Auth not configured" });
      return false;
    }
    return true; // local dev only
  }
  const user = await getUser(bearer(req));
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  const allow = allowedEmails();
  if (allow.length > 0 && !allow.includes((user.email ?? "").toLowerCase())) {
    res.status(403).json({ error: "Not authorized" });
    return false;
  }
  return true;
}
