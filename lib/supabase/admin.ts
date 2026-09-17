import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for ingestion writes.
 * Never import this module from a Client Component or expose its key through
 * a NEXT_PUBLIC_* variable.
 */
export function createSupabaseAdminClient() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
