import { after, NextResponse } from "next/server";
import { getSourceAdapter } from "../../../../lib/source-adapters";
import { validatePublicUrl } from "../../../../lib/source-import";
import { createCollectionRun, getCollectionRun } from "../../../../lib/supabase/collection-repository";
import { createSupabaseAuthServerClient } from "../../../../lib/supabase/auth-server";
import { linkUserSource, userOwnsCollectionRun } from "../../../../lib/supabase/user-source-repository";
import { runCollectionTask } from "../../../../lib/sources/task-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const errorResponse = (status: number, message: string) => NextResponse.json({ ok: false, message }, { status });

export async function POST(request: Request) {
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return errorResponse(503, "账户服务暂未配置");
  const { data: userData } = await auth.auth.getUser();
  if (!userData.user) return errorResponse(401, "登录后才能添加并同步招聘来源");
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse(400, "请求内容必须是合法 JSON"); }
  if (!body || typeof body !== "object") return errorResponse(400, "请求内容必须是对象");
  const input = body as Record<string, unknown>;
  const company = typeof input.company === "string" ? input.company.trim() : "";
  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  if (!company || company.length > 100) return errorResponse(422, "请填写 1-100 个字符的公司名称");
  if (!rawUrl || rawUrl.length > 2048) return errorResponse(422, "请填写不超过 2048 个字符的招聘官网地址");

  try {
    const url = await validatePublicUrl(rawUrl);
    const adapter = getSourceAdapter(url);
    const { run, sourceId, cursor } = await createCollectionRun({ company, url: url.href, adapterKey: adapter.key, triggerKind: "manual" });
    await linkUserSource({ userId: userData.user.id, sourceId, displayName: company, taskId: run.id });
    after(() => runCollectionTask({ runId: run.id, sourceId, cursor, company, url: url.href, adapterKey: adapter.key }).catch(() => undefined));
    return NextResponse.json({
      ok: true,
      taskId: run.id,
      sourceId,
      stage: "queued",
      adapterKey: adapter.key,
      adapterStatus: adapter.status,
      adapterNote: adapter.note,
      message: "采集任务已创建，正在后台识别官网岗位",
    }, { status: 202 });
  } catch (error) {
    return errorResponse(503, error instanceof Error ? error.message : "采集任务创建失败");
  }
}

export async function GET(request: Request) {
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return errorResponse(503, "账户服务暂未配置");
  const { data: userData } = await auth.auth.getUser();
  if (!userData.user) return errorResponse(401, "登录后才能查看来源采集任务");
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id || id.length > 80) return errorResponse(422, "缺少有效的任务 ID");
  try {
    if (!await userOwnsCollectionRun(id, userData.user.id)) return errorResponse(404, "采集任务不存在或不属于当前账户");
    const run = await getCollectionRun(id);
    if (!run) return errorResponse(404, "采集任务不存在或已过期");
    return NextResponse.json({
      ok: true,
      taskId: run.id,
      stage: run.status,
      status: run.status,
      fetchedCount: run.fetched_count,
      acceptedCount: run.accepted_count,
      rejectedCount: run.rejected_count,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      error: run.error,
      stats: run.stats,
      message: run.status === "running" ? "正在识别并写入岗位" : run.status === "succeeded" ? "岗位识别与写入已完成" : run.error || "任务已完成，但需要复核结果",
    });
  } catch (error) {
    return errorResponse(503, error instanceof Error ? error.message : "采集任务查询失败");
  }
}
