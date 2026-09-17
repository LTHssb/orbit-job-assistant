import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "../../../../lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return NextResponse.json({ ok: false, message: "账户服务暂未配置。" }, { status: 503 });
  const { data } = await auth.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false, message: "登录后才能解析简历。" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, message: "请求内容必须是合法 JSON。" }, { status: 400 }); }
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const documentId = typeof input.documentId === "string" ? input.documentId.trim() : "";
  if (!documentId) return NextResponse.json({ ok: false, message: "缺少简历文档 ID。" }, { status: 422 });

  // Keep the heavyweight PDF/DOCX parser out of the anonymous cold-start path.
  const { analyzeStoredResume } = await import("../../../../lib/supabase/resume-analysis");
  const result = await analyzeStoredResume(data.user.id, documentId);
  if (!result.ok) return NextResponse.json(result, { status: 502 });
  return NextResponse.json(result, { status: 200 });
}
