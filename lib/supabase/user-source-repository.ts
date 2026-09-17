import { createSupabaseAdminClient } from "./admin";

function requireClient() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("未配置 Supabase 服务端密钥");
  return client;
}

export async function linkUserSource(input: { userId: string; sourceId: string; displayName: string; taskId?: string }) {
  const client = requireClient();
  const result = await client.from("user_sources").upsert({
    user_id: input.userId,
    source_id: input.sourceId,
    display_name: input.displayName,
    is_active: true,
    last_task_id: input.taskId || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,source_id" });
  if (result.error) throw new Error(`用户来源绑定失败：${result.error.message}`);
}

export async function userOwnsCollectionRun(runId: string, userId: string) {
  const client = requireClient();
  const run = await client.from("collection_runs").select("source_id").eq("id", runId).maybeSingle();
  if (run.error) throw new Error(`任务归属查询失败：${run.error.message}`);
  if (!run.data?.source_id) return false;
  const link = await client.from("user_sources").select("id").eq("user_id", userId).eq("source_id", run.data.source_id).eq("is_active", true).maybeSingle();
  if (link.error) throw new Error(`来源归属查询失败：${link.error.message}`);
  return Boolean(link.data?.id);
}

export async function getOwnedSource(input: { userId: string; sourceId: string }) {
  const client = requireClient();
  const link = await client.from("user_sources").select("source_id,display_name,is_active").eq("user_id", input.userId).eq("source_id", input.sourceId).maybeSingle();
  if (link.error) throw new Error(`用户来源读取失败：${link.error.message}`);
  if (!link.data) return null;
  const source = await client.from("job_sources").select("id,company,homepage_url,feed_url,adapter_key").eq("id", input.sourceId).maybeSingle();
  if (source.error) throw new Error(`来源详情读取失败：${source.error.message}`);
  if (!source.data) return null;
  return { ...link.data, ...source.data };
}
