import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./env";

/**
 * Server-side read client. It intentionally uses the publishable/anon key and
 * therefore remains constrained by Postgres RLS. Admin writes belong in the
 * collector worker, never in a browser bundle.
 */
export function createSupabaseReadClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
