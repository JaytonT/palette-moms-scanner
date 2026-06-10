// Supabase browser client for staff user-level auth. The anon key is safe in the
// bundle (it only permits what RLS allows); the session (access + refresh token)
// is persisted in localStorage and auto-refreshed. The access token is sent to
// our write endpoints (api/ghl, api/media), which verify it server-side.
import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

// True when both env vars are present at build time. When false (local dev with
// no Supabase configured), the app skips the login gate and the server endpoints
// run open for dev only — a real Vercel deploy without these fails closed.
export const authConfigured = url.length > 0 && anonKey.length > 0;

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/** Current access token for Authorization: Bearer on API calls, or "" if none. */
export async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}
