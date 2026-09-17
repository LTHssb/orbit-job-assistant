import { createHash } from "node:crypto";
import { normalizeJobs, type NormalizedJob } from "../job-schema";
import type { SourceAdapterKey } from "../source-adapters";
import { createSupabaseAdminClient } from "./admin";

type ImportedJobInput = {
  title: string;
  company: string;
  location: string;
  description: string;
  applicationUrl: string;
  sourceUrl: string;
  sourceName: string;
  sourceKind: "official_api" | "official_page";
  raw?: Record<string, unknown>;
};

type ImportAttempt = { url: string; status?: number; contentType?: string; stage?: string; error?: string; screenshotUrl?: string; metadata?: Record<string, unknown> };

const stableId = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const IMPORT_BATCH_SIZE = 50;

function supabaseErrorMessage(prefix: string, error: unknown) {
  if (!error || typeof error !== "object") return `${prefix}：请求失败`;
  const item = error as { message?: string; code?: string; details?: string; hint?: string };
  const detail = [item.message, item.code, item.details, item.hint].filter(Boolean).join("；");
  return `${prefix}：${detail || "请求失败"}`;
}

function toNormalizedJobs(jobs: ImportedJobInput[], snapshotAt: string) {
  return normalizeJobs(jobs.map((job) => ({
    id: `import-${stableId(`${job.company}|${job.title}|${job.applicationUrl}`)}`,
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
    applicationUrl: job.applicationUrl,
    sourceUrl: job.sourceUrl,
    sourceName: job.sourceName,
    sourceKind: job.sourceKind,
    raw: job.raw ?? {},
    firstSeenAt: snapshotAt,
    lastSeenAt: snapshotAt,
    status: "active",
    isNew: true,
  })), snapshotAt).jobs;
}

export function sourceIdFor(company: string, url: string) {
  return `source:${stableId(`${company}|${url}`)}`;
}

function jobRow(job: NormalizedJob, sourceId: string, snapshotAt: string, existingId?: string) {
  return {
    id: existingId || job.id,
    canonical_key: job.canonicalKey,
    title: job.title,
    company: job.company,
    location: job.location ? [job.location] : [],
    salary: job.salary,
    experience: job.experience,
    education: job.education,
    category: job.category,
    recruitment_type: job.recruitmentType,
    employment_type: job.employmentType,
    description: job.description,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    benefits: job.benefits,
    application_url: job.applicationUrl,
    source_url: job.sourceUrl,
    source_name: job.sourceName || job.company,
    source_kind: job.sourceKind === "official_api" ? "official_api" : "official_page",
    source_id: sourceId,
    published_at: job.publishedAt,
    first_seen_at: job.firstSeenAt || snapshotAt,
    last_seen_at: snapshotAt,
    status: job.status === "closed" ? "hidden" : job.status === "stale" ? "expired" : "active",
    is_new: true,
    quality_score: job.quality.score,
    quality_level: job.quality.level,
    quality_missing: job.quality.missing,
    raw: job.raw,
    schema_version: job.schemaVersion,
    updated_at: snapshotAt,
  };
}

export type ImportPersistenceResult = {
  configured: boolean;
  persisted: boolean;
  sourceId: string | null;
  jobs: number;
  message: string;
};

export async function persistImportedJobs(input: {
  company: string;
  url: string;
  jobs: ImportedJobInput[];
  attempts: ImportAttempt[];
  adapterKey?: SourceAdapterKey;
  checkedAt?: string;
}): Promise<ImportPersistenceResult> {
  const sourceId = sourceIdFor(input.company, input.url);
  const client = createSupabaseAdminClient();
  if (!client) {
    return { configured: false, persisted: false, sourceId: null, jobs: 0, message: "已完成识别；未配置 Supabase 服务端密钥，本次结果仅返回当前页面" };
  }

  const snapshotAt = input.checkedAt || new Date().toISOString();
  const normalized = toNormalizedJobs(input.jobs, snapshotAt);
  const sourceKind = normalized.some((job) => job.sourceKind === "official_api") ? "official_api" : "official_page";
  const sourceRow = {
    id: sourceId,
    company: input.company,
    name: input.company,
    homepage_url: input.url,
    feed_url: input.url,
    source_kind: sourceKind,
    adapter_key: input.adapterKey ?? "generic-public",
    is_active: true,
    last_checked_at: snapshotAt,
    last_success_at: normalized.length ? snapshotAt : null,
    last_error: normalized.length ? null : "未发现可标准化岗位",
    metadata: { attempts: input.attempts, contractVersion: "job-schema.v1" },
    updated_at: snapshotAt,
  };

  const sourceResult = await client.from("job_sources").upsert(sourceRow, { onConflict: "id" });
  if (sourceResult.error) throw new Error(supabaseErrorMessage("来源写入失败", sourceResult.error));

  if (!normalized.length) {
    return { configured: true, persisted: true, sourceId, jobs: 0, message: "来源已登记，但没有可持久化的标准岗位" };
  }

  const keys = normalized.map((job) => job.canonicalKey);
  const existingIds = new Map<string, string>();
  for (let index = 0; index < keys.length; index += IMPORT_BATCH_SIZE) {
    const existingResult = await client.from("jobs").select("id,canonical_key").in("canonical_key", keys.slice(index, index + IMPORT_BATCH_SIZE));
    if (existingResult.error) throw new Error(supabaseErrorMessage("查询已有岗位失败", existingResult.error));
    for (const row of existingResult.data ?? []) existingIds.set(row.canonical_key, row.id);
  }
  const rows = normalized.map((job) => jobRow(job, sourceId, snapshotAt, existingIds.get(job.canonicalKey)));

  for (let index = 0; index < rows.length; index += IMPORT_BATCH_SIZE) {
    const jobsResult = await client.from("jobs").upsert(rows.slice(index, index + IMPORT_BATCH_SIZE), { onConflict: "canonical_key" });
    if (jobsResult.error) throw new Error(supabaseErrorMessage("岗位写入失败", jobsResult.error));
  }

  const evidenceRows = normalized.flatMap((job, index) => {
    const jobId = existingIds.get(job.canonicalKey) || job.id;
    const rows = [{
      job_id: jobId,
    evidence_kind: job.sourceKind === "official_api" ? "api" : "page",
    url: job.applicationUrl || job.sourceUrl,
    captured_at: snapshotAt,
    note: "通过官网来源导入器识别",
      metadata: { sourceId, schemaVersion: job.schemaVersion } as Record<string, unknown>,
    }];
    const screenshotUrl = input.attempts.find((attempt) => attempt.screenshotUrl)?.screenshotUrl;
    if (screenshotUrl && index < 10) {
      rows.push({
        job_id: jobId,
        evidence_kind: "screenshot",
        url: screenshotUrl,
        captured_at: snapshotAt,
        note: "瀹樼綉娴忚鍣ㄨ瑙夊揩鐓э紝瑙嗕负棣栭〉瑙佽瘉",
        metadata: { sourceId, schemaVersion: job.schemaVersion, coverage: "first-page" } as Record<string, unknown>,
      });
    }
    return rows;
  });
  for (let index = 0; index < evidenceRows.length; index += IMPORT_BATCH_SIZE) {
    const evidenceResult = await client.from("job_evidence").insert(evidenceRows.slice(index, index + IMPORT_BATCH_SIZE));
    if (evidenceResult.error) throw new Error(supabaseErrorMessage("岗位证据写入失败", evidenceResult.error));
  }

  return { configured: true, persisted: true, sourceId, jobs: rows.length, message: `已持久化 ${rows.length} 条岗位到 Supabase` };
}
