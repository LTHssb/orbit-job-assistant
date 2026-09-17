import { NextResponse } from "next/server";
import { listActiveSources } from "../../../../lib/supabase/collection-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const sources = await listActiveSources();
    const endpoint = new URL("/api/cron/source", request.url);
    const secret = process.env.CRON_SECRET as string;
    const dispatches = await Promise.all(sources.filter((source) => source.feed_url).map(async (source) => {
      try {
        const response = await fetch(`${endpoint.href}?sourceId=${encodeURIComponent(source.id)}`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({})) as { taskId?: string; message?: string };
        return {
          company: source.company,
          sourceId: source.id,
          status: response.ok ? "queued" : "failed",
          taskId: body.taskId,
          error: response.ok ? undefined : body.message || `来源任务派发失败（HTTP ${response.status}）`,
        };
      } catch (error) {
        return {
          company: source.company,
          sourceId: source.id,
          status: "failed",
          error: error instanceof Error ? error.message : "来源任务派发失败",
        };
      }
    }));
    const failed = dispatches.filter((item) => item.status === "failed").length;
    return NextResponse.json({
      ok: failed === 0,
      queued: dispatches.length - failed,
      failed,
      dispatches,
      ranAt: new Date().toISOString(),
    }, { status: failed === 0 ? 202 : 207 });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "来源刷新失败" }, { status: 500 });
  }
}
