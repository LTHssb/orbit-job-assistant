import { NextResponse } from "next/server";
import { importSource } from "../../../../lib/source-import";
import { persistImportedJobs } from "../../../../lib/supabase/import-repository";
import { createSupabaseAuthServerClient } from "../../../../lib/supabase/auth-server";
import { linkUserSource } from "../../../../lib/supabase/user-source-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failure = (status: number, message: string, source: { company: string; url: string } = { company: "", url: "" }) => NextResponse.json({
  ok: false, jobs: [], source, attempts: [], method: "none", stage: "validation", message,
}, { status });

export async function POST(request: Request) {
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return failure(503, "账户服务暂未配置");
  const { data: userData } = await auth.auth.getUser();
  if (!userData.user) return failure(401, "登录后才能添加并同步招聘来源");
  let body: unknown;
  try { body = await request.json(); } catch { return failure(400, "请求内容必须是合法 JSON"); }
  if (!body || typeof body !== "object") return failure(400, "请求内容必须是对象");
  const input = body as Record<string, unknown>;
  const company = typeof input.company === "string" ? input.company.trim() : "";
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!company || company.length > 100) return failure(422, "请填写 1-100 个字符的公司名称", { company, url });
  if (!url || url.length > 2048) return failure(422, "请填写不超过 2048 个字符的招聘官网地址", { company, url });
  try {
    const imported = await importSource(company, url);
    let persistence;
    try {
      persistence = await persistImportedJobs({ company, url, jobs: imported.jobs, attempts: imported.attempts, adapterKey: imported.adapterKey });
    } catch (error) {
      persistence = { configured: true, persisted: false, sourceId: null, jobs: 0, message: error instanceof Error ? error.message : "Supabase 持久化失败" };
    }
    if (persistence.sourceId && persistence.persisted) {
      await linkUserSource({ userId: userData.user.id, sourceId: persistence.sourceId, displayName: company });
    }
    return NextResponse.json({ ...imported, persistence, message: imported.ok ? `${imported.message}；${persistence.message}` : imported.message });
  } catch (error) {
    return NextResponse.json({ ok: false, jobs: [], source: { company, url }, attempts: [], method: "none", stage: "fetch", message: error instanceof Error ? error.message : "来源导入失败" }, { status: 502 });
  }
}
