import { after, NextResponse } from "next/server";
import { getSourceAdapter } from "../../../../lib/source-adapters";
import { validatePublicUrl } from "../../../../lib/source-import";
import { createSupabaseAuthServerClient } from "../../../../lib/supabase/auth-server";
import { createCollectionRun } from "../../../../lib/supabase/collection-repository";
import { getOwnedSource, linkUserSource } from "../../../../lib/supabase/user-source-repository";
import { runCollectionTask } from "../../../../lib/sources/task-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function response(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function PATCH(request: Request) {
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return response(503, { ok: false, message: "账户服务暂未配置" });
  const { data: userData } = await auth.auth.getUser();
  if (!userData.user) return response(401, { ok: false, message: "登录后才能管理自己的招聘来源" });
  let body: unknown;
  try { body = await request.json(); } catch { return response(400, { ok: false, message: "请求内容必须是合法 JSON" }); }
  if (!body || typeof body !== "object") return response(400, { ok: false, message: "请求内容必须是对象" });
  const input = body as Record<string, unknown>;
  const sourceId = typeof input.sourceId === "string" ? input.sourceId.trim() : "";
  const action = input.action === "retry" ? "retry" : input.action === "active" ? "active" : "";
  if (!sourceId || !action) return response(422, { ok: false, message: "缺少有效的来源操作" });
  try {
    const owned = await getOwnedSource({ userId: userData.user.id, sourceId });
    if (!owned) return response(404, { ok: false, message: "来源不存在或不属于当前账户" });
    if (action === "active") {
      const active = input.active === true;
      const result = await auth.from("user_sources").update({ is_active: active, updated_at: new Date().toISOString() }).eq("user_id", userData.user.id).eq("source_id", sourceId).select("source_id,is_active").single();
      if (result.error || !result.data) return response(500, { ok: false, message: "来源状态更新失败，请稍后重试" });
      return response(200, { ok: true, sourceId, active: result.data.is_active, message: active ? "来源已恢复观测" : "来源已停用，仅影响当前账户" });
    }
    if (!owned.is_active) return response(409, { ok: false, message: "请先恢复来源，再执行重试" });
    const url = owned.feed_url || owned.homepage_url;
    if (!url) return response(422, { ok: false, message: "来源缺少可重试的官网地址" });
    const parsed = await validatePublicUrl(url);
    const adapter = getSourceAdapter(parsed);
    const { run, sourceId: linkedSourceId, cursor } = await createCollectionRun({ company: owned.company || owned.display_name, url: parsed.href, adapterKey: adapter.key, triggerKind: "manual" });
    await linkUserSource({ userId: userData.user.id, sourceId: linkedSourceId, displayName: owned.display_name, taskId: run.id });
    after(() => runCollectionTask({ runId: run.id, sourceId: linkedSourceId, cursor, company: owned.company || owned.display_name, url: parsed.href, adapterKey: adapter.key }).catch(() => undefined));
    return response(202, { ok: true, taskId: run.id, sourceId: linkedSourceId, message: "重试任务已创建，正在后台更新岗位" });
  } catch (error) {
    return response(503, { ok: false, message: error instanceof Error ? error.message : "来源操作失败" });
  }
}

export async function GET() {
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return response(503, { ok: false, message: "账户服务暂未配置" });
  const { data: userData } = await auth.auth.getUser();
  if (!userData.user) return response(401, { ok: false, message: "登录后才能查看自己的招聘来源" });
  const { data, error } = await auth.from("user_sources").select("source_id,display_name,is_active,last_task_id,updated_at").eq("user_id", userData.user.id).order("updated_at", { ascending: false });
  if (error) return response(503, { ok: false, message: "来源列表读取失败，请稍后重试" });
  return response(200, { ok: true, sources: data ?? [] });
}
