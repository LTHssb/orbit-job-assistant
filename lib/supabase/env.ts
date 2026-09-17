export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

const demoRequested = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const demoAllowedInProduction = process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION === "true";

// Demo data is opt-in. Production deployments must explicitly acknowledge that
// they are serving portfolio data instead of authenticated user data.
export const DEMO_MODE = demoRequested && (
  process.env.NODE_ENV !== "production" || demoAllowedInProduction
);

export const DEMO_USER = {
  id: "demo-orbit-user",
  email: "chen.tong@example.com",
  displayName: "陈同学",
  role: "AI 产品 / 算法工程方向",
  graduationYear: "2026",
};

const firstNonEmpty = (...values: Array<string | undefined>) => values.find((value) => Boolean(value?.trim()))?.trim() ?? "";

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}
