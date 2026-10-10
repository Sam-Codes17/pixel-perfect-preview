// SERVER-SIDE ONLY — never import this in client code or VITE_* files
// The service role key bypasses Row Level Security — use with care.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env["VITE_SUPABASE_URL"]!;
const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing server-side Supabase env vars. Check VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/** Validate a user's access token and return their user record. Throws if invalid. */
export async function requireAuth(accessToken: string) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !user) {
    throw new Error("UNAUTHORIZED: Invalid or expired token");
  }
  return user;
}
