import { after, NextResponse } from "next/server";
import type { SourceAdapterKey } from "../../../../lib/source-adapters";
import { createCollectionRun, getActiveSource } from "../../../../lib/supabase/collection-repository";
import { runCollectionTask } from "../../../../lib/sources/task-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return new NextResponse("Unauthorized", { status: 401 });
  const sourceId = new URL(request.url).searchParams.get("sourceId")?.trim();
  if (!sourceId || sourceId.length > 120) return NextResponse.json({ ok: false, message: "缺少有效来源 ID" }, { status: 422 });

  try {
    const source = await getActiveSource(sourceId);
    if (!source?.feed_url) return NextResponse.json({ ok: false, message: "来源不存在或已停用" }, { status: 404 });
    const { run, sourceId: persistedSourceId, cursor } = await createCollectionRun({
      company: source.company,
      url: source.feed_url,
      adapterKey: (source.adapter_key as SourceAdapterKey | null) ?? "generic-public",
      triggerKind: "scheduled",
    });
    after(() => runCollectionTask({
      runId: run.id,
      sourceId: persistedSourceId,
      cursor,
      company: source.company,
      url: source.feed_url as string,
      adapterKey: source.adapter_key ?? "generic-public",
    }).catch(() => undefined));
    return NextResponse.json({ ok: true, taskId: run.id, sourceId: persistedSourceId, stage: "queued" }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "来源任务创建失败" }, { status: 503 });
  }
}
