import type { SourceAdapterKey } from "../source-adapters";
import type { SourceCollectionCursor } from "../source-import";
import { createSupabaseAdminClient } from "./admin";
import { sourceIdFor } from "./import-repository";

export type CollectionRunStatus = "running" | "succeeded" | "partial" | "failed";

export type CollectionRun = {
  id: string;
  source_id: string | null;
  status: CollectionRunStatus;
  trigger_kind: "scheduled" | "manual" | "webhook";
  started_at: string;
  finished_at: string | null;
  fetched_count: number;
  accepted_count: number;
  rejected_count: number;
  error: string | null;
  stats: Record<string, unknown>;
};

function requireClient() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("未配置 Supabase 服务端密钥");
  return client;
}

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readCursor(value: unknown): SourceCollectionCursor {
  const cursor = metadataRecord(value).collectionCursor;
  const page = cursor && typeof cursor === "object" && !Array.isArray(cursor) ? Number((cursor as Record<string, unknown>).page) : 1;
  return { page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1 };
}

export async function createCollectionRun(input: {
  company: string;
  url: string;
  adapterKey?: SourceAdapterKey;
  triggerKind?: "scheduled" | "manual" | "webhook";
}) {
  const client = requireClient();
  const sourceId = sourceIdFor(input.company, input.url);
  const now = new Date().toISOString();
  const existingSource = await client.from("job_sources").select("metadata").eq("id", sourceId).maybeSingle();
  if (existingSource.error) throw new Error(`来源任务读取失败：${existingSource.error.message}`);
  const existingMetadata = metadataRecord(existingSource.data?.metadata);
  const cursor = readCursor(existingMetadata);
  const sourceResult = await client.from("job_sources").upsert({
    id: sourceId,
    company: input.company,
    name: input.company,
    homepage_url: input.url,
    feed_url: input.url,
    source_kind: "user_submitted",
    adapter_key: input.adapterKey ?? "generic-public",
    is_active: true,
    last_checked_at: now,
    metadata: { ...existingMetadata, sourceTask: true },
    updated_at: now,
  }, { onConflict: "id" });
  if (sourceResult.error) throw new Error(`来源任务初始化失败：${sourceResult.error.message}`);

  const runResult = await client.from("collection_runs").insert({
    source_id: sourceId,
    trigger_kind: input.triggerKind ?? "manual",
    status: "running",
    started_at: now,
    stats: { company: input.company, url: input.url, adapterKey: input.adapterKey ?? "generic-public", cursor },
  }).select("*").single();
  if (runResult.error || !runResult.data) throw new Error(`采集任务创建失败：${runResult.error?.message ?? "未返回任务记录"}`);
  return { run: runResult.data as CollectionRun, sourceId, cursor };
}

export async function updateSourceCursor(sourceId: string, cursor: SourceCollectionCursor) {
  const client = requireClient();
  const current = await client.from("job_sources").select("metadata").eq("id", sourceId).maybeSingle();
  if (current.error) throw new Error(`来源游标读取失败：${current.error.message}`);
  const metadata = { ...metadataRecord(current.data?.metadata), collectionCursor: cursor };
  const result = await client.from("job_sources").update({ metadata, updated_at: new Date().toISOString() }).eq("id", sourceId);
  if (result.error) throw new Error(`来源游标保存失败：${result.error.message}`);
}

export async function updateCollectionRun(id: string, patch: Partial<Omit<CollectionRun, "id">>) {
  const client = requireClient();
  const result = await client.from("collection_runs").update(patch).eq("id", id).select("*").single();
  if (result.error) throw new Error(`采集任务更新失败：${result.error.message}`);
  return result.data as CollectionRun;
}

export async function getCollectionRun(id: string) {
  const client = requireClient();
  const result = await client.from("collection_runs").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new Error(`采集任务查询失败：${result.error.message}`);
  return (result.data as CollectionRun | null) ?? null;
}

export async function listActiveSources() {
  const client = requireClient();
  const result = await client.from("job_sources").select("id,company,feed_url,adapter_key,is_active").eq("is_active", true).order("updated_at", { ascending: true }).limit(30);
  if (result.error) throw new Error(`来源列表查询失败：${result.error.message}`);
  return result.data as Array<{ id: string; company: string; feed_url: string | null; adapter_key: string | null; is_active: boolean }>;
}

export async function getActiveSource(id: string) {
  const client = requireClient();
  const result = await client
    .from("job_sources")
    .select("id,company,feed_url,adapter_key,is_active")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (result.error) throw new Error(`来源读取失败：${result.error.message}`);
  return result.data as { id: string; company: string; feed_url: string | null; adapter_key: string | null; is_active: boolean } | null;
}
