import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "../../../../lib/supabase/auth-server";
import { storeResumeUpload } from "../../../../lib/supabase/resume-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return NextResponse.json({ ok: false, message: "账户服务暂未配置。" }, { status: 503 });
  const { data } = await auth.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false, message: "登录后才能保存简历。" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, message: "上传内容无法读取，请重新选择文件。" }, { status: 400 });
  }
  const entry = formData.get("file");
  if (!(entry instanceof File)) return NextResponse.json({ ok: false, message: "请选择一份简历文件。" }, { status: 400 });

  const result = await storeResumeUpload({ userId: data.user.id, file: entry });
  if (!result.configured) return NextResponse.json({ ok: false, message: result.message }, { status: 503 });
  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  return NextResponse.json({ ok: true, documentId: result.documentId, status: result.status, originalName: result.originalName, byteSize: result.byteSize, message: "简历已安全保存到你的账户，正在进入解析。" }, { status: 201 });
}
