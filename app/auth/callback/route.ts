import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "../../../lib/supabase/auth-server";

const DEFAULT_REDIRECT = "/account";

function getSafeRedirectPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_REDIRECT;
  }

  return value;
}

function redirectToAuth(url: URL, error: string) {
  const authUrl = new URL("/auth", url.origin);
  authUrl.searchParams.set("error", error);
  return NextResponse.redirect(authUrl);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = getSafeRedirectPath(url.searchParams.get("next"));

  if (!code) return redirectToAuth(url, "missing_code");

  const supabase = await createSupabaseAuthServerClient();

  if (!supabase) return redirectToAuth(url, "service_unavailable");

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirectToAuth(url, "exchange_failed");

  return NextResponse.redirect(new URL(next, url.origin));
}
