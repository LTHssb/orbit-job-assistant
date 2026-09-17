import { normalizeJobs, type NormalizedJob, type SourceStatus } from "../job-schema";
import { createSupabaseReadClient } from "./server";

type JobRow = {
  id: string;
  canonical_key: string;
  title: string;
  company: string;
  location: string[] | null;
  salary: string | null;
  experience: string | null;
  education: string | null;
  category: string | null;
  recruitment_type: string | null;
  employment_type: string | null;
  description: string | null;
  responsibilities: unknown;
  requirements: unknown;
  benefits: unknown;
  application_url: string | null;
  source_url: string | null;
  source_name: string;
  source_kind: string;
  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  is_new: boolean;
  raw: Record<string, unknown> | null;
  schema_version: string;
  updated_at: string;
};

type SourceRow = {
  id: string;
  name: string;
  feed_url: string | null;
  is_active: boolean;
  updated_at: string;
};

export type SupabaseJobSnapshot = {
  jobs: NormalizedJob[];
  sourceStatus: SourceStatus[];
  updatedAt: string;
  report: ReturnType<typeof normalizeJobs>["report"];
};

const asList = (value: unknown) => Array.isArray(value) ? value : [];

function rowToRaw(row: JobRow): Record<string, unknown> {
  return {
    ...(row.raw ?? {}),
    id: row.id,
    canonicalKey: row.canonical_key,
    title: row.title,
    company: row.company,
    location: row.location ?? [],
    salary: row.salary,
    experience: row.experience,
    education: row.education,
    category: row.category,
    recruitmentType: row.recruitment_type,
    employmentType: row.employment_type,
    description: row.description,
    responsibilities: asList(row.responsibilities),
    requirements: asList(row.requirements),
    benefits: asList(row.benefits),
    applicationUrl: row.application_url,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    sourceKind: row.source_kind,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
    isNew: row.is_new,
    schemaVersion: row.schema_version,
  };
}

export async function getSupabaseJobSnapshot(): Promise<SupabaseJobSnapshot | null> {
  const client = createSupabaseReadClient();
  if (!client) return null;

  let jobsResult;
  let sourcesResult;
  try {
    [jobsResult, sourcesResult] = await Promise.all([
      client.from("jobs").select("*").eq("status", "active").order("updated_at", { ascending: false }).limit(500),
      client.from("job_sources").select("id,name,feed_url,is_active,updated_at").eq("is_active", true).order("updated_at", { ascending: false }),
    ]);
  } catch (error) {
    console.warn(`[supabase] connection failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  if (jobsResult.error) {
    console.warn(`[supabase] jobs read failed: ${jobsResult.error.message}`);
    return null;
  }

  const rows = (jobsResult.data ?? []) as JobRow[];
  const normalized = normalizeJobs(rows.map(rowToRaw));
  const sources = (sourcesResult.data ?? []) as SourceRow[];
  const sourceStatus: SourceStatus[] = sources.map((source) => ({
    id: source.id,
    name: source.name,
    url: source.feed_url ?? "",
    ok: true,
    items: rows.filter((row) => row.source_name === source.name).length,
    checkedAt: source.updated_at,
  }));

  return {
    jobs: normalized.jobs,
    sourceStatus,
    updatedAt: rows[0]?.updated_at ?? sources[0]?.updated_at ?? new Date().toISOString(),
    report: normalized.report,
  };
}
