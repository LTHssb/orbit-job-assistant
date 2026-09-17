import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "../../../../lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return NextResponse.json({ ok: false, message: "账户服务暂未配置。" }, { status: 503 });
  const { data } = await auth.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false, message: "登录后才能读取自己的简历。" }, { status: 401 });

  const result = await auth.from("resume_documents").select("id,original_name,mime_type,byte_size,status,analysis,parser_error,created_at,updated_at").eq("user_id", data.user.id).order("updated_at", { ascending: false }).limit(10);
  if (result.error) return NextResponse.json({ ok: false, message: "简历历史读取失败，请稍后重试。" }, { status: 503 });
  return NextResponse.json({ ok: true, documents: result.data ?? [] }, { status: 200 });
}
